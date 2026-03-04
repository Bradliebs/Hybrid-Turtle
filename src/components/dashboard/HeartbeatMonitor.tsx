'use client';

import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { Heart, AlertTriangle } from 'lucide-react';
import { timeSince } from '@/lib/utils';

export default function HeartbeatMonitor() {
  const { lastHeartbeat, heartbeatOk, heartbeatStatus } = useStore();

  const isPartial = heartbeatOk && heartbeatStatus === 'PARTIAL';

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Heartbeat Monitor</h3>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            isPartial
              ? 'bg-warning/20'
              : heartbeatOk
                ? 'bg-profit/20 animate-pulse-green'
                : 'bg-loss/20 animate-pulse-red'
          )}
        >
          {isPartial ? (
            <AlertTriangle className="w-5 h-5 text-warning" />
          ) : heartbeatOk ? (
            <Heart className="w-5 h-5 text-profit heartbeat-animation" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-loss" />
          )}
        </div>
        <div>
          <div
            className={cn(
              'text-sm font-semibold',
              isPartial ? 'text-warning' : heartbeatOk ? 'text-profit' : 'text-loss'
            )}
          >
            {isPartial
              ? 'Partial — some steps degraded'
              : heartbeatOk
                ? 'Healthy'
                : 'STALE — Nightly run missing'}
          </div>
          <div className="text-xs text-muted-foreground">
            {lastHeartbeat
              ? `Last run: ${timeSince(lastHeartbeat)}`
              : 'No heartbeat recorded yet'}
          </div>
        </div>
      </div>
    </div>
  );
}
