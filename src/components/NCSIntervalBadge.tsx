/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx
 * Consumes: conformal-calibrator.ts (types only)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows NCS score with prediction interval and colour-coded confidence band.
 *        Narrow band (width < 8) → green, Medium (8–15) → amber, Wide (>15) → red.
 *        Wide band forces Conditional regardless of point score.
 */

'use client';

import { cn } from '@/lib/utils';
import GlossaryTerm from '@/components/GlossaryTerm';
import type { IntervalConfidence } from '@/lib/prediction/conformal-calibrator';

// ── Types ────────────────────────────────────────────────────

export interface NCSIntervalData {
  point: number;
  lower: number;
  upper: number;
  width: number;
  coverageLevel: number;
}

interface NCSIntervalBadgeProps {
  ncs: number;
  interval: NCSIntervalData | null;
  confidence: IntervalConfidence | null;
  /** Optional: show conformal decision (AUTO_YES / CONDITIONAL / AUTO_NO) */
  decision?: string | null;
  /** Compact mode hides the interval range, shows only badge colour */
  compact?: boolean;
  /** Lead-lag adjusted NCS (if different from raw ncs) */
  leadLagAdjustedNCS?: number | null;
}

/** Returns true when the interval band is wide (LOW confidence), signalling Auto-Yes suppression */
export function shouldSuppressAutoYes(confidence: IntervalConfidence | null): boolean {
  return confidence === 'LOW';
}

// ── Colour Mapping ───────────────────────────────────────────

const confidenceStyles: Record<IntervalConfidence, { text: string; bg: string; border: string; label: string }> = {
  HIGH: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    label: 'High conviction',
  },
  MEDIUM: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    label: 'Moderate certainty',
  },
  LOW: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    label: 'High uncertainty',
  },
};

// ── Component ────────────────────────────────────────────────

export default function NCSIntervalBadge({
  ncs,
  interval,
  confidence,
  decision,
  compact = false,
  leadLagAdjustedNCS = null,
}: NCSIntervalBadgeProps) {
  const adjustment = leadLagAdjustedNCS != null ? Math.round(leadLagAdjustedNCS - ncs) : 0;
  const hasAdjustment = adjustment !== 0 && leadLagAdjustedNCS != null;

  // No calibration data — show plain NCS score (same as before)
  if (!interval || !confidence) {
    return (
      <span className="inline-flex items-center gap-1">
        <GlossaryTerm term="NCS">NCS</GlossaryTerm>:{' '}
        <span className="text-foreground">{Math.round(ncs)}</span>
        {hasAdjustment && (
          <span className="text-blue-400 text-[10px] font-mono" title="Lead-lag cross-asset adjustment">
            → {Math.round(leadLagAdjustedNCS!)} ({adjustment > 0 ? '+' : ''}{adjustment} lead-lag)
          </span>
        )}
      </span>
    );
  }

  const style = confidenceStyles[confidence];

  if (compact) {
    return (
      <span className={cn('inline-flex items-center gap-1')}>
        <GlossaryTerm term="NCS">NCS</GlossaryTerm>:{' '}
        <span className={cn('text-foreground font-medium')}>{Math.round(ncs)}</span>
        {hasAdjustment && (
          <span className="text-blue-400 text-[10px] font-mono">
            → {Math.round(leadLagAdjustedNCS!)}
          </span>
        )}
        <span
          className={cn('inline-block w-2 h-2 rounded-full', style.bg, style.border, 'border')}
          title={`${style.label} — interval width: ${(interval.width ?? 0).toFixed(1)}`}
        />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <GlossaryTerm term="NCS">NCS</GlossaryTerm>:{' '}
      <span className="text-foreground font-medium">{Math.round(ncs)}</span>
      {hasAdjustment && (
        <span className="text-blue-400 text-[10px] font-mono" title="Lead-lag cross-asset adjustment">
          → {Math.round(leadLagAdjustedNCS!)} ({adjustment > 0 ? '+' : ''}{adjustment} lead-lag)
        </span>
      )}
      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-mono border',
          style.bg,
          style.border,
          style.text
        )}
        title={`${Math.round((interval.coverageLevel ?? 0.9) * 100)}% coverage interval — ${style.label}`}
      >
        [{(interval.lower ?? 0).toFixed(1)} – {(interval.upper ?? 0).toFixed(1)}]
      </span>
      {/* Wide band override indicator — Auto-Yes visually suppressed */}
      {confidence === 'LOW' && decision !== 'AUTO_NO' && (
        <span
          className="text-[10px] text-red-400"
          title="Wide interval — Auto-Yes suppressed, treat as Conditional"
        >
          ⚠ High uncertainty
        </span>
      )}
    </span>
  );
}
