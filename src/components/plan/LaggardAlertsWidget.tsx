'use client';

import { Trash2, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';

export default function LaggardAlertsWidget() {
  const { data, loading } = useModulesData();
  const laggards = data?.laggards ?? [];

  const trimLaggards = laggards.filter((l) => l.action === 'TRIM_LAGGARD' || l.action === 'TRIM');
  const deadMoney = laggards.filter((l) => l.action === 'WATCH');

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Trash2 className="w-4 h-4 text-loss" />
        Laggard & Dead Money
        {laggards.length > 0 && (
          <span className="ml-auto text-xs font-mono bg-loss/15 text-loss px-2 py-0.5 rounded">
            {laggards.length}
          </span>
        )}
      </h3>

      {loading && (
        <div className="text-xs text-muted-foreground text-center py-4">
          Loading laggard data...
        </div>
      )}

      {!loading && laggards.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4 bg-navy-700/20 rounded-lg">
          No laggards — all positions are performing
        </div>
      )}

      {!loading && laggards.length > 0 && (
        <div className="space-y-3">
          {/* Trim Laggards */}
          {trimLaggards.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-loss/70 mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Underwater — Consider Trimming
              </div>
              <div className="space-y-2">
                {trimLaggards.map((l) => (
                  <div
                    key={l.positionId || l.ticker}
                    className="bg-loss/5 rounded-lg p-3 border border-loss/15"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-foreground">{l.ticker}</span>
                      <span className="text-xs font-mono text-loss">
                        {l.rMultiple.toFixed(1)}R · {l.gainPercent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Clock className="w-3 h-3 flex-shrink-0" />
                      <span>{l.daysHeld}d held</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      {l.reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dead Money */}
          {deadMoney.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-warning/70 mb-1.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Dead Money — Stalled Positions
              </div>
              <div className="space-y-2">
                {deadMoney.map((l) => (
                  <div
                    key={l.positionId || l.ticker}
                    className="bg-warning/5 rounded-lg p-3 border border-warning/15"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-foreground">{l.ticker}</span>
                      <span className="text-xs font-mono text-warning">
                        {l.rMultiple.toFixed(1)}R · {l.daysHeld}d
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      {l.reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground/60 mt-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>Suggestions only — review before acting</span>
          </div>
        </div>
      )}
    </div>
  );
}
