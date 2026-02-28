/**
 * DEPENDENCIES
 * Consumed by: dual-score.ts, scan-engine.ts
 * Consumes: none (pure function)
 * Risk-sensitive: NO
 * Last modified: 2026-02-28
 * Notes: Hurst Exponent via Rescaled Range (R/S) Analysis.
 *        H > 0.5 = trending (persistent), H ≈ 0.5 = random walk, H < 0.5 = mean-reverting.
 *        Used as a BQS sub-component and soft filter in the scan engine.
 */

const MIN_BARS = 50;

/**
 * Calculate the Hurst Exponent using Rescaled Range (R/S) Analysis.
 *
 * @param prices - Array of closing prices, newest first (scan-engine convention).
 *                 Internally reversed to oldest-first for the calculation.
 * @returns Hurst exponent (0 to 1), or null if fewer than MIN_BARS prices.
 */
export function calcHurst(prices: number[]): number | null {
  if (!prices || prices.length < MIN_BARS) return null;

  // Reverse to oldest-first for time-series analysis
  const series = [...prices].reverse();

  // Convert prices to log returns: ln(P[t] / P[t-1])
  const returns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] <= 0 || series[i] <= 0) continue;
    returns.push(Math.log(series[i] / series[i - 1]));
  }

  if (returns.length < MIN_BARS - 1) return null;

  // Sub-period sizes: powers of 2 that fit within the return series,
  // starting at 8 (minimum meaningful sub-period) up to half the series length.
  const N = returns.length;
  const sizes: number[] = [];
  for (let s = 8; s <= Math.floor(N / 2); s = Math.floor(s * 1.5)) {
    sizes.push(s);
  }
  // Ensure we have at least 3 data points for a meaningful regression
  if (sizes.length < 3) return null;

  const logSizes: number[] = [];
  const logRS: number[] = [];

  for (const size of sizes) {
    const numSegments = Math.floor(N / size);
    if (numSegments < 1) continue;

    let rsSum = 0;
    let validSegments = 0;

    for (let seg = 0; seg < numSegments; seg++) {
      const segment = returns.slice(seg * size, (seg + 1) * size);
      const rs = rescaledRange(segment);
      if (rs !== null && rs > 0) {
        rsSum += rs;
        validSegments++;
      }
    }

    if (validSegments > 0) {
      const avgRS = rsSum / validSegments;
      logSizes.push(Math.log(size));
      logRS.push(Math.log(avgRS));
    }
  }

  // Need at least 3 points for a reliable regression
  if (logSizes.length < 3) return null;

  // Linear regression: log(R/S) = H * log(n) + c
  // Slope H is the Hurst exponent
  const H = linearRegressionSlope(logSizes, logRS);

  // Clamp to [0, 1] — values outside this range indicate numerical issues
  return Math.max(0, Math.min(1, H));
}

/**
 * Compute the Rescaled Range (R/S) for a segment of returns.
 *
 * R/S = (max cumulative deviation - min cumulative deviation) / std deviation
 */
function rescaledRange(segment: number[]): number | null {
  const n = segment.length;
  if (n < 2) return null;

  // Mean of the segment
  const mean = segment.reduce((a, b) => a + b, 0) / n;

  // Standard deviation
  let sumSqDev = 0;
  for (const val of segment) {
    sumSqDev += (val - mean) ** 2;
  }
  const std = Math.sqrt(sumSqDev / n);
  if (std === 0) return null; // flat segment — no information

  // Cumulative deviations from the mean
  let cumDev = 0;
  let maxCum = -Infinity;
  let minCum = Infinity;
  for (const val of segment) {
    cumDev += val - mean;
    if (cumDev > maxCum) maxCum = cumDev;
    if (cumDev < minCum) minCum = cumDev;
  }

  // R/S = range of cumulative deviations / standard deviation
  const R = maxCum - minCum;
  return R / std;
}

/**
 * Simple linear regression slope: y = slope * x + intercept.
 * Returns the slope.
 */
export function linearRegressionSlope(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}
