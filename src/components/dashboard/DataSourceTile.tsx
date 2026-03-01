'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Database, Wifi, WifiOff, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface DataSourceInfo {
  health: 'LIVE' | 'PARTIAL' | 'DEGRADED' | 'UNKNOWN';
  staleTickers: string[];
  maxStalenessHours: number;
  summary: string;
  lastYahooSuccess: string | null;
}

const STATUS_CONFIG: Record<string, {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  LIVE: {
    label: 'Live data',
    icon: '✓',
    color: 'text-profit',
    bgColor: 'bg-profit/10',
    borderColor: 'border-profit/30',
  },
  PARTIAL: {
    label: 'Partial data',
    icon: '⚠',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
  },
  DEGRADED: {
    label: 'Cached data',
    icon: '⚠',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
  },
  UNKNOWN: {
    label: 'Unknown',
    icon: '—',
    color: 'text-muted-foreground',
    bgColor: 'bg-navy-700/50',
    borderColor: 'border-border',
  },
};

export default function DataSourceTile() {
  const [info, setInfo] = useState<DataSourceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiRequest<DataSourceInfo>('/api/data-source');
      setInfo(data);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Data Source</h3>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Checking...
        </div>
      </div>
    );
  }

  const health = info?.health ?? 'UNKNOWN';
  const config = STATUS_CONFIG[health] ?? STATUS_CONFIG.UNKNOWN;
  const staleCount = info?.staleTickers?.length ?? 0;
  const maxHours = info?.maxStalenessHours ?? 0;
  const isStaleCache = health === 'DEGRADED' && maxHours > 48;

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Database className="w-4 h-4 text-primary-400" />
        Data Source
      </h3>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            config.bgColor
          )}
        >
          {health === 'LIVE' ? (
            <Wifi className={cn('w-5 h-5', config.color)} />
          ) : health === 'UNKNOWN' ? (
            <Database className={cn('w-5 h-5', config.color)} />
          ) : isStaleCache ? (
            <WifiOff className="w-5 h-5 text-loss" />
          ) : (
            <AlertTriangle className={cn('w-5 h-5', config.color)} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border',
                isStaleCache ? 'text-loss bg-loss/10 border-loss/30' : config.color,
                !isStaleCache && config.bgColor,
                !isStaleCache && config.borderColor
              )}
            >
              {isStaleCache ? '✗' : config.icon} {isStaleCache ? 'Stale cache' : config.label}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {health === 'LIVE' && 'All tickers from Yahoo Finance'}
            {health === 'PARTIAL' && `${staleCount} ticker${staleCount !== 1 ? 's' : ''} from cache`}
            {health === 'DEGRADED' && !isStaleCache && `Cached data — ${maxHours.toFixed(0)}h old`}
            {health === 'DEGRADED' && isStaleCache && `Stale cache — ${maxHours.toFixed(0)}h old`}
            {health === 'UNKNOWN' && 'No data source info yet'}
          </div>
          {info?.lastYahooSuccess && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Last Yahoo: {new Date(info.lastYahooSuccess).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
