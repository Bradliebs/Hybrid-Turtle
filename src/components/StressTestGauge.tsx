/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view)
 * Consumes: adversarial-simulator.ts (types only)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Semi-circular gauge showing adversarial stop-hit probability.
 *        Green (< 15%) → Amber (15–25%) → Red (> 25%).
 *        Shows PASS/FAIL gate status and percentile spread.
 */

'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { STRESS_GATE, classifyStressResult } from '@/lib/prediction/adversarial-simulator';

// ── Types ────────────────────────────────────────────────────

interface StressTestResult {
  stopHitProbability: number;
  gate: 'PASS' | 'FAIL';
  pathsRun: number;
  horizonDays: number;
  percentiles?: {
    p5: number;
    p50: number;
    p95: number;
  };
  avgDaysToStopHit: number | null;
}

interface StressTestGaugeProps {
  /** Ticker for the on-demand stress test API call */
  ticker: string;
  entryPrice: number;
  stopPrice: number;
  atrPercent?: number;
  /** Compact mode for inline display */
  compact?: boolean;
  /** Pre-loaded result (from parent); if provided, skip initial fetch */
  initialResult?: StressTestResult | null;
}

// ── Colour Mapping ───────────────────────────────────────────

const riskStyles = {
  LOW_RISK: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Low Risk' },
  MODERATE_RISK: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Moderate' },
  HIGH_RISK: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'High Risk' },
} as const;

// ── Compact Badge ────────────────────────────────────────────

function CompactBadge({ prob, gate }: { prob: number; gate: 'PASS' | 'FAIL' }) {
  const risk = classifyStressResult(prob);
  const style = riskStyles[risk];
  const pct = Math.round(prob * 100);

  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border', style.bg, style.border, style.text)}>
      {gate === 'FAIL' ? '⛔' : '✓'} {pct}% stop-hit
    </span>
  );
}

// ── Time Ago Helper ──────────────────────────────────────────

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

// ── Main Gauge ───────────────────────────────────────────────

export default function StressTestGauge({
  ticker,
  entryPrice,
  stopPrice,
  atrPercent,
  compact = false,
  initialResult = null,
}: StressTestGaugeProps) {
  const [result, setResult] = useState<StressTestResult | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(initialResult ? Date.now() : null);

  const runStressTest = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ticker,
        entryPrice: String(entryPrice),
        stopPrice: String(stopPrice),
        ...(atrPercent != null ? { atrPercent: String(atrPercent) } : {}),
      });
      const res = await fetch(`/api/prediction/stress-test?${params}`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.data) {
          setResult(json.data);
          setFetchedAt(Date.now());
        }
      }
    } catch {
      // Silent — display no result
    } finally {
      setLoading(false);
    }
  }, [ticker, entryPrice, stopPrice, atrPercent]);

  // No result yet — show run button
  if (!result) {
    return (
      <div className="mt-2 px-3 py-2.5 rounded-lg border bg-navy-900/40 border-border/30">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Stress Test
          </span>
          <button
            onClick={runStressTest}
            disabled={loading}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 transition-colors disabled:opacity-50"
          >
            {loading ? '⏳ Running...' : '▶ Run Stress Test'}
          </button>
        </div>
      </div>
    );
  }

  const { stopHitProbability, gate, pathsRun, horizonDays, percentiles, avgDaysToStopHit } = result;

  if (compact) {
    return <CompactBadge prob={stopHitProbability} gate={gate} />;
  }

  const risk = classifyStressResult(stopHitProbability);
  const style = riskStyles[risk];
  const pct = Math.round(stopHitProbability * 100);

  // Gauge arc: map 0–50% probability to 0–180 degrees
  const angle = Math.min(stopHitProbability / 0.5, 1) * 180;

  return (
    <div className={cn(
      'mt-2 px-3 py-2.5 rounded-lg border',
      gate === 'FAIL' ? 'bg-red-500/5 border-red-500/30' : 'bg-navy-900/40 border-border/30'
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Stress Test
          {fetchedAt && <span className="ml-1.5 text-[9px] font-normal text-muted-foreground/60">({timeAgo(fetchedAt)})</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={runStressTest}
            disabled={loading}
            className="px-1.5 py-0.5 rounded text-[9px] bg-navy-800/60 border border-border/30 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? '⏳' : '↻'} Re-run
          </button>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border', style.bg, style.border, style.text)}>
            {gate === 'FAIL' ? '⛔ FAIL' : '✓ PASS'}
          </span>
        </div>
      </div>

      {/* Gauge and stats */}
      <div className="flex items-center gap-4">
        {/* Semi-circular gauge */}
        <div className="relative w-20 h-10 flex-shrink-0">
          <svg viewBox="0 0 100 55" className="w-full h-full">
            {/* Background arc */}
            <path
              d="M 5 50 A 45 45 0 0 1 95 50"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-navy-800/60"
            />
            {/* Coloured arc — shows probability level */}
            <path
              d="M 5 50 A 45 45 0 0 1 95 50"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeDasharray={`${angle * 0.785} 300`}
              className={style.text}
            />
            {/* Threshold marker at 25% */}
            <line
              x1="50"
              y1="5"
              x2="50"
              y2="12"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-muted-foreground/40"
            />
          </svg>
          {/* Percentage label */}
          <div className="absolute bottom-0 left-0 right-0 text-center">
            <span className={cn('text-sm font-bold', style.text)}>{pct}%</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 text-[10px] text-muted-foreground space-y-0.5">
          <div className="flex justify-between">
            <span>Stop-hit probability</span>
            <span className={cn('font-mono', style.text)}>{pct}%</span>
          </div>
          <div className="flex justify-between">
            <span>Paths simulated</span>
            <span className="font-mono text-foreground">{pathsRun}</span>
          </div>
          <div className="flex justify-between">
            <span>Horizon</span>
            <span className="font-mono text-foreground">{horizonDays}d</span>
          </div>
          {avgDaysToStopHit !== null && (
            <div className="flex justify-between">
              <span>Avg days to stop</span>
              <span className="font-mono text-foreground">{avgDaysToStopHit}d</span>
            </div>
          )}
          {percentiles && entryPrice && (
            <div className="flex justify-between">
              <span>Price range (5th–95th)</span>
              <span className="font-mono text-foreground">
                {(percentiles.p5 ?? 0).toFixed(2)} – {(percentiles.p95 ?? 0).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Gate explanation — Auto-Yes suppressed on FAIL */}
      {gate === 'FAIL' && (
        <div className="mt-1.5 text-[10px] text-red-400/80">
          ⛔ Stress Test: FAIL — {pct}% adversarial stop-hit. Auto-Yes suppressed.
        </div>
      )}
    </div>
  );
}
