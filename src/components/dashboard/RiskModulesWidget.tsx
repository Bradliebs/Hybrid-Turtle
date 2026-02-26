'use client';

import { BarChart3, TrendingUp, Ban, Clock, Flame, Trash2 } from 'lucide-react';
import type { BreadthSafetyResult, MomentumExpansionResult, TurnoverMetrics } from '@/types';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';

export default function RiskModulesWidget() {
  const { data: modulesData, loading } = useModulesData();
  const breadth = modulesData?.breadthSafety ?? null;
  const momentum = modulesData?.momentumExpansion ?? null;
  const turnover = modulesData?.turnover ?? null;
  const whipsawCount = modulesData?.whipsawBlocks?.length || 0;
  const laggardCount = modulesData?.laggards?.length || 0;
  const climaxCount = modulesData?.climaxSignals?.length || 0;

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Risk Modules</h3>
        <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">Risk Signals</h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {/* Breadth Safety */}
        <div className={cn(
          'rounded-lg border p-3 text-center',
          breadth?.isRestricted ? 'border-loss/30 bg-loss/5' : 'border-profit/20 bg-profit/5'
        )}>
          <BarChart3 className={cn('w-5 h-5 mx-auto mb-1', breadth?.isRestricted ? 'text-loss' : 'text-profit')} />
          <div className={cn('text-xl font-bold', breadth?.isRestricted ? 'text-loss' : 'text-profit')}>
            {breadth?.breadthPct.toFixed(0) || '—'}%
          </div>
          <div className="text-[10px] text-muted-foreground">Market Breadth</div>
          {breadth?.isRestricted && (
            <div className="text-[10px] text-loss mt-1 font-medium">
              Max pos → {breadth.maxPositionsOverride}
            </div>
          )}
        </div>

        {/* Momentum Expansion — DISABLED */}
        <div className="rounded-lg border border-muted/10 bg-muted/5 p-3 text-center opacity-50">
          <TrendingUp className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
          <div className="text-xl font-bold text-muted-foreground">OFF</div>
          <div className="text-[10px] text-muted-foreground">Momentum Exp.</div>
          <div className="text-[10px] text-muted-foreground mt-1">Disabled</div>
        </div>

        {/* Turnover */}
        <div className="rounded-lg border border-border/50 p-3 text-center">
          <Clock className="w-5 h-5 mx-auto mb-1 text-primary-400" />
          <div className="text-xl font-bold text-foreground">
            {turnover?.avgHoldingPeriod || 0}d
          </div>
          <div className="text-[10px] text-muted-foreground">Avg Hold</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {turnover?.tradesLast30Days || 0} trades/30d
          </div>
        </div>

        {/* Whipsaw Blocks */}
        <div className={cn(
          'rounded-lg border p-3 text-center',
          whipsawCount > 0 ? 'border-loss/30 bg-loss/5' : 'border-border/50'
        )}>
          <Ban className={cn('w-5 h-5 mx-auto mb-1', whipsawCount > 0 ? 'text-loss' : 'text-muted-foreground')} />
          <div className={cn('text-xl font-bold', whipsawCount > 0 ? 'text-loss' : 'text-foreground')}>
            {whipsawCount}
          </div>
          <div className="text-[10px] text-muted-foreground">Whipsaw Blocks</div>
        </div>

        {/* Laggards */}
        <div className={cn(
          'rounded-lg border p-3 text-center',
          laggardCount > 0 ? 'border-warning/30 bg-warning/5' : 'border-border/50'
        )}>
          <Trash2 className={cn('w-5 h-5 mx-auto mb-1', laggardCount > 0 ? 'text-warning' : 'text-muted-foreground')} />
          <div className={cn('text-xl font-bold', laggardCount > 0 ? 'text-warning' : 'text-foreground')}>
            {laggardCount}
          </div>
          <div className="text-[10px] text-muted-foreground">Laggard Flags</div>
        </div>

        {/* Climax Signals */}
        <div className={cn(
          'rounded-lg border p-3 text-center',
          climaxCount > 0 ? 'border-loss/30 bg-loss/5' : 'border-border/50'
        )}>
          <Flame className={cn('w-5 h-5 mx-auto mb-1', climaxCount > 0 ? 'text-loss' : 'text-muted-foreground')} />
          <div className={cn('text-xl font-bold', climaxCount > 0 ? 'text-loss' : 'text-foreground')}>
            {climaxCount}
          </div>
          <div className="text-[10px] text-muted-foreground">Climax Signals</div>
        </div>
      </div>
    </div>
  );
}
