/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx
 * Consumes: failure-mode-thresholds.ts (types, labels)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: 5-row table showing each failure mode's score + PASS/WARN/BLOCK badge.
 *        Any BLOCK → red border on the trade card, Auto-Yes suppressed.
 */

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  FAILURE_MODES,
  FM_THRESHOLDS,
  type FailureModeId,
  type FMStatus,
  type FMResult,
} from '@/lib/prediction/failure-mode-thresholds';

// ── Types ────────────────────────────────────────────────────

export interface FailureModePanelProps {
  results: FMResult[];
  /** true if any FM is BLOCK — suppresses Auto-Yes */
  hasBlock: boolean;
  /** Compact mode: collapse bar widths */
  compact?: boolean;
}

// ── Status Styling ───────────────────────────────────────────

const statusStyles: Record<FMStatus, { text: string; bg: string; border: string; label: string }> = {
  PASS: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    label: 'PASS',
  },
  WARN: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    label: 'WARN',
  },
  BLOCK: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    label: 'BLOCK',
  },
};

// ── Score Bar ────────────────────────────────────────────────

function ScoreBar({ score, threshold, status }: { score: number; threshold: number; status: FMStatus }) {
  const pct = Math.min(score, 100);
  const thresholdPct = Math.min(threshold, 100);
  const barColor = status === 'BLOCK' ? 'bg-red-500' : status === 'WARN' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="relative w-full h-2 bg-navy-800/60 rounded-full overflow-hidden">
      {/* Threshold marker */}
      <div
        className="absolute top-0 bottom-0 w-px bg-muted-foreground/40 z-10"
        style={{ left: `${thresholdPct}%` }}
        title={`Threshold: ${threshold}`}
      />
      {/* Score fill */}
      <div
        className={cn('h-full rounded-full transition-all duration-300', barColor)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── FM Row ───────────────────────────────────────────────────

function FMRow({ result }: { result: FMResult }) {
  const info = FAILURE_MODES[result.id];
  const threshold = FM_THRESHOLDS[result.id];
  const style = statusStyles[result.status];

  return (
    <div className="flex items-center gap-2 py-1.5">
      {/* Icon */}
      <span className="text-sm flex-shrink-0 w-5 text-center">{info.icon}</span>

      {/* Name + score bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-xs text-muted-foreground truncate" title={info.description}>
            {info.shortName}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {Math.round(result.score)}
          </span>
        </div>
        <ScoreBar score={result.score} threshold={threshold} status={result.status} />
      </div>

      {/* Status badge */}
      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-semibold border flex-shrink-0',
          style.bg, style.border, style.text
        )}
      >
        {style.label}
      </span>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────

export default function FailureModePanel({ results, hasBlock, compact = false }: FailureModePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (results.length === 0) return null;

  // Sort: BLOCK first, then WARN, then PASS
  const statusOrder: Record<FMStatus, number> = { BLOCK: 0, WARN: 1, PASS: 2 };
  const sorted = [...results].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const warnCount = results.filter(r => r.status === 'WARN').length;
  const blockCount = results.filter(r => r.status === 'BLOCK').length;

  // Summary line for collapsed state
  const summaryText = blockCount > 0
    ? `${blockCount} blocked`
    : warnCount > 0
      ? `${warnCount} warning${warnCount > 1 ? 's' : ''}`
      : 'All clear';
  const summaryIcon = blockCount > 0 ? '⛔' : warnCount > 0 ? '⚠' : '✓';
  const summaryColor = blockCount > 0 ? 'text-red-400' : warnCount > 0 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div
      className={cn(
        'mt-2 px-3 py-2 rounded-lg border',
        hasBlock
          ? 'bg-red-500/5 border-red-500/30'
          : 'bg-navy-900/40 border-border/30'
      )}
    >
      {/* Collapsed summary — always shown, clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Failure Modes
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn('text-[10px] font-medium', summaryColor)}>
            {summaryIcon} {summaryText}
          </span>
          {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-1.5">
          <div className={cn('space-y-0', compact && 'space-y-0')}>
            {sorted.map((r) => (
              <FMRow key={r.id} result={r} />
            ))}
          </div>
          {sorted.filter(r => r.status === 'BLOCK' && r.reason).map(r => (
            <div key={`reason-${r.id}`} className="mt-1 text-[10px] text-red-400/80 flex items-start gap-1">
              <span>⛔</span>
              <span>{FAILURE_MODES[r.id].shortName}: {r.reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* Auto-Yes suppression label when any FM is BLOCK */}
      {hasBlock && (
        <div className="mt-1.5 text-[10px] text-red-400 font-medium">
          ⛔ Auto-Yes suppressed — Blocked: {sorted.filter(r => r.status === 'BLOCK').map(r => `FM${r.id} ${FAILURE_MODES[r.id].shortName}`).join(', ')}
        </div>
      )}
    </div>
  );
}
