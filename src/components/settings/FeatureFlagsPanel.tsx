'use client';

/**
 * DEPENDENCIES
 * Consumed by: SystemPanel (settings)
 * Consumes: /api/feature-flags (GET)
 * Risk-sensitive: NO (read-only display)
 * Last modified: 2026-03-04
 */

import { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { FlaskConical } from 'lucide-react';

interface FlagInfo {
  flag: string;
  enabled: boolean;
  description: string;
}

export default function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<FlagInfo[]>([]);

  useEffect(() => {
    apiRequest<{ flags: FlagInfo[] }>('/api/feature-flags')
      .then((data) => setFlags(data.flags ?? []))
      .catch(() => {});
  }, []);

  if (flags.length === 0) return null;

  return (
    <div className="card-surface p-6">
      <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-3">
        <FlaskConical className="w-5 h-5 text-primary-400" />
        Feature Flags
      </h2>

      <div className="space-y-1.5 mb-3">
        {flags.map((f) => (
          <div key={f.flag} className="flex items-center justify-between py-1.5 px-2 rounded bg-navy-800/40 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn('w-2 h-2 rounded-full flex-shrink-0', f.enabled ? 'bg-profit' : 'bg-muted-foreground/30')} />
              <span className="font-mono text-foreground">{f.flag}</span>
            </div>
            <span className={cn('text-xs', f.enabled ? 'text-profit' : 'text-muted-foreground/60')}>
              {f.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        To enable a feature, edit <code className="text-primary-400 font-mono">src/lib/feature-flags.ts</code> and restart the server.
      </p>
    </div>
  );
}
