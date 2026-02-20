'use client';

import { cn } from '@/lib/utils';
import { formatCurrency, formatPrice, formatPercent, formatR } from '@/lib/utils';
import StatusBadge from '@/components/shared/StatusBadge';
import { Zap } from 'lucide-react';

interface Candidate {
  ticker: string;
  yahooTicker?: string;
  name: string;
  sleeve: string;
  status: string;
  price: number;
  priceCurrency?: string;
  entryTrigger: number;
  stopPrice: number;
  rankScore: number;
  distancePercent: number;
  shares?: number;
  riskDollars?: number;
  totalCost?: number;
  passesAllFilters: boolean;
  pullbackSignal?: {
    triggered: boolean;
    mode: 'BREAKOUT' | 'PULLBACK_CONTINUATION';
    reason: string;
  };
}

interface CandidateTableProps {
  candidates: Candidate[];
  showSizing?: boolean;
}

export default function CandidateTable({ candidates, showSizing = false }: CandidateTableProps) {
  const triggered = candidates.filter(c => c.passesAllFilters && c.distancePercent <= 0);

  return (
    <div className="card-surface overflow-x-auto">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Candidates ({candidates.length})
        </h3>
        {triggered.length > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-bold animate-pulse">
            <Zap className="w-3.5 h-3.5" />
            {triggered.length} TRIGGERED — READY TO BUY
          </span>
        )}
      </div>
      <table className={cn('data-table', showSizing ? 'min-w-[1200px]' : 'min-w-[900px]')}>
        <thead>
          <tr>
            <th className="whitespace-nowrap">#</th>
            <th className="whitespace-nowrap">Ticker</th>
            <th className="whitespace-nowrap">Sleeve</th>
            <th className="whitespace-nowrap">Status</th>
            <th className="text-right whitespace-nowrap">Price</th>
            <th className="text-right whitespace-nowrap">Entry Trigger</th>
            <th className="text-right whitespace-nowrap">Stop Price</th>
            <th className="text-right whitespace-nowrap">Distance%</th>
            <th className="text-right whitespace-nowrap">Rank</th>
            {showSizing && (
              <>
                <th className="text-right whitespace-nowrap">Shares</th>
                <th className="text-right whitespace-nowrap">Total Cost</th>
                <th className="text-right whitespace-nowrap">Risk $</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => {
            const isTriggered = c.passesAllFilters && c.distancePercent <= 0;
            return (
              <tr
                key={c.ticker}
                className={cn(
                  !c.passesAllFilters && 'opacity-40',
                  isTriggered && 'bg-emerald-500/10 border-l-2 border-l-emerald-400'
                )}
              >
                <td className="text-muted-foreground font-mono text-sm">{i + 1}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <div>
                      <span className={cn(
                        'font-semibold',
                        isTriggered ? 'text-emerald-400' : 'text-primary-400'
                      )}>
                        {c.ticker}
                      </span>
                      {c.yahooTicker && c.yahooTicker !== c.ticker && (
                        <span className="text-muted-foreground text-[10px] ml-1">({c.yahooTicker})</span>
                      )}
                      <div className="text-xs text-muted-foreground">{c.name}</div>
                    </div>
                    {isTriggered && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                        <Zap className="w-3 h-3" />
                        BUY
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <StatusBadge status={c.sleeve} />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    {isTriggered ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        TRIGGERED
                      </span>
                    ) : (
                      <StatusBadge status={c.status} />
                    )}
                    {c.pullbackSignal?.triggered && c.pullbackSignal.mode === 'PULLBACK_CONTINUATION' && (
                      <span
                        title={c.pullbackSignal.reason}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      >
                        MODE B
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-right font-mono text-sm whitespace-nowrap">{formatPrice(c.price, c.priceCurrency)}</td>
                <td className="text-right font-mono text-sm text-primary-400 whitespace-nowrap">
                  {formatPrice(c.entryTrigger, c.priceCurrency)}
                </td>
                <td className="text-right font-mono text-sm text-loss whitespace-nowrap">
                  {formatPrice(c.stopPrice, c.priceCurrency)}
                </td>
                <td className="text-right">
                  {isTriggered ? (
                    <span className="inline-flex items-center gap-1 font-mono text-sm font-bold text-emerald-400">
                      ABOVE
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'font-mono text-sm',
                        c.distancePercent <= 2 ? 'text-profit' :
                        c.distancePercent <= 5 ? 'text-warning' :
                        'text-loss'
                      )}
                    >
                      {formatPercent(c.distancePercent, 1)}
                    </span>
                  )}
                </td>
                <td className="text-right font-mono text-sm text-foreground whitespace-nowrap">
                  {c.rankScore.toFixed(1)}
                </td>
                {showSizing && (
                  <>
                    <td className="text-right font-mono text-sm whitespace-nowrap">{c.shares ?? '—'}</td>
                    <td className="text-right font-mono text-sm whitespace-nowrap">
                      {c.totalCost != null ? formatPrice(c.totalCost, c.priceCurrency) : '—'}
                    </td>
                    <td className="text-right font-mono text-sm text-loss whitespace-nowrap">
                      {c.riskDollars != null ? formatPrice(c.riskDollars, c.priceCurrency) : '—'}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
