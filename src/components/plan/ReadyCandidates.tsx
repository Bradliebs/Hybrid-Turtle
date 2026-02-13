'use client';

import StatusBadge from '@/components/shared/StatusBadge';
import { cn, formatCurrency, formatPercent } from '@/lib/utils';
import { ArrowUpRight, Clock, Target, CheckCircle2, AlertTriangle, Crosshair, BarChart3, Briefcase, Zap } from 'lucide-react';

interface Candidate {
  ticker: string;
  name: string;
  sleeve: string;
  status: string;
  price: number;
  entryTrigger: number;
  stopPrice: number;
  distancePercent: number;
  shares?: number;
  riskDollars?: number;
  // Cross-ref enrichment
  matchType?: 'BOTH_RECOMMEND' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'CONFLICT';
  agreementScore?: number;
  dualNCS?: number | null;
  dualBQS?: number | null;
  dualFWS?: number | null;
  dualAction?: string | null;
  scanRankScore?: number | null;
  scanPassesFilters?: boolean | null;
}

interface ReadyCandidatesProps {
  candidates: Candidate[];
  heldTickers?: Set<string>;
}

const matchTypeBadge: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  BOTH_RECOMMEND: { label: 'CONFIRMED', color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle2 },
  SCAN_ONLY: { label: '7-STAGE', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30', icon: Crosshair },
  DUAL_ONLY: { label: 'DUAL', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30', icon: BarChart3 },
  CONFLICT: { label: 'CONFLICT', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30', icon: AlertTriangle },
};

export default function ReadyCandidates({ candidates, heldTickers = new Set() }: ReadyCandidatesProps) {
  const ready = candidates.filter(c => c.status === 'READY');
  const watch = candidates.filter(c => c.status === 'WATCH');

  // Sort: BOTH_RECOMMEND first, then by agreement score
  const sortedReady = [...ready].sort((a, b) => {
    // Trigger-met candidates first
    const aTriggerMet = a.price > 0 && a.entryTrigger > 0 && a.price >= a.entryTrigger ? 1 : 0;
    const bTriggerMet = b.price > 0 && b.entryTrigger > 0 && b.price >= b.entryTrigger ? 1 : 0;
    if (bTriggerMet !== aTriggerMet) return bTriggerMet - aTriggerMet;
    const typeOrder: Record<string, number> = { BOTH_RECOMMEND: 0, SCAN_ONLY: 1, DUAL_ONLY: 2, CONFLICT: 3 };
    const oa = typeOrder[a.matchType || 'SCAN_ONLY'] ?? 4;
    const ob = typeOrder[b.matchType || 'SCAN_ONLY'] ?? 4;
    if (oa !== ob) return oa - ob;
    return (b.agreementScore || 0) - (a.agreementScore || 0);
  });

  const bothCount = ready.filter(c => c.matchType === 'BOTH_RECOMMEND').length;
  const triggerMetCount = ready.filter(c => c.price > 0 && c.entryTrigger > 0 && c.price >= c.entryTrigger).length;

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-profit" />
          Ready Candidates
        </h3>
        <span className="text-xs text-muted-foreground">
          {ready.length} ready{bothCount > 0 ? ` (${bothCount} confirmed)` : ''}{triggerMetCount > 0 ? ` · ${triggerMetCount} triggered` : ''}
        </span>
      </div>

      {/* Source indicator */}
      <div className="flex items-center gap-2 mb-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Crosshair className="w-3 h-3 text-blue-400" /> 7-Stage Scan
        </span>
        <span>×</span>
        <span className="flex items-center gap-1">
          <BarChart3 className="w-3 h-3 text-purple-400" /> Dual Scores
        </span>
        <span>×</span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Cross-Ref
        </span>
      </div>

      {sortedReady.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No candidates ready for entry
          <p className="text-xs mt-1 opacity-75">Run a scan to populate candidates</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedReady.map((c) => {
            const badge = matchTypeBadge[c.matchType || 'SCAN_ONLY'] || matchTypeBadge.SCAN_ONLY;
            const BadgeIcon = badge.icon;
            const isHeld = heldTickers.has(c.ticker);
            const isTriggerMet = c.price > 0 && c.entryTrigger > 0 && c.price >= c.entryTrigger;
            return (
              <div
                key={c.ticker}
                className={cn(
                  "bg-navy-800 rounded-lg p-3 border relative",
                  isTriggerMet
                    ? 'border-amber-400/60 ring-2 ring-amber-400/30 animate-pulse'
                    : isHeld
                      ? 'border-primary-400/40 ring-1 ring-primary-400/20'
                      : c.matchType === 'BOTH_RECOMMEND'
                        ? 'border-emerald-500/30'
                        : c.matchType === 'CONFLICT'
                          ? 'border-amber-500/20'
                          : 'border-profit/20'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-profit font-bold">{c.ticker}</span>
                    <StatusBadge status={c.status} />
                    {isHeld && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border text-primary-400 bg-primary-500/15 border-primary-500/30">
                        <Briefcase className="w-3 h-3" />
                        HELD
                      </span>
                    )}
                    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border", badge.color)}>
                      <BadgeIcon className="w-3 h-3" />
                      {badge.label}
                    </span>
                    {isTriggerMet && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border text-amber-400 bg-amber-500/15 border-amber-500/40">
                        <AlertTriangle className="w-3 h-3" />
                        TRIGGER MET
                      </span>
                    )}
                  </div>
                  {c.matchType === 'BOTH_RECOMMEND' && !isHeld ? (
                    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-navy-900 transition-colors">
                      <Zap className="w-3.5 h-3.5" />
                      BUY
                    </button>
                  ) : (
                    <ArrowUpRight className="w-4 h-4 text-profit" />
                  )}
                </div>

                {/* Sleeve + rank info */}
                <div className="flex items-center gap-2 mb-2 text-[10px]">
                  <span className="text-muted-foreground">{c.sleeve}</span>
                  {c.scanRankScore != null && (
                    <span className="text-muted-foreground">Rank: {c.scanRankScore.toFixed(0)}</span>
                  )}
                  {c.agreementScore != null && (
                    <span className={cn(
                      "font-medium",
                      c.agreementScore >= 70 ? 'text-emerald-400' : c.agreementScore >= 40 ? 'text-amber-400' : 'text-red-400'
                    )}>
                      Agreement: {c.agreementScore}%
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Price</span>
                    <div className="font-mono text-foreground">{formatCurrency(c.price)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Trigger</span>
                    <div className="font-mono text-warning">{formatCurrency(c.entryTrigger)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Distance</span>
                    <div className="font-mono text-profit">{formatPercent(c.distancePercent)}</div>
                  </div>
                </div>

                {/* Dual Score bar */}
                {c.dualNCS != null && (
                  <div className="mt-2 pt-2 border-t border-navy-600">
                    <div className="flex items-center justify-between text-[10px] mb-1">
                      <span className="text-muted-foreground">Dual Score</span>
                      <div className="flex items-center gap-2">
                        <span className={cn("font-mono font-medium", c.dualNCS >= 70 ? 'text-emerald-400' : c.dualNCS >= 40 ? 'text-amber-400' : 'text-red-400')}>
                          NCS {c.dualNCS?.toFixed(0)}
                        </span>
                        {c.dualBQS != null && (
                          <span className="text-muted-foreground font-mono">BQS {c.dualBQS.toFixed(0)}</span>
                        )}
                        {c.dualFWS != null && (
                          <span className={cn("font-mono", c.dualFWS <= 30 ? 'text-emerald-400' : 'text-red-400')}>
                            FWS {c.dualFWS.toFixed(0)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-navy-700 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          c.dualNCS >= 70 ? 'bg-emerald-500' : c.dualNCS >= 40 ? 'bg-amber-500' : 'bg-red-500'
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, c.dualNCS))}%` }}
                      />
                    </div>
                    {c.dualAction && (
                      <div className="text-[10px] text-muted-foreground mt-1 italic">
                        {c.dualAction}
                      </div>
                    )}
                  </div>
                )}

                {c.shares && (
                  <div className="mt-2 pt-2 border-t border-navy-600 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Shares</span>
                      <div className="font-mono text-foreground">{c.shares}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Risk $</span>
                      <div className="font-mono text-loss">{formatCurrency(c.riskDollars || 0)}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}


    </div>
  );
}
