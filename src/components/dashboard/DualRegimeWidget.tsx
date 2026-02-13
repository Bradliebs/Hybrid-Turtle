'use client';

import { Globe, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import type { DualRegimeResult, RegimeStabilityResult } from '@/types';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';

const REGIME_CONFIG = {
  BULLISH: { color: 'text-profit', bg: 'bg-profit/10', icon: TrendingUp },
  BEARISH: { color: 'text-loss', bg: 'bg-loss/10', icon: TrendingDown },
  SIDEWAYS: { color: 'text-warning', bg: 'bg-warning/10', icon: Minus },
} as const;

export default function DualRegimeWidget() {
  const { data: modulesData, loading } = useModulesData();
  const dual = modulesData?.dualRegime ?? null;
  const stability = modulesData?.regimeStability ?? null;

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary-400 animate-pulse" />
          Dual Benchmark Regime
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!dual) return null;

  const CombinedIcon = REGIME_CONFIG[dual.combined]?.icon || Minus;

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Globe className="w-4 h-4 text-primary-400" />
        Dual Benchmark Regime
      </h3>

      {/* Combined Regime */}
      <div className={cn('rounded-lg p-3 mb-3', REGIME_CONFIG[dual.combined]?.bg)}>
        <div className="flex items-center gap-2">
          <CombinedIcon className={cn('w-5 h-5', REGIME_CONFIG[dual.combined]?.color)} />
          <span className={cn('text-lg font-bold', REGIME_CONFIG[dual.combined]?.color)}>
            {dual.combined}
          </span>
          {dual.chopDetected && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning border border-warning/30">
              CHOP
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">Combined regime from both benchmarks</div>
      </div>

      {/* Individual Benchmarks */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg border border-border/50 p-2">
          <div className="text-[10px] text-muted-foreground mb-1">🇺🇸 SPY (US)</div>
          <div className={cn('text-sm font-bold', REGIME_CONFIG[dual.spy.regime]?.color)}>
            {dual.spy.regime}
          </div>
          {dual.spy.price > 0 && (
            <div className="text-[10px] text-muted-foreground">
              ${dual.spy.price.toFixed(2)} vs MA200 ${dual.spy.ma200.toFixed(2)}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border/50 p-2">
          <div className="text-[10px] text-muted-foreground mb-1">🇬🇧 VWRL (Global)</div>
          <div className={cn('text-sm font-bold', REGIME_CONFIG[dual.vwrl.regime]?.color)}>
            {dual.vwrl.regime}
          </div>
          {dual.vwrl.price > 0 && (
            <div className="text-[10px] text-muted-foreground">
              ${dual.vwrl.price.toFixed(2)} vs MA200 ${dual.vwrl.ma200.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* Regime Stability */}
      {stability && (
        <div className={cn(
          'rounded-lg border p-2',
          stability.isStable ? 'border-profit/20 bg-profit/5' : 'border-warning/20 bg-warning/5'
        )}>
          <div className="flex items-center gap-1.5">
            <Activity className={cn('w-3 h-3', stability.isStable ? 'text-profit' : 'text-warning')} />
            <span className="text-xs font-medium text-foreground">
              {stability.isStable ? 'Stable' : 'Unstable'} — {stability.consecutiveDays}d consecutive
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{stability.reason}</div>
        </div>
      )}
    </div>
  );
}
