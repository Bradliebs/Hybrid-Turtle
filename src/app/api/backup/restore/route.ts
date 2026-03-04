/**
 * DEPENDENCIES
 * Consumed by: BackupPanel.tsx (settings page), restore-backup.bat
 * Consumes: db-backup.ts
 * Risk-sensitive: YES (replaces the live database!)
 * Last modified: 2026-03-04
 * Notes: POST restores a named backup file over dev.db.
 *        Creates a pre-restore safety backup automatically.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { restoreDatabase, listBackups } from '@/lib/db-backup';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const restoreSchema = z.object({
  filename: z.string().trim().min(1, 'Backup filename is required'),
});

/**
 * POST /api/backup/restore
 * Body: { filename: "dev.db.backup-2026-03-04-1430" }
 * Restores the named backup over the live database.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, restoreSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const { filename } = parsed.data;

    // Verify the file is in our backup list (extra safety)
    const knownBackups = listBackups();
    const isKnown = knownBackups.some((b) => b.filename === filename);
    if (!isKnown) {
      return apiError(400, 'UNKNOWN_BACKUP', `Backup file "${filename}" is not in the managed backup list`);
    }

    const result = await restoreDatabase(filename);

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ...result,
      message: `Database restored from ${filename}. Restart the app for changes to take full effect.`,
    });
  } catch (error) {
    console.error('[backup/restore] POST error:', error);
    return apiError(500, 'RESTORE_FAILED', 'Restore failed unexpectedly', (error as Error).message, true);
  }
}
