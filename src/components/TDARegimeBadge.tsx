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
 */

'use client';

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
    label: 'Transition',
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
  );
}
