/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view)
 * Consumes: /api/signals/sentiment (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows sentiment breakdown by source + divergence warning.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { MessageSquare, AlertTriangle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface SentimentData {
  scs: number;
  signal: string;
  ncsAdjustment: number;
  divergenceDetected: boolean;
  sources: { newsScore: number; revisionScore: number; shortScore: number } | null;
  loading: boolean;
  hasResult: boolean;
}

// ── Hook ─────────────────────────────────────────────────────

export function useSentiment(ticker: string | null | undefined): SentimentData {
  const [data, setData] = useState<SentimentData>({
    scs: 50, signal: 'NEUTRAL', ncsAdjustment: 0, divergenceDetected: false,
    sources: null, loading: !!ticker, hasResult: false,
  });

  useEffect(() => {
    if (!ticker) { setData(prev => ({ ...prev, loading: false })); return; }
    let cancelled = false;

    const fetchSentiment = async () => {
      try {
        const res = await fetch(`/api/signals/sentiment?ticker=${encodeURIComponent(ticker)}`);
        if (!res.ok) { if (!cancelled) setData(prev => ({ ...prev, loading: false })); return; }
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.data) {
          const d = json.data;
          setData({
            scs: d.scs, signal: d.signal, ncsAdjustment: d.ncsAdjustment,
            divergenceDetected: d.divergenceDetected,
            sources: d.sources ?? null,
            loading: false, hasResult: true,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchSentiment();
    return () => { cancelled = true; };
  }, [ticker]);

  return data;
}

// ── Signal Styles ────────────────────────────────────────────

const signalStyles: Record<string, { text: string; bg: string; border: string }> = {
  VERY_BULLISH: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  BULLISH: { text: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20' },
  NEUTRAL: { text: 'text-muted-foreground', bg: 'bg-navy-800/40', border: 'border-border/30' },
  BEARISH: { text: 'text-red-400', bg: 'bg-red-500/5', border: 'border-red-500/20' },
  VERY_BEARISH: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
};

// ── Source Bar ────────────────────────────────────────────────

function SourceBar({ label, score }: { label: string; score: number }) {
  const pct = score;
  const color = score >= 60 ? 'bg-emerald-500/70' : score <= 40 ? 'bg-red-500/70' : 'bg-muted-foreground/30';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16 text-right">{label}</span>
      <div className="flex-1 h-2 bg-navy-800/60 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-6">{score}</span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

interface SentimentPanelProps {
  data: SentimentData;
  /** Trade classification — only show on CONDITIONAL trades */
  tradeClassification?: string;
}

export default function SentimentPanel({ data, tradeClassification }: SentimentPanelProps) {
  if (!data.hasResult) return null;

  // Only show on CONDITIONAL trades (hide on Auto-Yes, Auto-No)
  if (tradeClassification && tradeClassification !== 'CONDITIONAL') return null;

  // Low confidence: no badge shown
  if (data.scs != null && data.scs < 30) return null;

  const style = signalStyles[data.signal] ?? signalStyles.NEUTRAL;

  // Determine text label
  const signalLabel = data.signal === 'VERY_BULLISH' || data.signal === 'BULLISH'
    ? 'Sentiment ↑'
    : data.signal === 'VERY_BEARISH' || data.signal === 'BEARISH'
    ? 'Sentiment ↓'
    : 'Mixed signals';

  return (
    <div className={cn(
      'mt-2 px-3 py-2 rounded-lg border',
      data.divergenceDetected ? 'bg-amber-500/5 border-amber-500/20' : `${style.bg} ${style.border}`
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          {signalLabel}
        </span>
        <div className="flex items-center gap-2">
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border', style.bg, style.border, style.text)}>
            SCS {data.scs}
          </span>
          {data.ncsAdjustment !== 0 && (
            <span className={cn('text-[10px] font-mono',
              data.ncsAdjustment > 0 ? 'text-emerald-400' : 'text-red-400'
            )}>
              NCS{data.ncsAdjustment > 0 ? '+' : ''}{data.ncsAdjustment}
            </span>
          )}
        </div>
      </div>

      {/* Source breakdown */}
      {data.sources && (
        <div className="space-y-0.5 mb-1">
          <SourceBar label="News" score={data.sources.newsScore} />
          <SourceBar label="Analyst" score={data.sources.revisionScore} />
          <SourceBar label="Short Int." score={data.sources.shortScore} />
        </div>
      )}

      {/* Divergence warning */}
      {data.divergenceDetected && (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-400">
          <AlertTriangle className="w-3 h-3" />
          Sentiment-price divergence: falling sentiment + rising price — false breakout risk
        </div>
      )}
    </div>
  );
}
