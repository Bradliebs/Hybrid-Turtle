import { describe, expect, it } from 'vitest';
import {
  mean,
  rate,
  computeBucketStats,
  splitAndScore,
  computeScoreBands,
  NCS_BANDS,
  type OutcomeRow,
} from './filter-scorecard';

function makeRow(overrides?: Partial<OutcomeRow>): OutcomeRow {
  return {
    passedTechFilter: true,
    passedRiskGates: true,
    passedAntiChase: true,
    blockedByRegime: false,
    regime: 'BULLISH',
    status: 'READY',
    sleeve: 'CORE',
    ncs: 72,
    fws: 15,
    bqs: 80,
    fwdReturn5d: 1.5,
    fwdReturn10d: 3.0,
    fwdReturn20d: 5.0,
    mfeR: 2.1,
    maeR: -0.5,
    reached1R: true,
    reached2R: true,
    stopHit: false,
    enrichedAt: new Date(),
    ...overrides,
  };
}

describe('filter-scorecard', () => {
  describe('mean', () => {
    it('computes mean of a number array', () => {
      expect(mean([1, 2, 3])).toBe(2);
    });

    it('returns null for empty array', () => {
      expect(mean([])).toBeNull();
    });

    it('rounds to 2 decimal places', () => {
      expect(mean([1, 2, 3, 4])).toBe(2.5);
      expect(mean([1.111, 2.222])).toBe(1.67);
    });
  });

  describe('rate', () => {
    it('computes percentage rate', () => {
      expect(rate(3, 10)).toBe(30);
    });

    it('returns null for zero total', () => {
      expect(rate(0, 0)).toBeNull();
    });

    it('rounds to 1 decimal place', () => {
      expect(rate(1, 3)).toBe(33.3);
    });
  });

  describe('computeBucketStats', () => {
    it('computes stats for rows with outcomes', () => {
      const rows = [
        makeRow({ fwdReturn5d: 2.0, fwdReturn20d: 6.0, mfeR: 3.0, reached1R: true, reached2R: true, stopHit: false }),
        makeRow({ fwdReturn5d: -1.0, fwdReturn20d: -2.0, mfeR: 0.5, reached1R: false, reached2R: false, stopHit: true }),
      ];

      const stats = computeBucketStats(rows);

      expect(stats.count).toBe(2);
      expect(stats.withOutcomes).toBe(2);
      expect(stats.avgFwd5d).toBe(0.5);  // mean(2, -1) = 0.5
      expect(stats.avgFwd20d).toBe(2);    // mean(6, -2) = 2
      expect(stats.avgMfeR).toBe(1.75);   // mean(3, 0.5) = 1.75
      expect(stats.hit1RRate).toBe(50);    // 1/2 = 50%
      expect(stats.hit2RRate).toBe(50);
      expect(stats.stopHitRate).toBe(50);
    });

    it('handles rows without enrichment', () => {
      const rows = [
        makeRow({ enrichedAt: null, fwdReturn5d: null, reached1R: null, stopHit: null }),
        makeRow({ enrichedAt: null, fwdReturn5d: null, reached1R: null, stopHit: null }),
      ];

      const stats = computeBucketStats(rows);

      expect(stats.count).toBe(2);
      expect(stats.withOutcomes).toBe(0);
      expect(stats.avgFwd5d).toBeNull();
      expect(stats.hit1RRate).toBeNull();
      expect(stats.stopHitRate).toBeNull();
    });

    it('handles mixed enriched and non-enriched rows', () => {
      const rows = [
        makeRow({ fwdReturn5d: 4.0, reached1R: true, stopHit: false }),
        makeRow({ enrichedAt: null, fwdReturn5d: null, reached1R: null }),
      ];

      const stats = computeBucketStats(rows);

      expect(stats.count).toBe(2);
      expect(stats.withOutcomes).toBe(1);
      expect(stats.avgFwd5d).toBe(4);
    });
  });

  describe('splitAndScore', () => {
    it('splits rows by predicate and scores both sides', () => {
      const rows = [
        makeRow({ passedTechFilter: true, fwdReturn5d: 3.0 }),
        makeRow({ passedTechFilter: true, fwdReturn5d: 2.0 }),
        makeRow({ passedTechFilter: false, fwdReturn5d: -1.0 }),
      ];

      const result = splitAndScore(
        rows,
        'Tech Filter',
        'Stage 2 technical filters',
        (r) => r.passedTechFilter
      );

      expect(result.rule).toBe('Tech Filter');
      expect(result.total).toBe(3);
      expect(result.passedCount).toBe(2);
      expect(result.blockedCount).toBe(1);
      expect(result.passRate).toBe(66.7);
      expect(result.passed.avgFwd5d).toBe(2.5);  // mean(3,2)
      expect(result.blocked.avgFwd5d).toBe(-1);
    });

    it('handles all passing', () => {
      const rows = [makeRow(), makeRow()];
      const result = splitAndScore(rows, 'Test', 'desc', () => true);
      expect(result.passedCount).toBe(2);
      expect(result.blockedCount).toBe(0);
      expect(result.passRate).toBe(100);
    });

    it('handles empty input', () => {
      const result = splitAndScore([], 'Test', 'desc', () => true);
      expect(result.total).toBe(0);
      expect(result.passRate).toBe(0);
    });
  });

  describe('computeScoreBands', () => {
    it('buckets rows into NCS bands', () => {
      const rows = [
        makeRow({ ncs: 45 }),
        makeRow({ ncs: 55 }),
        makeRow({ ncs: 65 }),
        makeRow({ ncs: 72 }),
        makeRow({ ncs: 85 }),
        makeRow({ ncs: 90 }),
      ];

      const bands = computeScoreBands(rows, 'NCS', NCS_BANDS, (r) => r.ncs);

      expect(bands).toHaveLength(5);
      expect(bands[0].band).toBe('< 50');
      expect(bands[0].count).toBe(1);  // ncs=45
      expect(bands[1].band).toBe('50–59');
      expect(bands[1].count).toBe(1);  // ncs=55
      expect(bands[2].band).toBe('60–69');
      expect(bands[2].count).toBe(1);  // ncs=65
      expect(bands[3].band).toBe('70–79');
      expect(bands[3].count).toBe(1);  // ncs=72
      expect(bands[4].band).toBe('80+');
      expect(bands[4].count).toBe(2);  // ncs=85,90
    });

    it('excludes rows with null score', () => {
      const rows = [
        makeRow({ ncs: 50 }),
        makeRow({ ncs: null }),
      ];

      const bands = computeScoreBands(rows, 'NCS', NCS_BANDS, (r) => r.ncs);
      const totalInBands = bands.reduce((s, b) => s + b.count, 0);
      expect(totalInBands).toBe(1);
    });

    it('computes outcome stats per band', () => {
      const rows = [
        makeRow({ ncs: 85, fwdReturn20d: 8.0, reached1R: true, stopHit: false }),
        makeRow({ ncs: 90, fwdReturn20d: 12.0, reached1R: true, stopHit: false }),
        makeRow({ ncs: 45, fwdReturn20d: -3.0, reached1R: false, stopHit: true }),
      ];

      const bands = computeScoreBands(rows, 'NCS', NCS_BANDS, (r) => r.ncs);

      // 80+ band: ncs=85,90 → avg fwd20d = (8+12)/2 = 10
      const topBand = bands.find((b) => b.band === '80+');
      expect(topBand?.avgFwd20d).toBe(10);
      expect(topBand?.hit1RRate).toBe(100);
      expect(topBand?.stopHitRate).toBe(0);

      // < 50 band: ncs=45 → fwd20d = -3
      const bottomBand = bands.find((b) => b.band === '< 50');
      expect(bottomBand?.avgFwd20d).toBe(-3);
      expect(bottomBand?.stopHitRate).toBe(100);
    });
  });
});
