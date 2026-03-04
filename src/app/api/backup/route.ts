/**
 * DEPENDENCIES
 * Consumed by: BackupPanel.tsx (settings page)
 * Consumes: db-backup.ts
 * Risk-sensitive: NO (read-only file copy — never modifies source DB)
 * Last modified: 2026-03-03
 * Notes: POST triggers a backup, GET lists existing backups.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { backupDatabase, listBackups } from '@/lib/db-backup';
import { apiError } from '@/lib/api-response';

/**
 * GET /api/backup
 * Returns list of existing backup files, newest first.
 */
export async function GET(_request: NextRequest) {
  try {
    const backups = listBackups();

    return NextResponse.json({
      backups,
      count: backups.length,
      maxBackups: 7,
      directory: 'prisma/backups/',
    });
  } catch (error) {
    console.error('[backup] GET error:', error);
    return apiError(500, 'BACKUP_LIST_FAILED', 'Failed to list backups', (error as Error).message, true);
  }
}

/**
 * POST /api/backup
 * Triggers an immediate database backup.
 */
export async function POST(_request: NextRequest) {
  try {
    const result = await backupDatabase();

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[backup] POST error:', error);
    return apiError(500, 'BACKUP_FAILED', 'Backup failed unexpectedly', (error as Error).message, true);
  }
}
