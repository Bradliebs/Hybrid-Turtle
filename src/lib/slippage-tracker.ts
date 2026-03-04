/**
 * DEPENDENCIES
 * Consumed by: scan-guards.ts (anti-chase buffer), /api/scan/route.ts
 * Consumes: prisma.ts
 * Risk-sensitive: YES — adjusts anti-chase thresholds which affect entry blocking
 * Last modified: 2026-03-04
 * Notes: Computes historical slippage stats from trade log to dynamically
 *        tighten the anti-chase guard when entries consistently overshoot.
 */

import prisma from '@/lib/prisma';

export interface SlippageStats {
  avgSlippagePct: number;
  medianSlippagePct: number;
  maxSlippagePct: number;
  /** Consistently positive = buying above planned entry */
  slippageDirection: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NONE';
  tradeCount: number;
  /** ATR tightening adjustment (positive = tighten threshold) */
  atrBufferAdjustment: number;
}

const SAMPLE_SIZE = 20;
const SLIPPAGE_THRESHOLD_PCT = 0.15; // Only adjust if avg > 0.15%
const MIN_ATR_THRESHOLD = 0.5; // Floor — never tighten below 0.5 ATR

/**
 * Get slippage statistics from the last 20 completed trades.
 * Used to dynamically tighten the anti-chase guard when entries
 * consistently overshoot planned prices.
 */
export async function getSlippageStats(): Promise<SlippageStats> {
  const trades = await prisma.tradeLog.findMany({
    where: {
      slippagePct: { not: null },
    },
    orderBy: { tradeDate: 'desc' },
    take: SAMPLE_SIZE,
    select: { slippagePct: true },
  });

  if (trades.length === 0) {
    return {
      avgSlippagePct: 0,
      medianSlippagePct: 0,
      maxSlippagePct: 0,
      slippageDirection: 'NONE',
      tradeCount: 0,
      atrBufferAdjustment: 0,
    };
  }

  const values = trades.map(t => t.slippagePct!);
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const max = Math.max(...values.map(Math.abs));
  const positive = values.filter(v => v > 0).length;
  const negative = values.filter(v => v < 0).length;

  let direction: SlippageStats['slippageDirection'] = 'MIXED';
  if (positive > values.length * 0.7) direction = 'POSITIVE';
  else if (negative > values.length * 0.7) direction = 'NEGATIVE';

  // Tighten ATR threshold if consistently overshooting entries
  // avg > 0.15% → subtract from default ATR gap threshold (floor 0.5)
  let atrBufferAdjustment = 0;
  if (avg > SLIPPAGE_THRESHOLD_PCT && direction === 'POSITIVE') {
    atrBufferAdjustment = avg / 100; // Convert to ATR-scale adjustment
  }

  return {
    avgSlippagePct: Math.round(avg * 1000) / 1000,
    medianSlippagePct: Math.round(median * 1000) / 1000,
    maxSlippagePct: Math.round(max * 1000) / 1000,
    slippageDirection: direction,
    tradeCount: values.length,
    atrBufferAdjustment: Math.round(atrBufferAdjustment * 10000) / 10000,
  };
}

/**
 * Apply slippage buffer to an ATR gap threshold.
 * Tightens the threshold when historical slippage is consistently positive.
 * Floored at MIN_ATR_THRESHOLD to prevent over-tightening.
 */
export function applySlippageBuffer(
  baseThresholdATR: number,
  slippageBuffer: number
): number {
  if (slippageBuffer <= 0) return baseThresholdATR;
  const adjusted = baseThresholdATR - slippageBuffer;
  const result = Math.max(adjusted, MIN_ATR_THRESHOLD);
  if (result < baseThresholdATR) {
    console.info(`[AntiChase] Guard tightened by slippage buffer: ${baseThresholdATR.toFixed(3)} → ${result.toFixed(3)} ATR`);
  }
  return result;
}
