/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (ticker card grade pill), TradePulse dashboard
 * Consumes: trade-pulse.ts (types + grade styles)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Small grade pill (A+ / A / B / C / D) for ticker card display.
 *        Also used as the hero element on the TradePulse dashboard.
 */

'use client';

import { cn } from '@/lib/utils';
import { GRADE_STYLES, type TradePulseGrade } from '@/lib/prediction/trade-pulse';

// ── Grade Pill (for ticker cards) ────────────────────────────

interface TradePulseGradePillProps {
  grade: TradePulseGrade;
  score?: number;
  compact?: boolean;
}

export function TradePulseGradePill({ grade, score, compact = false }: TradePulseGradePillProps) {
  const style = GRADE_STYLES[grade];

  if (compact) {
    return (
      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold border', style.bg, style.border, style.text)}>
        {grade}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border', style.bg, style.border, style.text)}>
      {grade}
      {score !== undefined && (
        <span className="font-mono text-[10px] opacity-70">{score}</span>
      )}
    </span>
  );
}

// ── Score Dial (for dashboard hero) ──────────────────────────

interface TradePulseDialProps {
  score: number;
  grade: TradePulseGrade;
  decision: string;
}

export function TradePulseDial({ score, grade, decision }: TradePulseDialProps) {
  const style = GRADE_STYLES[grade];
  const angle = (score / 100) * 180; // 0–180 degree arc

  const decisionStyles: Record<string, { text: string; bg: string }> = {
    AUTO_YES: { text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    CONDITIONAL: { text: 'text-amber-400', bg: 'bg-amber-500/10' },
    AUTO_NO: { text: 'text-red-400', bg: 'bg-red-500/10' },
  };
  const decStyle = decisionStyles[decision] ?? decisionStyles.CONDITIONAL;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Semi-circular gauge */}
      <div className="relative w-40 h-20">
        <svg viewBox="0 0 200 110" className="w-full h-full">
          {/* Background arc */}
          <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" stroke="currentColor" strokeWidth="12" className="text-navy-800/60" />
          {/* Score arc */}
          <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" stroke="currentColor" strokeWidth="12"
            strokeDasharray={`${angle * 1.57} 600`} className={style.text} />
        </svg>
        {/* Center score */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className={cn('text-3xl font-bold', style.text)}>{score}</span>
        </div>
      </div>

      {/* Grade + Decision */}
      <div className="flex items-center gap-3">
        <span className={cn('px-3 py-1 rounded-lg text-lg font-bold border', style.bg, style.border, style.text)}>
          {grade}
        </span>
        <span className={cn('px-3 py-1 rounded-lg text-sm font-medium', decStyle.bg, decStyle.text)}>
          {decision.replace('_', '-')}
        </span>
      </div>
    </div>
  );
}
