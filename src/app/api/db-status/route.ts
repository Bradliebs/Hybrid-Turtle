/**
 * DEPENDENCIES
 * Consumed by: Dashboard migration banner (client-side fetch)
 * Consumes: prisma/migrations/ directory, scripts/auto-migrate.mjs
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: GET checks migration status, POST triggers auto-migrate to fix issues
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface MigrationRow {
  migration_name: string;
}

export async function GET() {
  try {
    const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');

    // 1. Read migration folders from disk (exclude lock file and hidden files)
    let diskMigrations: string[] = [];
    try {
      const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
      diskMigrations = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch {
      // No migrations directory — nothing to apply
      return NextResponse.json({ status: 'ok', pending: 0, migrations: [] });
    }

    // 2. Read applied migrations from _prisma_migrations table
    //    Uses a targeted Prisma raw query — no user input, parameterless.
    let appliedMigrations: string[] = [];
    try {
      // Prisma doesn't model _prisma_migrations, so use a safe raw read.
      // This is a static query with no parameters — no injection risk.
      const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'
      );
      appliedMigrations = rows.map((r) => r.migration_name);
    } catch {
      // Table doesn't exist — DB has never had migrations applied
      // This means ALL migrations are pending
      return NextResponse.json({
        status: 'needs_migration',
        pending: diskMigrations.length,
        migrations: diskMigrations,
        message: 'Database has no migration history. Run: npx prisma migrate deploy',
      });
    }

    // 3. Find pending = on disk but not applied
    const pending = diskMigrations.filter((m) => !appliedMigrations.includes(m));

    if (pending.length > 0) {
      return NextResponse.json({
        status: 'needs_migration',
        pending: pending.length,
        migrations: pending,
        message: `${pending.length} pending migration(s). Run: npx prisma migrate deploy`,
      });
    }

    return NextResponse.json({ status: 'ok', pending: 0, migrations: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { status: 'error', message: `Failed to check migration status: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/db-status — Run auto-migrate to fix pending/failed migrations
 * Called by the "Fix Now" button in the MigrationBanner component
 */
export async function POST() {
  // Safety gate: shell execution only allowed when explicitly opted in
  if (process.env.ALLOW_AUTO_MIGRATE !== 'true') {
    return NextResponse.json(
      {
        success: false,
        message: 'Auto-migrate is disabled. Set ALLOW_AUTO_MIGRATE=true in .env to enable, or run manually: npx prisma migrate deploy',
      },
      { status: 403 }
    );
  }

  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'auto-migrate.mjs');

    // Check script exists
    try {
      await fs.access(scriptPath);
    } catch {
      return NextResponse.json(
        { success: false, message: 'Auto-migrate script not found. Run: npx prisma migrate deploy' },
        { status: 500 }
      );
    }

    // Dynamic import to avoid pulling child_process into the module scope
    const { execSync } = await import('child_process');

    const output = execSync('node scripts/auto-migrate.mjs', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return NextResponse.json({
      success: true,
      message: 'Migrations applied successfully. Refresh the page.',
      output: output.trim(),
    });
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = ((error.stdout || '') + '\n' + (error.stderr || '')).trim();
    return NextResponse.json(
      {
        success: false,
        message: 'Auto-migrate failed. You may need to restart the app.',
        output,
      },
      { status: 500 }
    );
  }
}
