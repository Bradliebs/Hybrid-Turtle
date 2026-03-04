/**
 * DEPENDENCIES
 * Consumed by: /api/backup/route.ts, /api/backup/restore/route.ts, nightly.ts
 * Consumes: fs, path (Node built-ins)
 * Risk-sensitive: RESTORE IS DESTRUCTIVE (replaces live DB with a backup copy)
 * Last modified: 2026-03-04
 * Notes: SQLite DB backup utility. Copies dev.db to prisma/backups/ with a
 *        timestamped filename. Keeps only the 7 most recent backups.
 *        Restore copies a backup file OVER dev.db (creates a pre-restore backup first).
 *        Never throws — always returns a result object.
 */

import fs from 'fs';
import path from 'path';

// ── Types ──

export interface BackupResult {
  success: boolean;
  filename: string | null;
  filepath: string | null;
  sizeBytes: number | null;
  error: string | null;
  timestamp: string;
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

// ── Constants ──

const DB_FILENAME = 'dev.db';
const BACKUP_DIR = 'prisma/backups';
const MAX_BACKUPS = 7;

/** Resolve a path relative to the project root (process.cwd()) */
function projectPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

// ── Core backup function ──

export async function backupDatabase(): Promise<BackupResult> {
  const timestamp = new Date().toISOString();

  try {
    // 1. Locate source DB
    const srcPath = projectPath('prisma', DB_FILENAME);
    if (!fs.existsSync(srcPath)) {
      return {
        success: false,
        filename: null,
        filepath: null,
        sizeBytes: null,
        error: `Source database not found at ${srcPath}`,
        timestamp,
      };
    }

    const srcStats = fs.statSync(srcPath);
    const srcSize = srcStats.size;

    // 2. Ensure backup directory exists
    const backupDir = projectPath(BACKUP_DIR);
    fs.mkdirSync(backupDir, { recursive: true });

    // 3. Generate timestamped filename
    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const timeStr = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('');
    const filename = `${DB_FILENAME}.backup-${dateStr}-${timeStr}`;
    const destPath = path.join(backupDir, filename);

    // 4. Copy the file
    fs.copyFileSync(srcPath, destPath);

    // 5. Verify copy
    if (!fs.existsSync(destPath)) {
      return {
        success: false,
        filename,
        filepath: destPath,
        sizeBytes: null,
        error: 'Backup file was not created — copyFileSync succeeded but file not found',
        timestamp,
      };
    }
    const destStats = fs.statSync(destPath);
    if (destStats.size !== srcSize) {
      return {
        success: false,
        filename,
        filepath: destPath,
        sizeBytes: destStats.size,
        error: `Backup size mismatch: source ${srcSize} bytes, backup ${destStats.size} bytes`,
        timestamp,
      };
    }

    // 6. Prune old backups — keep only the most recent MAX_BACKUPS
    try {
      pruneOldBackups(backupDir);
    } catch (pruneErr) {
      // Non-critical — log but still return success
      console.warn('[db-backup] Prune failed:', (pruneErr as Error).message);
    }

    // 7. Return success
    return {
      success: true,
      filename,
      filepath: destPath,
      sizeBytes: destStats.size,
      error: null,
      timestamp,
    };
  } catch (err) {
    return {
      success: false,
      filename: null,
      filepath: null,
      sizeBytes: null,
      error: (err as Error).message || 'Unknown backup error',
      timestamp,
    };
  }
}

// ── Prune helper ──

function pruneOldBackups(backupDir: string): void {
  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(`${DB_FILENAME}.backup-`))
    .sort(); // Timestamp format sorts chronologically

  if (files.length <= MAX_BACKUPS) return;

  const toDelete = files.slice(0, files.length - MAX_BACKUPS);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(path.join(backupDir, file));
      console.log(`[db-backup] Pruned old backup: ${file}`);
    } catch {
      // Best-effort — skip files that can't be deleted
    }
  }
}

// ── List existing backups ──

export function listBackups(): BackupFileInfo[] {
  const backupDir = projectPath(BACKUP_DIR);

  if (!fs.existsSync(backupDir)) return [];

  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(`${DB_FILENAME}.backup-`))
    .sort()
    .reverse(); // Newest first

  return files.map((filename) => {
    const filePath = path.join(backupDir, filename);
    const stats = fs.statSync(filePath);

    // Parse timestamp from filename: dev.db.backup-YYYY-MM-DD-HHmm
    const match = filename.match(/backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/);
    let createdAt = stats.mtime.toISOString();
    if (match) {
      const [, year, month, day, hour, min] = match;
      createdAt = new Date(`${year}-${month}-${day}T${hour}:${min}:00`).toISOString();
    }

    return {
      filename,
      sizeBytes: stats.size,
      createdAt,
    };
  });
}

// ── Restore function ──

export interface RestoreResult {
  success: boolean;
  restoredFrom: string;
  preRestoreBackup: string | null;
  error: string | null;
  timestamp: string;
}

/**
 * Restore the database from a named backup file.
 * Safety: creates a pre-restore backup of the current DB first so the user
 * can undo if the restore was a mistake.
 */
export async function restoreDatabase(backupFilename: string): Promise<RestoreResult> {
  const timestamp = new Date().toISOString();

  try {
    // Validate filename — must match the expected pattern (no path traversal)
    if (!backupFilename.startsWith(`${DB_FILENAME}.backup-`) || backupFilename.includes('..') || backupFilename.includes('/') || backupFilename.includes('\\')) {
      return { success: false, restoredFrom: backupFilename, preRestoreBackup: null, error: 'Invalid backup filename', timestamp };
    }

    const backupDir = projectPath(BACKUP_DIR);
    const backupPath = path.join(backupDir, backupFilename);
    const dbPath = projectPath('prisma', DB_FILENAME);

    // 1. Check backup file exists
    if (!fs.existsSync(backupPath)) {
      return { success: false, restoredFrom: backupFilename, preRestoreBackup: null, error: `Backup file not found: ${backupFilename}`, timestamp };
    }

    // 2. Check backup is a reasonable size (> 1 KB — catches empty/corrupt files)
    const backupStats = fs.statSync(backupPath);
    if (backupStats.size < 1024) {
      return { success: false, restoredFrom: backupFilename, preRestoreBackup: null, error: `Backup file too small (${backupStats.size} bytes) — likely corrupt`, timestamp };
    }

    // 3. Create a pre-restore safety backup of the current DB
    let preRestoreBackup: string | null = null;
    if (fs.existsSync(dbPath)) {
      const preRestoreName = `${DB_FILENAME}.pre-restore-${Date.now()}`;
      const preRestorePath = path.join(backupDir, preRestoreName);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(dbPath, preRestorePath);
      preRestoreBackup = preRestoreName;
    }

    // 4. Copy backup over the live DB
    fs.copyFileSync(backupPath, dbPath);

    // 5. Verify the copy succeeded
    const restoredStats = fs.statSync(dbPath);
    if (restoredStats.size !== backupStats.size) {
      return {
        success: false,
        restoredFrom: backupFilename,
        preRestoreBackup,
        error: `Restore size mismatch: backup ${backupStats.size} bytes, restored ${restoredStats.size} bytes`,
        timestamp,
      };
    }

    return {
      success: true,
      restoredFrom: backupFilename,
      preRestoreBackup,
      error: null,
      timestamp,
    };
  } catch (err) {
    return {
      success: false,
      restoredFrom: backupFilename,
      preRestoreBackup: null,
      error: (err as Error).message || 'Unknown restore error',
      timestamp,
    };
  }
}
