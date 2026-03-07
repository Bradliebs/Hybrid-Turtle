/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (ambient indicator), Navbar (persistent)
 * Consumes: /api/prediction/danger-level (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: 5-segment danger indicator with click-to-open drawer.
 *        Segments: Normal / Guarded / Elevated / High / Danger Zone.
 *        When dangerScore > 75: amber tinting. > 90: full-width banner.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Shield, ShieldAlert, X } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface DangerData {
  dangerScore: number;
  immuneAlert: boolean;
  riskTighteningPercent: number;
  topMatches: Array<{ label: string; similarity: number; factors?: string[] }>;
  loading: boolean;
  hasData: boolean;
}

// ── 5-Segment Mapping ───────────────────────────────────────

function getDangerSegments(score: number): { filled: number; label: string; color: string } {
  if (score <= 20) return { filled: 1, label: 'Normal', color: 'text-emerald-400' };
  if (score <= 40) return { filled: 2, label: 'Guarded', color: 'text-blue-400' };
  if (score <= 60) return { filled: 3, label: 'Elevated Risk ⚠', color: 'text-amber-400' };
  if (score <= 80) return { filled: 4, label: 'High Risk', color: 'text-orange-400' };
  return { filled: 5, label: 'Danger Zone 🔴', color: 'text-red-400' };
}

function getDangerStyle(score: number) {
  if (score <= 20) return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Normal' };
  if (score <= 40) return { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Guarded' };
  if (score <= 60) return { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Elevated' };
  if (score <= 80) return { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', label: 'High' };
  return { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Critical' };
}

// ── Hook ─────────────────────────────────────────────────────

export function useDangerLevel(): DangerData {
  const [data, setData] = useState<DangerData>({
    dangerScore: 0,
    immuneAlert: false,
    riskTighteningPercent: 0,
    topMatches: [],
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
            topMatches: (d.topMatches ?? []).slice(0, 3).map((m: { label: string; similarity: number; factors?: string[] }) => ({
              label: m.label,
              similarity: m.similarity,
              factors: m.factors ?? [],
            })),
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
  topMatches?: Array<{ label: string; similarity: number; factors?: string[] }>;
  /** Compact mode: just a badge */
  compact?: boolean;
}

export default function DangerLevelIndicator({
  dangerScore,
  immuneAlert,
  riskTighteningPercent,
  topMatches = [],
  compact = false,
}: DangerLevelIndicatorProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const style = getDangerStyle(dangerScore);
  const segments = getDangerSegments(dangerScore);

  if (compact) {
    return (
      <button
        onClick={() => setDrawerOpen(true)}
        className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer', style.bg, style.border, style.text)}
        title={`Danger: ${dangerScore}/100${immuneAlert ? ' — IMMUNE ALERT' : ''}`}
      >
        {immuneAlert ? <ShieldAlert className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {/* 5-segment indicator */}
        <span className="flex gap-px">
          {[1, 2, 3, 4, 5].map(i => (
            <span key={i} className={cn('w-1.5 h-2.5 rounded-sm', i <= segments.filled ? 'bg-current' : 'bg-muted-foreground/20')} />
          ))}
        </span>
      </button>
    );
  }

  return (
    <>
      <div className={cn(
        'px-3 py-2 rounded-lg border cursor-pointer',
        immuneAlert ? 'bg-red-500/5 border-red-500/30' : 'bg-navy-900/40 border-border/30'
      )} onClick={() => setDrawerOpen(true)}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            {immuneAlert ? <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> : <Shield className="w-3.5 h-3.5" />}
            Market Danger
          </span>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border', style.bg, style.border, style.text)}>
            {dangerScore}/100 — {segments.label}
          </span>
        </div>

        {/* 5-segment indicator bar */}
        <div className="flex gap-1 mb-1.5">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={cn(
              'flex-1 h-2 rounded-sm transition-all duration-300',
              i <= segments.filled
                ? segments.filled <= 1 ? 'bg-emerald-500/70'
                  : segments.filled <= 2 ? 'bg-blue-500/70'
                  : segments.filled <= 3 ? 'bg-amber-500/70'
                  : segments.filled <= 4 ? 'bg-orange-500/70'
                  : 'bg-red-500/70'
                : 'bg-navy-800/60'
            )} />
          ))}
        </div>

        {/* Details */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          {topMatches[0] && (
            <span>
              Closest threat: <span className={style.text}>{topMatches[0].label}</span>
              {' '}({Math.round((topMatches[0].similarity ?? 0) * 100)}% match)
            </span>
          )}
          {immuneAlert && (
            <span className="text-red-400 font-medium">
              Risk gates tightened by {riskTighteningPercent}%
            </span>
          )}
        </div>
      </div>

      {/* Drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-md bg-navy-900 border-l border-border p-6 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-400" />
                Market Danger Detail
              </h2>
              <button onClick={() => setDrawerOpen(false)} className="text-muted-foreground hover:text-foreground" title="Close drawer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Score */}
            <div className="mb-6">
              <div className={cn('text-4xl font-bold', style.text)}>{dangerScore}<span className="text-lg text-muted-foreground">/100</span></div>
              <div className={cn('text-sm font-medium mt-1', segments.color)}>{segments.label}</div>
            </div>

            {/* Top threat matches */}
            {topMatches.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">Closest Threat Library Matches</h3>
                <div className="space-y-3">
                  {topMatches.map((match, i) => (
                    <div key={i} className="p-3 rounded-lg bg-navy-800/60 border border-border/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground">{match.label}</span>
                        <span className={cn('text-xs font-mono', style.text)}>{Math.round((match.similarity ?? 0) * 100)}% match</span>
                      </div>
                      {match.factors && match.factors.length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Factors: {match.factors.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk tightening */}
            {immuneAlert && (
              <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <div className="text-sm text-red-400 font-medium mb-1">Immune System Active</div>
                <div className="text-xs text-muted-foreground">Risk gates tightened by {riskTighteningPercent}%</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
