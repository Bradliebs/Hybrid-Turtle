'use client';

import { cn } from '@/lib/utils';
import { formatCurrency, formatPrice, formatPercent, formatR } from '@/lib/utils';
import StatusBadge from '@/components/shared/StatusBadge';
import { Zap } from 'lucide-react';

interface Candidate {
  ticker: string;
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
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ticker</th>
            <th>Sleeve</th>
            <th>Status</th>
            <th className="text-right">Price</th>
            <th className="text-right">Entry Trigger</th>
            <th className="text-right">Stop Price</th>
            <th className="text-right">Distance%</th>
            <th className="text-right">Rank</th>
            {showSizing && (
              <>
                <th className="text-right">Shares</th>
                <th className="text-right">Total Cost</th>
                <th className="text-right">Risk $</th>
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
                  {isTriggered ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      TRIGGERED
                    </span>
                  ) : (
                    <StatusBadge status={c.status} />
                  )}
                </td>
                <td className="text-right font-mono text-sm">{formatPrice(c.price, c.priceCurrency)}</td>
                <td className="text-right font-mono text-sm text-primary-400">
                  {formatPrice(c.entryTrigger, c.priceCurrency)}
                </td>
                <td className="text-right font-mono text-sm text-loss">
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
                <td className="text-right font-mono text-sm text-foreground">
                  {c.rankScore.toFixed(1)}
                </td>
                {showSizing && (
                  <>
                    <td className="text-right font-mono text-sm">{c.shares ?? '—'}</td>
                    <td className="text-right font-mono text-sm">
                      {c.totalCost ? formatPrice(c.totalCost, c.priceCurrency) : '—'}
                    </td>
                    <td className="text-right font-mono text-sm text-loss">
                      {c.riskDollars ? formatPrice(c.riskDollars, c.priceCurrency) : '—'}
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
