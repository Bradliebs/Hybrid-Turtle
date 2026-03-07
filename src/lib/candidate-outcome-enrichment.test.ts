import { describe, expect, it } from 'vitest';
import { computeForwardMetrics } from './candidate-outcome-enrichment';

describe('candidate-outcome-enrichment', () => {
  describe('computeForwardMetrics', () => {
    const scanPrice = 100;
    const entryTrigger = 102;
    const stopPrice = 97; // R = 102 - 97 = 5 per share

    it('computes 5d/10d/20d forward returns', () => {
      const bars = Array.from({ length: 20 }, (_, i) => ({
        date: `2026-03-${String(i + 10).padStart(2, '0')}`,
        close: 100 + (i + 1) * 0.5,  // steadily rising
        high: 100 + (i + 1) * 0.6,
        low: 100 + (i + 1) * 0.3,
      }));

      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, bars);

      // Day 5 close = 100 + 5*0.5 = 102.5 → 2.5%
      expect(result.fwdReturn5d).toBeCloseTo(2.5, 1);
      // Day 10 close = 100 + 10*0.5 = 105 → 5%
      expect(result.fwdReturn10d).toBeCloseTo(5.0, 1);
      // Day 20 close = 100 + 20*0.5 = 110 → 10%
      expect(result.fwdReturn20d).toBeCloseTo(10.0, 1);
    });

    it('computes MFE in R-multiples from highs', () => {
      const bars = [
        { date: '2026-03-10', close: 103, high: 108, low: 101 },  // high = 108, R from entry = (108-102)/5 = 1.2R
        { date: '2026-03-11', close: 105, high: 112, low: 103 },  // high = 112, R = (112-102)/5 = 2.0R
        { date: '2026-03-12', close: 104, high: 106, low: 100 },
        { date: '2026-03-13', close: 103, high: 104, low: 99 },
        { date: '2026-03-14', close: 102, high: 103, low: 98 },
      ];

      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, bars);

      // MFE should be from bar with highest high: 112, R = (112-102)/5 = 2.0
      expect(result.mfeR).toBeCloseTo(2.0, 1);
    });

    it('computes MAE in R-multiples from lows (negative)', () => {
      const bars = [
        { date: '2026-03-10', close: 99, high: 101, low: 96 },   // low below entry: MAE = (102-96)/5 = 1.2R
        { date: '2026-03-11', close: 100, high: 102, low: 98 },
        { date: '2026-03-12', close: 101, high: 103, low: 99 },
        { date: '2026-03-13', close: 102, high: 104, low: 100 },
        { date: '2026-03-14', close: 103, high: 105, low: 101 },
      ];

      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, bars);

      // MAE = -(102-96)/5 = -1.2R
      expect(result.maeR).toBeCloseTo(-1.2, 1);
    });

    it('detects R-threshold crossings from closes', () => {
      // R = 5, so 1R = 107, 2R = 112, 3R = 117 (from entry 102)
      const bars = [
        { date: '2026-03-10', close: 105, high: 106, low: 103 },  // 0.6R
        { date: '2026-03-11', close: 107, high: 108, low: 105 },  // 1.0R → reached1R
        { date: '2026-03-12', close: 112, high: 113, low: 110 },  // 2.0R → reached2R
        { date: '2026-03-13', close: 110, high: 111, low: 109 },  // 1.6R
        { date: '2026-03-14', close: 115, high: 118, low: 114 },  // 2.6R, high 3.2R but close < 3R
      ];

      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, bars);

      expect(result.reached1R).toBe(true);
      expect(result.reached2R).toBe(true);
      expect(result.reached3R).toBe(false); // close never >= 117
    });

    it('detects stop hit when low touches stop level', () => {
      const bars = [
        { date: '2026-03-10', close: 100, high: 101, low: 98 },
        { date: '2026-03-11', close: 99, high: 100, low: 97 },   // low = 97 = stopPrice → stop hit
        { date: '2026-03-12', close: 101, high: 102, low: 99 },
        { date: '2026-03-13', close: 102, high: 103, low: 100 },
        { date: '2026-03-14', close: 103, high: 104, low: 101 },
      ];

      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, bars);

      expect(result.stopHit).toBe(true);
    });

    it('returns nulls when no bars provided', () => {
      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, []);

      expect(result.fwdReturn5d).toBeNull();
      expect(result.fwdReturn10d).toBeNull();
      expect(result.fwdReturn20d).toBeNull();
      expect(result.mfeR).toBeNull();
      expect(result.reached1R).toBeNull();
      expect(result.stopHit).toBeNull();
    });

    it('returns null R-metrics when stop >= entry (invalid setup)', () => {
      const result = computeForwardMetrics(
        scanPrice,
        100,    // entry
        100,    // stop = entry → rPerShare = 0
        [{ date: '2026-03-10', close: 105, high: 106, low: 98 }]
      );

      expect(result.fwdReturn5d).toBeNull(); // only 1 bar, need 5
      expect(result.mfeR).toBeNull();
      expect(result.maeR).toBeNull();
      expect(result.reached1R).toBeNull();
    });

    it('handles fewer than 20 bars gracefully', () => {
      const bars = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-03-${String(i + 10).padStart(2, '0')}`,
        close: 101 + i,
        high: 102 + i,
        low: 100 + i,
      }));

      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, bars);

      expect(result.fwdReturn5d).not.toBeNull();
      expect(result.fwdReturn10d).toBeNull(); // only 7 bars
      expect(result.fwdReturn20d).toBeNull();
      // MFE/MAE computed over available bars (7, not 20)
      expect(result.mfeR).not.toBeNull();
    });

    it('computes correct MFE when price rips then reverses', () => {
      // Entry = 102, R = 5, so 1R=107, 2R=112, 3R=117
      const bars = [
        { date: '2026-03-10', close: 105, high: 110, low: 104 },  // high-R = (110-102)/5 = 1.6
        { date: '2026-03-11', close: 115, high: 120, low: 112 },  // high-R = (120-102)/5 = 3.6
        { date: '2026-03-12', close: 108, high: 116, low: 106 },  // dropping
        { date: '2026-03-13', close: 100, high: 109, low: 95 },   // low = 95, below stop (97)
        { date: '2026-03-14', close: 98, high: 101, low: 93 },
      ];

      const result = computeForwardMetrics(scanPrice, entryTrigger, stopPrice, bars);

      expect(result.mfeR).toBeCloseTo(3.6, 1);   // best high: (120-102)/5
      expect(result.stopHit).toBe(true);          // 95 < 97
      expect(result.reached1R).toBe(true);        // close 115 > 107
      expect(result.reached2R).toBe(true);        // close 115 > 112
      expect(result.reached3R).toBe(false);       // close max 115 < 117 (3R threshold)
    });
  });
});
