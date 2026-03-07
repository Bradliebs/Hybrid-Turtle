/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view)
 * Consumes: /api/prediction/gnn-score (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows GNN graph influence: score, NCS adjustment, top upstream influencers.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Network, ArrowRight } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface GNNScoreData {
  gnnScore: number;
  ncsAdjustment: number;
  modelTrained: boolean;
  topInfluencers: Array<{ ticker: string; weight: number }>;
  /** Timestamp of last model training — used for staleness check */
  trainedAt?: string | null;
  loading: boolean;
  hasResult: boolean;
}

// ── Hook ─────────────────────────────────────────────────────

export function useGNNScore(
  ticker: string | null | undefined,
  ncs?: number,
  volumeRatio?: number,
  atrPct?: number
): GNNScoreData {
  const [data, setData] = useState<GNNScoreData>({
    gnnScore: 0.5,
    ncsAdjustment: 0,
    modelTrained: false,
    topInfluencers: [],
    trainedAt: null,
    loading: !!ticker,
    hasResult: false,
  });

  useEffect(() => {
    if (!ticker) {
      setData(prev => ({ ...prev, loading: false, hasResult: false }));
      return;
    }

    let cancelled = false;

    const fetchScore = async () => {
      try {
        const params = new URLSearchParams({ ticker });
        if (ncs !== undefined) params.set('ncs', String(ncs));
        if (volumeRatio !== undefined) params.set('volumeRatio', String(volumeRatio));
        if (atrPct !== undefined) params.set('atrPct', String(atrPct));

        const res = await fetch(`/api/prediction/gnn-score?${params}`);
        if (!res.ok) {
          if (!cancelled) setData(prev => ({ ...prev, loading: false }));
          return;
        }
        const json = await res.json();
        if (cancelled) return;

        if (json.ok && json.data) {
          const d = json.data;
          setData({
            gnnScore: d.gnnScore,
            ncsAdjustment: d.ncsAdjustment,
            modelTrained: d.modelTrained,
            topInfluencers: d.topInfluencers ?? [],
            trainedAt: d.trainedAt ?? null,
            loading: false,
            hasResult: true,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchScore();
    return () => { cancelled = true; };
  }, [ticker, ncs, volumeRatio, atrPct]);

  return data;
}

// ── Component ────────────────────────────────────────────────

interface GraphScorePanelProps {
  data: GNNScoreData;
  ticker: string;
}

export default function GraphScorePanel({ data, ticker }: GraphScorePanelProps) {
  if (!data.hasResult) return null;

  const isPositive = data.ncsAdjustment > 0;
  const isNegative = data.ncsAdjustment < 0;
  const scorePct = Math.round(data.gnnScore * 100);

  // 7-day staleness check
  const isStale = (() => {
    if (!data.modelTrained || !data.trainedAt) return !data.modelTrained;
    const trainedDate = new Date(data.trainedAt);
    const daysSince = (Date.now() - trainedDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 7;
  })();

  // Spec thresholds: green > 65%, amber 45-65%, grey < 45% or stale
  const scoreColor = isStale ? 'bg-muted-foreground/30'
    : scorePct > 65 ? 'bg-emerald-500/70'
    : scorePct >= 45 ? 'bg-amber-500/70'
    : 'bg-muted-foreground/30';

  const tooltipText = `Based on ${data.topInfluencers.length} upstream nodes moving over last 2 days`;

  return (
    <div className={cn(
      'mt-2 px-3 py-2 rounded-lg border',
      isStale ? 'bg-navy-900/40 border-border/30' :
      isPositive ? 'bg-emerald-500/5 border-emerald-500/20' :
      isNegative ? 'bg-red-500/5 border-red-500/20' :
      'bg-navy-900/40 border-border/30'
    )} title={tooltipText}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Network className="w-3.5 h-3.5" />
          GNN: {scorePct} {scorePct > 65 ? '◉ Network signal strong' : scorePct >= 45 ? '◉ Moderate signal' : '◎ Weak signal'}
        </span>
        <div className="flex items-center gap-2">
          {data.ncsAdjustment !== 0 && (
            <span className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-semibold border',
              isPositive
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            )}>
              NCS {isPositive ? '+' : ''}{data.ncsAdjustment}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            {data.modelTrained ? '🧠' : '📏'}
          </span>
        </div>
      </div>

      {/* Score bar */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] text-muted-foreground w-16">GNN Score</span>
        <div className="flex-1 h-2 bg-navy-800/60 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              scoreColor
            )}
            style={{ width: `${scorePct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
          {scorePct}%
        </span>
      </div>

      {/* Top influencers */}
      {data.topInfluencers.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>Influenced by:</span>
          {data.topInfluencers.map((inf, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <span className="text-border">·</span>}
              <span className="font-mono text-foreground">{inf.ticker}</span>
              <span className="text-[9px]">({((inf.weight ?? 0) * 100).toFixed(0)}%)</span>
            </span>
          ))}
          <ArrowRight className="w-3 h-3 mx-0.5" />
          <span className="font-mono text-foreground">{ticker}</span>
        </div>
      )}

      {!data.modelTrained || isStale ? (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-navy-800/60 border border-border/30 text-muted-foreground/50 line-through">
            UNVALIDATED
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {isStale && data.modelTrained ? 'Model weights > 7 days stale' : 'Scores are baseline until ≥150 outcomes available'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
