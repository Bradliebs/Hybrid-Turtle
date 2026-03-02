/**
 * DEPENDENCIES
 * Consumed by: Dashboard migration banner (client-side fetch)
 * Consumes: prisma/migrations/ directory
 * Risk-sensitive: NO
 * Last modified: 2026-03-02
 * Notes: Checks whether there are pending Prisma migrations that haven't been applied
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
    let appliedMigrations: string[] = [];
    try {
      const rows = await prisma.$queryRaw<MigrationRow[]>`
        SELECT migration_name FROM _prisma_migrations 
        WHERE finished_at IS NOT NULL
        ORDER BY migration_name
      `;
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
