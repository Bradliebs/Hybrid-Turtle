import { describe, expect, it, beforeEach } from 'vitest';
import {
  calcBPS,
  calcBPSFromSnapshot,
  computeRsPercentiles,
  linearRegressionSlope,
  type BPSInput,
} from './breakout-probability';
import { setSectorMomentum, clearSectorMomentumCache } from './sector-etf-cache';

// ── Linear Regression Slope ─────────────────────────────────

describe('linearRegressionSlope', () => {
  it('returns 0 for empty array', () => {
    expect(linearRegressionSlope([])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(linearRegressionSlope([42])).toBe(0);
  });

  it('computes positive slope for increasing values (newest-first input)', () => {
    // Newest first: [5, 4, 3, 2, 1] → reversed to [1,2,3,4,5] for regression
    // Perfect linear increase → slope = 1
    const slope = linearRegressionSlope([5, 4, 3, 2, 1]);
    expect(slope).toBeCloseTo(1.0, 5);
  });

  it('computes negative slope for decreasing values (newest-first input)', () => {
    // Newest first: [1, 2, 3, 4, 5] → reversed to [5,4,3,2,1]
    // Perfect linear decrease → slope = -1
    const slope = linearRegressionSlope([1, 2, 3, 4, 5]);
    expect(slope).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for flat values', () => {
    const slope = linearRegressionSlope([10, 10, 10, 10, 10]);
    expect(slope).toBe(0);
  });

  it('handles noisy data correctly', () => {
    // Gently uptrending volumes (newest first)
    const volumes = [1200, 1100, 1050, 950, 900, 850, 800, 750, 700, 650];
    const slope = linearRegressionSlope(volumes);
    // Reversed = [650,700,750,...,1200] → positive slope
    expect(slope).toBeGreaterThan(0);
  });

  it('returns 0 for NaN values', () => {
    const slope = linearRegressionSlope([1, NaN, 3]);
    expect(slope).toBe(0);
  });

  it('returns 0 for Infinity values', () => {
    const slope = linearRegressionSlope([1, Infinity, 3]);
    expect(slope).toBe(0);
  });

  it('handles two-element arrays', () => {
    // [10, 5] → reversed to [5, 10] → slope = 5
    const slope = linearRegressionSlope([10, 5]);
    expect(slope).toBeCloseTo(5.0, 5);
  });
});

// ── calcBPS ─────────────────────────────────────────────────

describe('calcBPS', () => {
  beforeEach(() => {
    clearSectorMomentumCache();
  });

  it('returns 0 for empty input', () => {
    const result = calcBPS({});
    // Only failedBreakout gets 2 (no failed breakout = full credit)
    expect(result.bps).toBe(2);
    expect(result.components.failedBreakout).toBe(2);
    expect(result.components.consolidationQuality).toBe(0);
  });

  it('scores max 19 for ideal inputs', () => {
    // Seed sector momentum cache
    setSectorMomentum('Technology', 5.0);

    const input: BPSInput = {
      atrCompressionRatio: 0.5,        // < 0.6 → 3 (strongly contracted)
      volumeBars: [                    // Strong upward slope → 3
        5000, 4800, 4600, 4400, 4200,
        4000, 3800, 3600, 3400, 3200,
        3000, 2800, 2600, 2400, 2200,
        2000, 1800, 1600, 1400, 1200,
      ],
      rsPercentile: 95,                // ≥ 90th → 3 (top decile)
      sector: 'Technology',            // 5% return → 2
      consolidationDays: 20,          // 15–45 sweet spot → 3
      priorTrendReturn: 25,           // > 20% → 3 (strong prior trend)
      failedBreakoutAt: null,         // no failure → 2
    };

    const result = calcBPS(input);
    expect(result.bps).toBe(19);
    expect(result.components.consolidationQuality).toBe(3);
    expect(result.components.volumeAccumulation).toBe(3);
    expect(result.components.rsRank).toBe(3);
    expect(result.components.sectorMomentum).toBe(2);
    expect(result.components.consolidationDuration).toBe(3);
    expect(result.components.priorTrend).toBe(3);
    expect(result.components.failedBreakout).toBe(2);
  });

  it('scores min 0 for worst-case inputs', () => {
    const input: BPSInput = {
      atrCompressionRatio: 1.5,        // > 1.0 → 0 (expanding)
      volumeBars: [                    // Declining volumes → 0
        100, 200, 300, 400, 500,
        600, 700, 800, 900, 1000,
      ],
      rsVsBenchmarkPct: -5,           // <= 0% → 0
      sector: 'Unknown',              // no mapping → 0
      consolidationDays: 0,           // 0 days → 0
      weeklyAdx: 10,                  // < 20 → 0
      failedBreakoutAt: new Date(),   // today → 0
      now: new Date(),
    };

    const result = calcBPS(input);
    expect(result.bps).toBe(0);
  });

  // ── Factor 1: Consolidation Quality (ATR Compression Ratio) ──

  describe('consolidation quality factor', () => {
    it('scores 3 for ratio < 0.6 (strongly contracted)', () => {
      const { components } = calcBPS({ atrCompressionRatio: 0.5 });
      expect(components.consolidationQuality).toBe(3);
    });

    it('scores 2 for ratio 0.6–0.8 (moderately contracted)', () => {
      const { components } = calcBPS({ atrCompressionRatio: 0.7 });
      expect(components.consolidationQuality).toBe(2);
    });

    it('scores 1 for ratio 0.8–1.0 (slightly contracted)', () => {
      const { components } = calcBPS({ atrCompressionRatio: 0.9 });
      expect(components.consolidationQuality).toBe(1);
    });

    it('scores 0 for ratio > 1.0 (expanding volatility)', () => {
      const { components } = calcBPS({ atrCompressionRatio: 1.2 });
      expect(components.consolidationQuality).toBe(0);
    });

    it('scores 0 for ratio exactly 1.0 (no compression)', () => {
      const { components } = calcBPS({ atrCompressionRatio: 1.0 });
      expect(components.consolidationQuality).toBe(0);
    });

    it('scores 0 for null ratio', () => {
      const { components } = calcBPS({ atrCompressionRatio: null });
      expect(components.consolidationQuality).toBe(0);
    });

    it('scores 0 for undefined ratio (graceful degradation)', () => {
      const { components } = calcBPS({});
      expect(components.consolidationQuality).toBe(0);
    });

    it('scores 0 for zero ratio (invalid data)', () => {
      const { components } = calcBPS({ atrCompressionRatio: 0 });
      expect(components.consolidationQuality).toBe(0);
    });

    it('scores 0 for negative ratio (invalid data)', () => {
      const { components } = calcBPS({ atrCompressionRatio: -0.5 });
      expect(components.consolidationQuality).toBe(0);
    });

    it('scores 3 at boundary 0.59', () => {
      const { components } = calcBPS({ atrCompressionRatio: 0.59 });
      expect(components.consolidationQuality).toBe(3);
    });

    it('scores 2 at boundary 0.6', () => {
      const { components } = calcBPS({ atrCompressionRatio: 0.6 });
      expect(components.consolidationQuality).toBe(2);
    });

    it('scores 1 at boundary 0.8', () => {
      const { components } = calcBPS({ atrCompressionRatio: 0.8 });
      expect(components.consolidationQuality).toBe(1);
    });
  });

  // ── Factor 2: Volume Accumulation ──

  describe('volume accumulation factor', () => {
    it('scores 3 for strong positive volume slope', () => {
      // Newest-first: strongly increasing volumes
      const volumeBars = Array.from({ length: 20 }, (_, i) => 1000 + (19 - i) * 200);
      const { components } = calcBPS({ volumeBars });
      expect(components.volumeAccumulation).toBe(3);
    });

    it('scores 0 for declining volumes', () => {
      // Newest-first: decreasing volumes (most recent is lowest)
      const volumeBars = Array.from({ length: 20 }, (_, i) => 1000 + i * 100);
      const { components } = calcBPS({ volumeBars });
      expect(components.volumeAccumulation).toBe(0);
    });

    it('scores 0 for fewer than 10 bars', () => {
      const { components } = calcBPS({ volumeBars: [100, 200, 300, 400, 500, 600, 700, 800, 900] });
      expect(components.volumeAccumulation).toBe(0);
    });

    it('scores 0 for null volumeBars', () => {
      const { components } = calcBPS({ volumeBars: null });
      expect(components.volumeAccumulation).toBe(0);
    });
  });

  // ── Factor 3: RS Rank ──

  describe('RS rank factor', () => {
    // ── Percentile mode (preferred when universe data available) ──
    it('scores 3 for ≥90th percentile', () => {
      const { components } = calcBPS({ rsPercentile: 95 });
      expect(components.rsRank).toBe(3);
    });

    it('scores 2 for ≥75th percentile', () => {
      const { components } = calcBPS({ rsPercentile: 80 });
      expect(components.rsRank).toBe(2);
    });

    it('scores 1 for ≥50th percentile', () => {
      const { components } = calcBPS({ rsPercentile: 55 });
      expect(components.rsRank).toBe(1);
    });

    it('scores 0 for <50th percentile', () => {
      const { components } = calcBPS({ rsPercentile: 30 });
      expect(components.rsRank).toBe(0);
    });

    it('prefers rsPercentile over rsVsBenchmarkPct when both provided', () => {
      // rsVsBenchmarkPct=15 would give 3 via fixed thresholds,
      // but rsPercentile=40 should give 0 via percentile ranking
      const { components } = calcBPS({ rsVsBenchmarkPct: 15, rsPercentile: 40 });
      expect(components.rsRank).toBe(0);
    });

    // ── Fixed threshold fallback (when no percentile data) ──
    it('falls back to fixed thresholds: scores 3 for RS > 10%', () => {
      const { components } = calcBPS({ rsVsBenchmarkPct: 15 });
      expect(components.rsRank).toBe(3);
    });

    it('falls back to fixed thresholds: scores 2 for RS 5–10%', () => {
      const { components } = calcBPS({ rsVsBenchmarkPct: 7 });
      expect(components.rsRank).toBe(2);
    });

    it('falls back to fixed thresholds: scores 1 for RS 0–5%', () => {
      const { components } = calcBPS({ rsVsBenchmarkPct: 3 });
      expect(components.rsRank).toBe(1);
    });

    it('falls back to fixed thresholds: scores 0 for negative RS', () => {
      const { components } = calcBPS({ rsVsBenchmarkPct: -2 });
      expect(components.rsRank).toBe(0);
    });
  });

  // ── computeRsPercentiles ──

  describe('computeRsPercentiles', () => {
    it('distributes percentiles correctly for 10 tickers', () => {
      const tickers = Array.from({ length: 10 }, (_, i) => ({
        ticker: `T${i}`,
        rs: i * 2, // 0, 2, 4, ..., 18
      }));
      const pctMap = computeRsPercentiles(tickers);
      expect(pctMap.get('T0')).toBe(0);   // lowest RS
      expect(pctMap.get('T9')).toBe(100); // highest RS
      expect(pctMap.get('T5')).toBe(56);  // middle-ish (5/9 * 100 ≈ 56)
    });

    it('handles ties by assigning same percentile', () => {
      const tickers = [
        { ticker: 'A', rs: 5 },
        { ticker: 'B', rs: 10 },
        { ticker: 'C', rs: 10 },
        { ticker: 'D', rs: 15 },
      ];
      const pctMap = computeRsPercentiles(tickers);
      expect(pctMap.get('B')).toBe(pctMap.get('C')); // tied → same percentile
      expect(pctMap.get('A')).toBe(0);   // lowest
      expect(pctMap.get('D')).toBe(100); // highest
    });

    it('returns 50 for single ticker', () => {
      const pctMap = computeRsPercentiles([{ ticker: 'SOLO', rs: 5 }]);
      expect(pctMap.get('SOLO')).toBe(50);
    });

    it('returns empty map for empty input', () => {
      const pctMap = computeRsPercentiles([]);
      expect(pctMap.size).toBe(0);
    });
  });

  // ── Factor 4: Sector Momentum ──

  describe('sector momentum factor', () => {
    beforeEach(() => {
      clearSectorMomentumCache();
    });

    it('scores 2 for sector with > 3% return', () => {
      setSectorMomentum('Technology', 5.0);
      const { components } = calcBPS({ sector: 'Technology' });
      expect(components.sectorMomentum).toBe(2);
    });

    it('scores 1 for sector with 0–3% return', () => {
      setSectorMomentum('Healthcare', 1.5);
      const { components } = calcBPS({ sector: 'Healthcare' });
      expect(components.sectorMomentum).toBe(1);
    });

    it('scores 0 for sector with negative return', () => {
      setSectorMomentum('Energy', -2.0);
      const { components } = calcBPS({ sector: 'Energy' });
      expect(components.sectorMomentum).toBe(0);
    });

    it('scores 0 for unknown sector', () => {
      const { components } = calcBPS({ sector: 'UnknownSector' });
      expect(components.sectorMomentum).toBe(0);
    });
  });

  // ── Factor 5: Consolidation Duration ──

  describe('consolidation duration factor', () => {
    it('scores 3 for 15–45 bars (ideal base)', () => {
      expect(calcBPS({ consolidationDays: 15 }).components.consolidationDuration).toBe(3);
      expect(calcBPS({ consolidationDays: 30 }).components.consolidationDuration).toBe(3);
      expect(calcBPS({ consolidationDays: 45 }).components.consolidationDuration).toBe(3);
    });

    it('scores 1 for 8–14 bars (short base)', () => {
      expect(calcBPS({ consolidationDays: 8 }).components.consolidationDuration).toBe(1);
      expect(calcBPS({ consolidationDays: 12 }).components.consolidationDuration).toBe(1);
      expect(calcBPS({ consolidationDays: 14 }).components.consolidationDuration).toBe(1);
    });

    it('scores 1 for > 45 bars (stale base)', () => {
      expect(calcBPS({ consolidationDays: 50 }).components.consolidationDuration).toBe(1);
      expect(calcBPS({ consolidationDays: 80 }).components.consolidationDuration).toBe(1);
    });

    it('scores 0 for < 8 bars (no base)', () => {
      expect(calcBPS({ consolidationDays: 0 }).components.consolidationDuration).toBe(0);
      expect(calcBPS({ consolidationDays: 7 }).components.consolidationDuration).toBe(0);
      expect(calcBPS({ consolidationDays: null }).components.consolidationDuration).toBe(0);
    });
  });

  // ── Factor 6: Prior Trend Strength ──

  describe('prior trend factor', () => {
    // ── 12-week return mode (preferred) ──
    it('scores 3 for 12-week return > 20%', () => {
      const { components } = calcBPS({ priorTrendReturn: 25 });
      expect(components.priorTrend).toBe(3);
    });

    it('scores 2 for 12-week return 10–20%', () => {
      const { components } = calcBPS({ priorTrendReturn: 15 });
      expect(components.priorTrend).toBe(2);
    });

    it('scores 1 for 12-week return 5–10%', () => {
      const { components } = calcBPS({ priorTrendReturn: 7 });
      expect(components.priorTrend).toBe(1);
    });

    it('scores 0 for 12-week return < 5%', () => {
      const { components } = calcBPS({ priorTrendReturn: 3 });
      expect(components.priorTrend).toBe(0);
    });

    it('scores 0 for negative 12-week return', () => {
      const { components } = calcBPS({ priorTrendReturn: -5 });
      expect(components.priorTrend).toBe(0);
    });

    it('prefers priorTrendReturn over weeklyAdx when both provided', () => {
      // weeklyAdx=35 would give 3, but priorTrendReturn=3 should give 0
      const { components } = calcBPS({ priorTrendReturn: 3, weeklyAdx: 35 });
      expect(components.priorTrend).toBe(0);
    });

    // ── Weekly ADX fallback (snapshot callers) ──
    it('falls back to weeklyAdx: scores 3 for >= 30', () => {
      const { components } = calcBPS({ weeklyAdx: 35 });
      expect(components.priorTrend).toBe(3);
    });

    it('falls back to weeklyAdx: scores 2 for 25–29', () => {
      const { components } = calcBPS({ weeklyAdx: 27 });
      expect(components.priorTrend).toBe(2);
    });

    it('falls back to weeklyAdx: scores 1 for 20–24', () => {
      const { components } = calcBPS({ weeklyAdx: 22 });
      expect(components.priorTrend).toBe(1);
    });

    it('falls back to weeklyAdx: scores 0 for < 20', () => {
      const { components } = calcBPS({ weeklyAdx: 15 });
      expect(components.priorTrend).toBe(0);
    });
  });

  // ── Factor 7: Failed Breakout ──

  describe('failed breakout factor', () => {
    it('scores 2 for no failed breakout', () => {
      const { components } = calcBPS({ failedBreakoutAt: null });
      expect(components.failedBreakout).toBe(2);
    });

    it('scores 1 for failed breakout > 30 days ago', () => {
      const now = new Date('2026-02-28');
      const failedAt = new Date('2026-01-15'); // 44 days ago
      const { components } = calcBPS({ failedBreakoutAt: failedAt, now });
      expect(components.failedBreakout).toBe(1);
    });

    it('scores 1 for failed breakout 10–30 days ago', () => {
      const now = new Date('2026-02-28');
      const failedAt = new Date('2026-02-10'); // 18 days ago
      const { components } = calcBPS({ failedBreakoutAt: failedAt, now });
      expect(components.failedBreakout).toBe(1);
    });

    it('scores 0 for failed breakout < 10 days ago', () => {
      const now = new Date('2026-02-28');
      const failedAt = new Date('2026-02-25'); // 3 days ago
      const { components } = calcBPS({ failedBreakoutAt: failedAt, now });
      expect(components.failedBreakout).toBe(0);
    });
  });
});

// ── calcBPSFromSnapshot ─────────────────────────────────────

describe('calcBPSFromSnapshot', () => {
  beforeEach(() => {
    clearSectorMomentumCache();
  });

  it('computes BPS from a snapshot-like row', () => {
    const result = calcBPSFromSnapshot({
      atr_pct: 2.5,
      atr_compression_ratio: 0.7,
      rs_vs_benchmark_pct: 7,
      weekly_adx: 28,
      sector: 'Technology',
      consolidationDays: 15,
      failedBreakoutAt: null,
    });

    // compression 0.7 → 2, RS 7 → 2, weeklyAdx 28 → 2, sector no cache → 0,
    // consolidation 15 → 3, no failure → 2. Total = 11
    expect(result.bps).toBe(11);
  });

  it('scores 0 for Factor 1 when ratio not available (graceful degradation)', () => {
    const result = calcBPSFromSnapshot({
      atr_pct: 2.5,   // present but not used for Factor 1 anymore
      rs_vs_benchmark_pct: 7,
      weekly_adx: 28,
    });

    // compression undefined → 0, RS 7 → 2, weeklyAdx 28 → 2, no failure → 2. Total = 6
    expect(result.bps).toBe(6);
  });

  it('handles completely empty row', () => {
    const result = calcBPSFromSnapshot({});
    // Only failedBreakout = 2 (null = no failure)
    expect(result.bps).toBe(2);
  });
});
