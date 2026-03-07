/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (system status bar)
 * Consumes: (standalone — displays props)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Topological Data Analysis regime badge.
 *        Shows whether TDA topology agrees with primary regime detector.
 *        STABLE (green ✓) / TRANSITIONING (amber ⚠) / TURBULENT (red ✗).
 *        transitionWarning = amber pulsing badge for early warning.
 *        Fires TDA_DIVERGENCE alert when transition warning detected.
 */

'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────

export type TDAState = 'STABLE' | 'TRANSITIONING' | 'TURBULENT';

interface TDARegimeBadgeProps {
  state: TDAState;
  /** TDA diverges from primary regime → early warning */
  transitionWarning: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
}

// ── Styles ───────────────────────────────────────────────────

const stateStyles: Record<TDAState, { text: string; bg: string; border: string; icon: string; label: string }> = {
  STABLE: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: '✓',
    label: 'Stable',
  },
  TRANSITIONING: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: '⚠',
    label: 'Transition forming',
  },
  TURBULENT: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: '✗',
    label: 'Turbulent',
  },
};

// ── Component ────────────────────────────────────────────────

export default function TDARegimeBadge({ state, transitionWarning, compact = false }: TDARegimeBadgeProps) {
  const style = stateStyles[state];
  const alertSentRef = useRef(false);

  // Fire TDA_DIVERGENCE alert when transition warning detected (once per mount)
  if (transitionWarning && !alertSentRef.current) {
    alertSentRef.current = true;
    fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'TDA_DIVERGENCE',
        title: 'TDA Regime Divergence',
        message: 'TDA regime divergence detected — possible early transition signal',
        priority: 'WARNING',
      }),
    }).catch(() => { /* non-critical */ });
  }

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border',
          style.bg, style.border, style.text,
          transitionWarning && 'animate-pulse'
        )}
        title={transitionWarning ? 'TDA early warning: topological complexity rising' : `TDA: ${style.label}`}
      >
        TDA {style.icon} {style.label}
      </span>
    );
  }

  return (
    <div>
      <div className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border',
        style.bg, style.border,
        transitionWarning && 'animate-pulse'
      )}>
        <span className={cn('text-xs font-medium', style.text)}>
          TDA {style.icon} {style.label}
        </span>
        {transitionWarning && (
          <span className="text-amber-400 text-[10px]">⚡ Early warning</span>
        )}
      </div>
      {/* Full-width banner when transition warning is active */}
      {transitionWarning && (
        <div className="mt-2 w-full px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-400">
          ⚡ TDA early warning: topological complexity rising while trend indicators positive. Heightened caution advised.
        </div>
      )}
    </div>
  );
}
