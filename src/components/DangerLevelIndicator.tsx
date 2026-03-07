/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (ambient indicator)
 * Consumes: /api/prediction/danger-level (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Ambient colour-coded indicator showing market danger level.
 *        Green (0–30) → Amber (31–60) → Orange (61–75) → Red (76–100).
 *        When immune alert is active, shows tightening percentage.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Shield, ShieldAlert } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface DangerData {
  dangerScore: number;
  immuneAlert: boolean;
  riskTighteningPercent: number;
  topMatch?: { label: string; similarity: number };
  loading: boolean;
  hasData: boolean;
}

// ── Colour Mapping ───────────────────────────────────────────

function getDangerStyle(score: number) {
  if (score <= 30) return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Safe' };
  if (score <= 60) return { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Elevated' };
  if (score <= 75) return { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', label: 'High' };
  return { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Critical' };
}

// ── Hook ─────────────────────────────────────────────────────

export function useDangerLevel(): DangerData {
  const [data, setData] = useState<DangerData>({
    dangerScore: 0,
    immuneAlert: false,
    riskTighteningPercent: 0,
    loading: true,
    hasData: false,
  });

  useEffect(() => {
    let cancelled = false;

    const fetchDanger = async () => {
      try {
        const res = await fetch('/api/prediction/danger-level');
        if (!res.ok) {
          if (!cancelled) setData(prev => ({ ...prev, loading: false }));
          return;
        }
        const json = await res.json();
        if (cancelled) return;

        if (json.ok && json.data) {
          const d = json.data;
          setData({
            dangerScore: d.dangerScore,
            immuneAlert: d.immuneAlert,
            riskTighteningPercent: d.riskTighteningPercent ?? 0,
            topMatch: d.topMatches?.[0] ? {
              label: d.topMatches[0].label,
              similarity: d.topMatches[0].similarity,
            } : undefined,
            loading: false,
            hasData: true,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchDanger();
    return () => { cancelled = true; };
  }, []);

  return data;
}

// ── Component ────────────────────────────────────────────────

interface DangerLevelIndicatorProps {
  dangerScore: number;
  immuneAlert: boolean;
  riskTighteningPercent: number;
  topMatch?: { label: string; similarity: number };
  /** Compact mode: just a badge */
  compact?: boolean;
}

export default function DangerLevelIndicator({
  dangerScore,
  immuneAlert,
  riskTighteningPercent,
  topMatch,
  compact = false,
}: DangerLevelIndicatorProps) {
  const style = getDangerStyle(dangerScore);

  if (compact) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border', style.bg, style.border, style.text)}
        title={`Danger: ${dangerScore}/100${immuneAlert ? ' — IMMUNE ALERT' : ''}`}
      >
        {immuneAlert ? <ShieldAlert className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {dangerScore}
      </span>
    );
  }

  return (
    <div className={cn(
      'px-3 py-2 rounded-lg border',
      immuneAlert ? 'bg-red-500/5 border-red-500/30' : 'bg-navy-900/40 border-border/30'
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          {immuneAlert ? <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> : <Shield className="w-3.5 h-3.5" />}
          Market Danger
        </span>
        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border', style.bg, style.border, style.text)}>
          {dangerScore}/100 — {style.label}
        </span>
      </div>

      {/* Danger bar */}
      <div className="h-2 bg-navy-800/60 rounded-full overflow-hidden mb-1.5">
        <div
          className={cn('h-full rounded-full transition-all duration-500', style.text.replace('text-', 'bg-').replace('-400', '-500/70'))}
          style={{ width: `${dangerScore}%` }}
        />
      </div>

      {/* Details */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        {topMatch && (
          <span>
            Closest threat: <span className={style.text}>{topMatch.label}</span>
            {' '}({((topMatch.similarity ?? 0) * 100).toFixed(0)}% match)
          </span>
        )}
        {immuneAlert && (
          <span className="text-red-400 font-medium">
            Risk gates tightened by {riskTighteningPercent}%
          </span>
        )}
      </div>
    </div>
  );
}
