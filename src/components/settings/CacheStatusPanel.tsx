'use client';

/**
 * DEPENDENCIES
 * Consumed by: SystemPanel (settings)
 * Consumes: /api/cache-status (GET + POST)
 * Risk-sensitive: NO
 * Last modified: 2026-03-04
 */

import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { HardDrive, RefreshCw, Trash2, Loader2, CheckCircle2 } from 'lucide-react';

interface CacheInfo {
  name: string;
  cacheKey: string;
  status: 'WARM' | 'STALE' | 'EMPTY';
  ageMinutes: number | null;
  ttlMinutes: number;
  sizeBytes: number | null;
  persistedAt: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CacheStatusPanel() {
  const [caches, setCaches] = useState<CacheInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiRequest<{ caches: CacheInfo[] }>('/api/cache-status');
      setCaches(data.caches ?? []);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleClearAll = async () => {
    setClearing(true);
    setClearResult(null);
    try {
      await apiRequest('/api/cache-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_all' }),
      });
      setClearResult('All caches cleared');
      fetchStatus();
      setTimeout(() => setClearResult(null), 3000);
    } catch {
      setClearResult('Clear failed');
    } finally {
      setClearing(false);
    }
  };

  const statusColor = (status: string) => {
    if (status === 'WARM') return 'text-profit';
    if (status === 'STALE') return 'text-warning';
    return 'text-muted-foreground';
  };

  const statusDot = (status: string) => {
    if (status === 'WARM') return 'bg-profit';
    if (status === 'STALE') return 'bg-warning';
    return 'bg-muted-foreground/30';
  };

  return (
    <div className="card-surface p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-primary-400" />
          Cache Status
        </h2>
        <div className="flex items-center gap-2">
          {clearResult && (
            <span className="text-xs text-profit flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {clearResult}
            </span>
          )}
          <button onClick={fetchStatus} className="text-muted-foreground hover:text-foreground p-1" title="Refresh">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className="btn-outline text-xs flex items-center gap-1"
          >
            {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            Clear All
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Persisted caches survive server restarts. Clear to force a full data refresh.
      </p>

      <div className="space-y-1.5">
        {caches.map((c) => (
          <div key={c.cacheKey} className="flex items-center justify-between py-1.5 px-2 rounded bg-navy-800/40 text-xs">
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 rounded-full', statusDot(c.status))} />
              <span className="text-foreground font-medium">{c.name}</span>
            </div>
            <div className="flex items-center gap-4 text-muted-foreground">
              <span className={statusColor(c.status)}>{c.status}</span>
              {c.ageMinutes != null && <span>{c.ageMinutes} min old</span>}
              <span className="text-muted-foreground/50">TTL: {c.ttlMinutes} min</span>
              {c.sizeBytes != null && <span>{formatBytes(c.sizeBytes)}</span>}
            </div>
          </div>
        ))}
        {caches.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground text-center py-3">No cache data</p>
        )}
      </div>
    </div>
  );
}
