import { describe, expect, it } from 'vitest';
import { calcHurst, linearRegressionSlope } from './hurst';

// ── Helper: generate a synthetic trending (persistent) series ──
// Cumulative sum of positively-biased random steps → H > 0.5
function generateTrendingSeries(length: number, seed = 42): number[] {
  let price = 100;
  const prices: number[] = [];
  let rng = seed;
  for (let i = 0; i < length; i++) {
    // Simple pseudo-random with upward drift
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((rng % 1000) / 1000 - 0.3) * 0.02; // biased positive
    price *= 1 + noise;
    prices.push(price);
  }
  // Return newest-first (scan-engine convention)
  return prices.reverse();
}

// ── Helper: generate a mean-reverting series ──
// Ornstein-Uhlenbeck-like process → H < 0.5
function generateMeanRevertingSeries(length: number, seed = 42): number[] {
  const mean = 100;
  let price = mean;
  const prices: number[] = [];
  let rng = seed;
  const revertSpeed = 0.3; // strong mean reversion
  for (let i = 0; i < length; i++) {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((rng % 1000) / 1000 - 0.5) * 2;
    // Pull toward mean
    price = price + revertSpeed * (mean - price) + noise;
    if (price <= 0) price = 0.01;
    prices.push(price);
  }
  return prices.reverse();
}

// ── Helper: generate a pure monotonic trending series ──
// Strictly increasing prices → should yield H close to 1
function generateStrongTrend(length: number): number[] {
  const prices: number[] = [];
  for (let i = 0; i < length; i++) {
    prices.push(100 + i * 0.5); // steady 0.5% daily increase
  }
  return prices.reverse();
}

// ── calcHurst tests ──────────────────────────────────────────

describe('calcHurst', () => {
  it('returns null for insufficient data (< 50 bars)', () => {
    expect(calcHurst([])).toBeNull();
    expect(calcHurst([100, 101, 102])).toBeNull();
    expect(calcHurst(new Array(49).fill(100))).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(calcHurst(null as unknown as number[])).toBeNull();
    expect(calcHurst(undefined as unknown as number[])).toBeNull();
  });

  it('returns a number between 0 and 1 for valid data', () => {
    const prices = generateTrendingSeries(200);
    const h = calcHurst(prices);
    expect(h).not.toBeNull();
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
  });

  it('returns H > 0.5 for a trending series (persistent)', () => {
    const prices = generateTrendingSeries(200);
    const h = calcHurst(prices)!;
    expect(h).toBeGreaterThan(0.5);
  });

  it('returns H close to 1 for a strongly trending (monotonic) series', () => {
    const prices = generateStrongTrend(200);
    const h = calcHurst(prices)!;
    // Monotonic trend should give H well above 0.7
    expect(h).toBeGreaterThan(0.7);
  });

  it('returns H < 0.5 for a mean-reverting series', () => {
    const prices = generateMeanRevertingSeries(200);
    const h = calcHurst(prices)!;
    expect(h).toBeLessThan(0.5);
  });

  it('handles exactly 50 bars (minimum)', () => {
    const prices = generateTrendingSeries(50);
    const h = calcHurst(prices);
    // May return null if sub-period regression can't find enough points,
    // but should not throw
    expect(h === null || (typeof h === 'number' && h >= 0 && h <= 1)).toBe(true);
  });

  it('handles flat prices (zero variance) gracefully', () => {
    const prices = new Array(100).fill(50);
    const h = calcHurst(prices);
    // All returns are 0 → std=0 → rescaledRange returns null → should return null
    expect(h).toBeNull();
  });

  it('handles prices with zeros gracefully', () => {
    const prices = generateTrendingSeries(100);
    prices[50] = 0; // inject a zero
    // Should not throw — zero prices are skipped in return calculation
    const h = calcHurst(prices);
    expect(h === null || (typeof h === 'number' && h >= 0 && h <= 1)).toBe(true);
  });
});

// ── linearRegressionSlope tests ──────────────────────────────

describe('linearRegressionSlope', () => {
  it('returns correct slope for perfect linear data', () => {
    // y = 2x + 1
    const x = [1, 2, 3, 4, 5];
    const y = [3, 5, 7, 9, 11];
    const slope = linearRegressionSlope(x, y);
    expect(slope).toBeCloseTo(2, 10);
  });

  it('returns 0 for constant y values', () => {
    const x = [1, 2, 3, 4];
    const y = [5, 5, 5, 5];
    const slope = linearRegressionSlope(x, y);
    expect(slope).toBeCloseTo(0, 10);
  });

  it('returns negative slope for decreasing data', () => {
    // y = -3x + 10
    const x = [1, 2, 3, 4];
    const y = [7, 4, 1, -2];
    const slope = linearRegressionSlope(x, y);
    expect(slope).toBeCloseTo(-3, 10);
  });

  it('returns 0 for fewer than 2 data points', () => {
    expect(linearRegressionSlope([], [])).toBe(0);
    expect(linearRegressionSlope([1], [1])).toBe(0);
  });

  it('returns 0 when all x values are the same', () => {
    const x = [5, 5, 5];
    const y = [1, 2, 3];
    expect(linearRegressionSlope(x, y)).toBe(0);
  });
});
