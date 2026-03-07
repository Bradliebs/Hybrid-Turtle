/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view)
 * Consumes: signal-weight-meta-model.ts (types only)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Horizontal bar chart showing current dynamic weights vs static defaults.
 *        Bars shift left/right from default to show relative over/under-weighting.
 */

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

// Inlined to avoid import chain to server-only market-data.ts
interface SignalWeights {
  adx: number;
  di: number;
  hurst: number;
  bis: number;
  drs: number;
  weeklyAdx: number;
  bps: number;
}

interface SignalWeightPanelProps {
  weights: SignalWeights;
  defaultWeights: SignalWeights;
  regime: string;
  source: string;
}

// ── Signal Labels ────────────────────────────────────────────

const SIGNAL_LABELS: Record<keyof SignalWeights, { label: string; icon: string }> = {
  adx: { label: 'Trend (ADX)', icon: '📈' },
  di: { label: 'Direction (DI)', icon: '🧭' },
  hurst: { label: 'Persistence (Hurst)', icon: '📊' },
  bis: { label: 'Candle Quality (BIS)', icon: '🕯️' },
  drs: { label: 'Market Regime (DRS)', icon: '🌍' },
  weeklyAdx: { label: 'Weekly Trend', icon: '📅' },
  bps: { label: 'Setup Quality (BPS)', icon: '🔧' },
};

// ── Regime Badge ─────────────────────────────────────────────

const regimeStyles: Record<string, { text: string; bg: string }> = {
  TRENDING: { text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  RANGING: { text: 'text-amber-400', bg: 'bg-amber-500/10' },
  VOLATILE: { text: 'text-red-400', bg: 'bg-red-500/10' },
  TRANSITION: { text: 'text-blue-400', bg: 'bg-blue-500/10' },
};

// ── Weight Bar ───────────────────────────────────────────────

function WeightBar({ signal, weight, defaultWeight }: {
  signal: keyof SignalWeights;
  weight: number;
  defaultWeight: number;
}) {
  const { label, icon } = SIGNAL_LABELS[signal];
  const diff = weight - defaultWeight;
  const isUp = diff > 0.005;
  const isDown = diff < -0.005;
  const tooltipText = `${label} weighted ${(weight ?? 0).toFixed(2)} this scan (vs ${(defaultWeight ?? 0).toFixed(2)} baseline)`;

  return (
    <div className="flex items-center gap-2 py-0.5" title={tooltipText}>
      <span className="text-xs flex-shrink-0 w-4 text-center">{icon}</span>
      <span className="text-[11px] text-muted-foreground w-24 truncate">{label}</span>
      <div className="flex-1 h-3 bg-navy-800/60 rounded-full overflow-hidden relative">
        {/* Default position marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-muted-foreground/30 z-10"
          style={{ left: `${defaultWeight * 100 * 5}%` }}
        />
        {/* Current weight fill */}
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            isUp ? 'bg-emerald-500/70' : isDown ? 'bg-amber-500/70' : 'bg-slate-500/50'
          )}
          style={{ width: `${Math.min(weight * 100 * 5, 100)}%` }}
        />
      </div>
      <span className={cn(
        'text-[10px] font-mono w-10 text-right',
        isUp ? 'text-emerald-400' : isDown ? 'text-amber-400' : 'text-muted-foreground'
      )}>
        {((weight ?? 0) * 100).toFixed(0)}%
        {isUp && ' ↑'}
        {isDown && ' ↓'}
      </span>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────

export default function SignalWeightPanel({
  weights,
  defaultWeights,
  regime,
  source,
}: SignalWeightPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const signals: (keyof SignalWeights)[] = ['adx', 'di', 'hurst', 'bis', 'drs', 'weeklyAdx', 'bps'];
  const regimeStyle = regimeStyles[regime] ?? regimeStyles.TRANSITION;

  return (
    <div className="mt-2 px-3 py-2 bg-navy-900/40 rounded-lg border border-border/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Signal Weights
        </span>
        <div className="flex items-center gap-2">
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', regimeStyle.bg, regimeStyle.text)}>
            {regime}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {source === 'learned' ? '🧠' : '📏'}
          </span>
          {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
        </div>
      </button>
      {expanded && (
        <div className="space-y-0 mt-1.5">
          {signals.map(s => (
            <WeightBar
              key={s}
              signal={s}
              weight={weights[s]}
              defaultWeight={defaultWeights[s]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
