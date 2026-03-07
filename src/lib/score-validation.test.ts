import { describe, expect, it } from 'vitest';
import {
  mean,
  pctRate,
  computeStats,
  bucketRows,
  testMonotonicity,
  NCS_BANDS,
  FWS_BANDS,
  BQS_BANDS,
  type OutcomeRow,
} from './score-validation';
import { classifyDualScoreAction } from './score-backfill';

function makeRow(overrides?: Partial<OutcomeRow>): OutcomeRow {
  return {
    bqs: 75,
    fws: 20,
    ncs: 72,
    dualScoreAction: 'Auto-Yes',
    tradePlaced: false,
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

describe('score-validation', () => {
  describe('mean', () => {
    it('computes mean', () => expect(mean([2, 4, 6])).toBe(4));
    it('returns null for empty', () => expect(mean([])).toBeNull());
    it('rounds to 2 dp', () => expect(mean([1, 2, 3])).toBe(2));
  });

  describe('pctRate', () => {
    it('computes percentage', () => expect(pctRate(3, 10)).toBe(30));
    it('null for zero', () => expect(pctRate(0, 0)).toBeNull());
  });

  describe('computeStats', () => {
    it('computes all metrics from enriched rows', () => {
      const rows = [
        makeRow({ fwdReturn20d: 8.0, mfeR: 3.0, reached1R: true, reached2R: true, stopHit: false, tradePlaced: true }),
        makeRow({ fwdReturn20d: -2.0, mfeR: 0.5, reached1R: false, reached2R: false, stopHit: true, tradePlaced: false }),
      ];
      const stats = computeStats(rows);

      expect(stats.count).toBe(2);
      expect(stats.withOutcomes).toBe(2);
      expect(stats.tradedCount).toBe(1);
      expect(stats.tradeConversionRate).toBe(50);
      expect(stats.avgFwd20d).toBe(3);     // mean(8,-2)
      expect(stats.avgMfeR).toBe(1.75);    // mean(3,0.5)
      expect(stats.hit1RRate).toBe(50);     // 1/2
      expect(stats.hit2RRate).toBe(50);
      expect(stats.stopHitRate).toBe(50);
    });

    it('handles unenriched rows', () => {
      const rows = [makeRow({ enrichedAt: null, fwdReturn5d: null, reached1R: null })];
      const stats = computeStats(rows);
      expect(stats.withOutcomes).toBe(0);
      expect(stats.avgFwd5d).toBeNull();
      expect(stats.hit1RRate).toBeNull();
    });

    it('counts trade conversion correctly', () => {
      const rows = [
        makeRow({ tradePlaced: true }),
        makeRow({ tradePlaced: true }),
        makeRow({ tradePlaced: false }),
      ];
      const stats = computeStats(rows);
      expect(stats.tradedCount).toBe(2);
      expect(stats.tradeConversionRate).toBe(66.7);
    });
  });

  describe('bucketRows', () => {
    it('buckets NCS into correct bands', () => {
      const rows = [
        makeRow({ ncs: 45 }),
        makeRow({ ncs: 55 }),
        makeRow({ ncs: 72 }),
        makeRow({ ncs: 85 }),
        makeRow({ ncs: 92 }),
      ];
      const bands = bucketRows(rows, 'NCS', NCS_BANDS, (r) => r.ncs);

      expect(bands).toHaveLength(5);
      expect(bands[0].stats.count).toBe(1);  // < 50
      expect(bands[1].stats.count).toBe(1);  // 50–59
      expect(bands[2].stats.count).toBe(0);  // 60–69
      expect(bands[3].stats.count).toBe(1);  // 70–79
      expect(bands[4].stats.count).toBe(2);  // 80+
    });

    it('FWS bands align with action thresholds', () => {
      const rows = [
        makeRow({ fws: 5 }),    // 0–15 clean
        makeRow({ fws: 25 }),   // 15–30 safe
        makeRow({ fws: 40 }),   // 30–50 caution
        makeRow({ fws: 55 }),   // 50–65 risky
        makeRow({ fws: 70 }),   // 65+ fragile
      ];
      const bands = bucketRows(rows, 'FWS', FWS_BANDS, (r) => r.fws);

      expect(bands[0].band).toBe('0–15 (clean)');
      expect(bands[0].stats.count).toBe(1);
      expect(bands[4].band).toBe('65+ (fragile)');
      expect(bands[4].stats.count).toBe(1);
    });

    it('excludes null scores', () => {
      const rows = [makeRow({ ncs: 70 }), makeRow({ ncs: null })];
      const bands = bucketRows(rows, 'NCS', NCS_BANDS, (r) => r.ncs);
      const total = bands.reduce((s, b) => s + b.stats.count, 0);
      expect(total).toBe(1);
    });
  });

  describe('testMonotonicity', () => {
    it('detects perfect ascending monotonicity', () => {
      const bands = [
        { score: 'NCS', band: '< 50', bandLow: 0, bandHigh: 50, stats: { ...computeStats([]), avgFwd20d: 1.0 } as ReturnType<typeof computeStats> },
        { score: 'NCS', band: '50–59', bandLow: 50, bandHigh: 60, stats: { ...computeStats([]), avgFwd20d: 3.0 } as ReturnType<typeof computeStats> },
        { score: 'NCS', band: '70–79', bandLow: 70, bandHigh: 80, stats: { ...computeStats([]), avgFwd20d: 5.0 } as ReturnType<typeof computeStats> },
      ];
      const result = testMonotonicity(bands, 'Fwd 20d', (s) => s.avgFwd20d, 'ascending');

      expect(result.isMonotonic).toBe(true);
      expect(result.violations).toBe(0);
      expect(result.interpretation).toContain('predictive');
    });

    it('detects violations in ascending', () => {
      const bands = [
        { score: 'NCS', band: '< 50', bandLow: 0, bandHigh: 50, stats: { ...computeStats([]), avgFwd20d: 5.0 } as ReturnType<typeof computeStats> },
        { score: 'NCS', band: '50–59', bandLow: 50, bandHigh: 60, stats: { ...computeStats([]), avgFwd20d: 2.0 } as ReturnType<typeof computeStats> },
        { score: 'NCS', band: '70–79', bandLow: 70, bandHigh: 80, stats: { ...computeStats([]), avgFwd20d: 8.0 } as ReturnType<typeof computeStats> },
      ];
      const result = testMonotonicity(bands, 'Fwd 20d', (s) => s.avgFwd20d, 'ascending');

      expect(result.isMonotonic).toBe(false);
      expect(result.violations).toBe(1);
    });

    it('handles descending direction for FWS', () => {
      const bands = [
        { score: 'FWS', band: '0–15', bandLow: 0, bandHigh: 15, stats: { ...computeStats([]), avgFwd20d: 8.0 } as ReturnType<typeof computeStats> },
        { score: 'FWS', band: '15–30', bandLow: 15, bandHigh: 30, stats: { ...computeStats([]), avgFwd20d: 5.0 } as ReturnType<typeof computeStats> },
        { score: 'FWS', band: '65+', bandLow: 65, bandHigh: 100, stats: { ...computeStats([]), avgFwd20d: -2.0 } as ReturnType<typeof computeStats> },
      ];
      const result = testMonotonicity(bands, 'Fwd 20d', (s) => s.avgFwd20d, 'descending');

      expect(result.isMonotonic).toBe(true);
      expect(result.interpretation).toContain('predictive');
    });

    it('handles insufficient data', () => {
      const bands = [
        { score: 'NCS', band: '< 50', bandLow: 0, bandHigh: 50, stats: { ...computeStats([]), avgFwd20d: null } as ReturnType<typeof computeStats> },
      ];
      const result = testMonotonicity(bands, 'Fwd 20d', (s) => s.avgFwd20d, 'ascending');
      expect(result.interpretation).toContain('Insufficient data');
    });
  });

  describe('classifyDualScoreAction', () => {
    it('Auto-No when FWS > 65', () => {
      expect(classifyDualScoreAction(70, 80)).toBe('Auto-No');
      expect(classifyDualScoreAction(66, 50)).toBe('Auto-No');
    });

    it('Auto-Yes when NCS >= 70 AND FWS <= 30', () => {
      expect(classifyDualScoreAction(20, 75)).toBe('Auto-Yes');
      expect(classifyDualScoreAction(30, 70)).toBe('Auto-Yes');
    });

    it('Conditional for everything else', () => {
      expect(classifyDualScoreAction(35, 75)).toBe('Conditional');  // FWS > 30
      expect(classifyDualScoreAction(20, 65)).toBe('Conditional');  // NCS < 70
      expect(classifyDualScoreAction(50, 55)).toBe('Conditional');
    });

    it('FWS > 65 takes priority over NCS >= 70', () => {
      // Even if NCS is high, FWS > 65 = Auto-No
      expect(classifyDualScoreAction(70, 90)).toBe('Auto-No');
    });
  });
});
