'use client';

import { ArrowRightLeft, ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';

export default function SwapSuggestionsWidget() {
  const { data, loading } = useModulesData();
  const swaps = data?.swapSuggestions ?? [];

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <ArrowRightLeft className="w-4 h-4 text-warning" />
        Swap Suggestions
        {swaps.length > 0 && (
          <span className="ml-auto text-xs font-mono bg-warning/15 text-warning px-2 py-0.5 rounded">
            {swaps.length}
          </span>
        )}
      </h3>

      {loading && (
        <div className="text-xs text-muted-foreground text-center py-4">
          Loading swap data...
        </div>
      )}

      {!loading && swaps.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4 bg-navy-700/20 rounded-lg">
          No swap suggestions — all clusters are healthy
        </div>
      )}

      {!loading && swaps.length > 0 && (
        <div className="space-y-3">
          {swaps.map((swap) => (
            <div
              key={`${swap.cluster}-${swap.weakTicker}-${swap.strongTicker}`}
              className="bg-navy-700/40 rounded-lg p-3 border border-warning/15"
            >
              {/* Cluster label */}
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                {swap.cluster}
              </div>

              {/* Swap visual */}
              <div className="flex items-center gap-2 mb-2">
                {/* Weak side */}
                <div className="flex-1 bg-loss/10 rounded px-2.5 py-1.5 border border-loss/20">
                  <div className="text-xs text-loss font-semibold">{swap.weakTicker}</div>
                  <div className="text-[10px] text-loss/70 font-mono">
                    {swap.weakRMultiple.toFixed(1)}R
                  </div>
                </div>

                <ArrowRight className="w-4 h-4 text-warning flex-shrink-0" />

                {/* Strong side */}
                <div className="flex-1 bg-profit/10 rounded px-2.5 py-1.5 border border-profit/20">
                  <div className="text-xs text-profit font-semibold">{swap.strongTicker}</div>
                  <div className="text-[10px] text-profit/70 font-mono">
                    Score {swap.strongRankScore.toFixed(0)}
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                {swap.reason}
              </div>
            </div>
          ))}

          <div className="flex items-start gap-2 text-xs text-amber-400 mt-3 p-2 rounded-md bg-amber-400/10 border border-amber-400/20">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="font-medium">Suggestions only — weak position must be underwater &amp; below 0.5R</span>
          </div>
        </div>
      )}
    </div>
  );
}
