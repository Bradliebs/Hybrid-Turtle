/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view)
 * Consumes: /api/prediction/lead-lag (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows upstream assets currently moving that lead the candidate ticker.
 *        Green arrows = confirming move, Red = warning move.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ArrowRight, TrendingUp, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface UpstreamSignal {
  leader: string;
  lag: number;
  correlation: number;
  direction: 'POSITIVE' | 'NEGATIVE';
  recentMove: number;
  significant: boolean;
  adjustment: number;
}

interface LeadLagData {
  ticker: string;
  ncsAdjustment: number;
  upstreamSignals: UpstreamSignal[];
  hasEdges: boolean;
  loading: boolean;
}

// ── Hook ─────────────────────────────────────────────────────

export function useLeadLagSignals(ticker: string | null | undefined): LeadLagData {
  const [data, setData] = useState<LeadLagData>({
    ticker: '',
    ncsAdjustment: 0,
    upstreamSignals: [],
    hasEdges: false,
    loading: !!ticker,
  });

  useEffect(() => {
    if (!ticker) {
      setData(prev => ({ ...prev, loading: false, hasEdges: false }));
      return;
    }

    let cancelled = false;

    const fetchSignals = async () => {
      try {
        const res = await fetch(`/api/prediction/lead-lag?ticker=${encodeURIComponent(ticker)}`);
        if (!res.ok) {
          if (!cancelled) setData(prev => ({ ...prev, loading: false }));
          return;
        }
        const json = await res.json();
        if (cancelled) return;

        if (json.ok && json.data) {
          setData({
            ticker: json.data.ticker,
            ncsAdjustment: json.data.ncsAdjustment,
            upstreamSignals: json.data.upstreamSignals ?? [],
            hasEdges: json.data.hasEdges ?? false,
            loading: false,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchSignals();
    return () => { cancelled = true; };
  }, [ticker]);

  return data;
}

// ── Component ────────────────────────────────────────────────

interface LeadLagPanelProps {
  data: LeadLagData;
}

export default function LeadLagPanel({ data }: LeadLagPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!data.hasEdges || data.upstreamSignals.length === 0) return null;

  const significantSignals = data.upstreamSignals.filter(s => s.significant);
  const hasAdjustment = data.ncsAdjustment !== 0;

  return (
    <div className={cn(
      'mt-2 px-3 py-2 rounded-lg border',
      data.ncsAdjustment > 0 ? 'bg-emerald-500/5 border-emerald-500/20' :
      data.ncsAdjustment < 0 ? 'bg-red-500/5 border-red-500/20' :
      'bg-navy-900/40 border-border/30'
    )}>
      {/* Collapsed summary — clickable to expand */}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between text-left">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ArrowRight className="w-3.5 h-3.5" />
          Lead-Lag: {data.upstreamSignals.length} upstream signal{data.upstreamSignals.length !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1.5">
          {hasAdjustment && (
            <span className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-semibold border',
              data.ncsAdjustment > 0
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            )}>
              {data.ncsAdjustment > 0 ? '+' : ''}{data.ncsAdjustment} NCS
            </span>
          )}
          {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-1.5 space-y-1">
        {data.upstreamSignals.slice(0, 5).map((sig, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            {/* Leader ticker */}
            <span className="font-mono text-foreground w-8">{sig.leader}</span>

            {/* Arrow with direction */}
            <span className={cn(
              'flex items-center gap-0.5',
              sig.recentMove > 0 ? 'text-emerald-400' : sig.recentMove < 0 ? 'text-red-400' : 'text-muted-foreground'
            )}>
              {sig.recentMove > 0 ? <TrendingUp className="w-3 h-3" /> : sig.recentMove < 0 ? <TrendingDown className="w-3 h-3" /> : null}
              {sig.recentMove > 0 ? '+' : ''}{sig.recentMove}%
            </span>

            {/* Lag indicator */}
            <span className="text-muted-foreground">→ {sig.lag}d lag</span>

            {/* Correlation */}
            <span className="text-muted-foreground font-mono">r={sig.correlation}</span>

            {/* Significance badge */}
            {sig.significant && sig.adjustment !== 0 && (
              <span className={cn(
                'px-1 rounded text-[9px] font-mono',
                sig.adjustment > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
              )}>
                {sig.adjustment > 0 ? '+' : ''}{sig.adjustment}
              </span>
            )}
          </div>
        ))}

        {/* Inactive edges note */}
        {significantSignals.length === 0 && data.upstreamSignals.length > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {data.upstreamSignals.length} upstream edges — none currently moving significantly
          </div>
        )}
        </div>
      )}
    </div>
  );
}
