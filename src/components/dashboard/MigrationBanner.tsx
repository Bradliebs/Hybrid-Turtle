/**
 * DEPENDENCIES
 * Consumed by: src/app/dashboard/page.tsx
 * Consumes: /api/db-status endpoint
 * Risk-sensitive: NO
 * Last modified: 2026-03-02
 * Notes: Shows a warning banner when pending database migrations are detected
 */

'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface DbStatus {
  status: 'ok' | 'needs_migration' | 'error';
  pending: number;
  message?: string;
}

export default function MigrationBanner() {
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/db-status')
      .then((res) => res.json())
      .then((data: DbStatus) => setDbStatus(data))
      .catch(() => {
        // If the API itself fails, the DB might be broken — show warning
        setDbStatus({
          status: 'error',
          pending: 0,
          message: 'Could not check database status. The database may need updating.',
        });
      });
  }, []);

  if (!dbStatus || dbStatus.status === 'ok' || dismissed) return null;

  return (
    <div className="bg-amber-900/80 border border-amber-500/50 rounded-lg mx-4 sm:mx-6 mt-4 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-amber-200 font-semibold text-sm">
            Database Needs Updating
          </h3>
          <p className="text-amber-300/80 text-sm mt-1">
            {dbStatus.status === 'needs_migration'
              ? `${dbStatus.pending} pending migration(s) detected. The dashboard may show errors until the database is updated.`
              : dbStatus.message}
          </p>
          <div className="mt-2 flex items-center gap-4">
            <code className="bg-black/30 text-amber-200 px-3 py-1.5 rounded text-xs font-mono">
              npx prisma migrate deploy
            </code>
            <span className="text-amber-400/60 text-xs">then restart the app</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-amber-400/60 hover:text-amber-300 text-xs flex-shrink-0"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
