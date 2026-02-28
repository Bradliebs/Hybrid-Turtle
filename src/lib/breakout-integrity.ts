/**
 * DEPENDENCIES
 * Consumed by: market-data.ts, snapshot-sync.ts, dual-score.ts (via bis_score field)
 * Consumes: (standalone — no internal imports)
 * Risk-sensitive: NO
 * Last modified: 2026-02-24
 * Notes: Pure scoring function. Measures how "clean" a breakout candle is.
 *        Score feeds into BQS as the bqs_bis sub-component (0–15 points).
 */

// ── Candle shape required for BIS calculation ────────────────
export interface BISCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Breakout Integrity Score (BIS) — 0 to 15.
 *
 * Three sub-components measuring candle quality on the breakout bar:
 *   1. Body-to-range ratio  (0 / +2 / +5)  — conviction via candle body size
 *   2. Volume vs 10-day avg (0 / +3 / +5)  — institutional participation
 *   3. Close position       (0 / +2 / +5)  — bulls held into the close
 *
 * Returns 0 for degenerate candles (zero range, zero volume, missing data).
 */
export function calcBIS(candle: BISCandle, avgVolume: number): number {
  if (!candle || !Number.isFinite(candle.high) || !Number.isFinite(candle.low)) return 0;

  const range = candle.high - candle.low;
  if (range <= 0) return 0; // zero-range bar (e.g. halted stock)

  // 1. Body-to-range ratio — large body = decisive move, not a doji
  const body = Math.abs(candle.close - candle.open);
  const bodyRatio = body / range;
  let bodyScore = 0;
  if (bodyRatio > 0.6) bodyScore = 5;
  else if (bodyRatio >= 0.4) bodyScore = 2;

  // 2. Volume vs 10-day average — confirms institutional participation
  let volumeScore = 0;
  if (avgVolume > 0 && Number.isFinite(candle.volume) && candle.volume > 0) {
    const volPct = candle.volume / avgVolume;
    if (volPct > 1.5) volumeScore = 5;
    else if (volPct >= 1.0) volumeScore = 2;
  }

  // 3. Close position in bar range — close in top 30% = bulls in control
  const closePosition = (candle.close - candle.low) / range;
  let closeScore = 0;
  if (closePosition >= 0.7) closeScore = 5;        // top 30%
  else if (closePosition >= 0.3) closeScore = 2;   // middle 40%
  // bottom 30% = 0

  return bodyScore + volumeScore + closeScore;
}
