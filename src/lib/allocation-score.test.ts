import { describe, expect, it } from 'vitest';
import {
  calcQuality,
  calcExpectancy,
  calcSleeveBonus,
  calcClusterPenalty,
  calcSectorPenalty,
  calcEarningsPenalty,
  calcCorrelationPenalty,
  calcCapitalInefficiency,
  scoreAndRankCandidates,
  WEIGHTS,
  type AllocationCandidate,
  type PortfolioContext,
} from './allocation-score';
import type { Sleeve } from '@/types';

function makeCandidate(overrides?: Partial<AllocationCandidate>): AllocationCandidate {
  return {
    ticker: 'AAPL',
    name: 'Apple',
    sleeve: 'CORE' as Sleeve,
    sector: 'Technology',
    cluster: 'BigTech',
    ncs: 72,
    fws: 20,
    bqs: 80,
    entryTrigger: 182,
    stopPrice: 176.75,
    suggestedShares: 4.5,
    suggestedRiskGbp: 23.63,
    suggestedCostGbp: 819,
    daysToEarnings: null,
    atrPct: 1.94,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<PortfolioContext>): PortfolioContext {
  return {
    equity: 1000,
    riskProfile: 'SMALL_ACCOUNT',
    positions: [],
    correlationFlags: [],
    expectancyByKey: new Map(),
    regime: 'BULLISH',
    ...overrides,
  };
}

describe('allocation-score', () => {
  describe('calcQuality', () => {
    it('NCS 70 (Auto-Yes threshold) → 28 pts', () => {
      expect(calcQuality(70)).toBe(28);
    });

    it('NCS 100 → 40 pts (max)', () => {
      expect(calcQuality(100)).toBe(40);
    });

    it('NCS 0 → 0 pts', () => {
      expect(calcQuality(0)).toBe(0);
    });

    it('negative NCS → 0 pts', () => {
      expect(calcQuality(-10)).toBe(0);
    });
  });

  describe('calcExpectancy', () => {
    it('positive expectancy yields positive component', () => {
      expect(calcExpectancy(0.5)).toBe(7.5);  // 0.5 * 15
    });

    it('null expectancy → 0 (neutral)', () => {
      expect(calcExpectancy(null)).toBe(0);
    });

    it('negative expectancy yields negative score', () => {
      expect(calcExpectancy(-0.3)).toBe(-4.5);
    });

    it('clamps at ±1 before scaling', () => {
      expect(calcExpectancy(2.0)).toBe(15);   // clamped to 1.0 * 15
      expect(calcExpectancy(-5.0)).toBe(-15);
    });
  });

  describe('calcSleeveBonus', () => {
    it('empty sleeve gets full bonus', () => {
      expect(calcSleeveBonus('CORE', 0, 80)).toBe(10);
    });

    it('80%+ utilization gets no bonus', () => {
      expect(calcSleeveBonus('CORE', 80, 80)).toBe(0);
      expect(calcSleeveBonus('CORE', 65, 80)).toBe(0);
    });

    it('half utilization gets partial bonus', () => {
      const bonus = calcSleeveBonus('CORE', 40, 80);
      // utilPct = 40/80 = 0.5, bonus = (1 - 0.5/0.8) * 10 = (1 - 0.625) * 10 = 3.75
      expect(bonus).toBe(3.75);
    });
  });

  describe('calcClusterPenalty', () => {
    it('no penalty below 60% of cap', () => {
      expect(calcClusterPenalty(10, 25)).toBe(0);  // 10/25 = 40% < 60%
    });

    it('partial penalty between 60% and 100%', () => {
      const pen = calcClusterPenalty(20, 25);  // 80% of cap
      // severity = (0.8 - 0.6) / 0.4 = 0.5 → 0.5 * 15 = 7.5
      expect(pen).toBe(7.5);
    });

    it('max penalty at 100% of cap', () => {
      expect(calcClusterPenalty(25, 25)).toBe(15);
    });

    it('capped at max above 100%', () => {
      expect(calcClusterPenalty(30, 25)).toBe(15);
    });
  });

  describe('calcSectorPenalty', () => {
    it('no penalty below 60% of cap', () => {
      expect(calcSectorPenalty(10, 30)).toBe(0);
    });

    it('full penalty at cap', () => {
      expect(calcSectorPenalty(30, 30)).toBe(10);
    });
  });

  describe('calcEarningsPenalty (deprecated — kept for backward compat)', () => {
    it('still computes penalty values for reference', () => {
      expect(calcEarningsPenalty(2)).toBe(10);
      expect(calcEarningsPenalty(4)).toBe(5);
      expect(calcEarningsPenalty(6)).toBe(0);
      expect(calcEarningsPenalty(null)).toBe(0);
    });
  });

  describe('calcCorrelationPenalty', () => {
    it('0 correlated → 0 penalty', () => {
      expect(calcCorrelationPenalty(0)).toBe(0);
    });

    it('1 correlated → 5 penalty', () => {
      expect(calcCorrelationPenalty(1)).toBe(5);
    });

    it('capped at max', () => {
      expect(calcCorrelationPenalty(5)).toBe(10);
    });
  });

  describe('calcCapitalInefficiency', () => {
    it('good ratio → no penalty', () => {
      // risk/capital = 0.03 (3%), target = 2%, threshold = 1% → good
      expect(calcCapitalInefficiency(0.03, 2.0)).toBe(0);
    });

    it('poor ratio → penalty', () => {
      // risk/capital = 0.002 (0.2%), target = 2%, half = 1% → very inefficient
      const pen = calcCapitalInefficiency(0.002, 2.0);
      expect(pen).toBeGreaterThan(0);
    });

    it('null ratio → no penalty', () => {
      expect(calcCapitalInefficiency(null, 2.0)).toBe(0);
    });
  });

  describe('scoreAndRankCandidates', () => {
    it('ranks higher NCS first when all else equal', () => {
      const candidates = [
        makeCandidate({ ticker: 'LOW', ncs: 50 }),
        makeCandidate({ ticker: 'HIGH', ncs: 85 }),
        makeCandidate({ ticker: 'MID', ncs: 65 }),
      ];
      const result = scoreAndRankCandidates(candidates, makeContext());

      expect(result[0].ticker).toBe('HIGH');
      expect(result[1].ticker).toBe('MID');
      expect(result[2].ticker).toBe('LOW');
      expect(result[0].rank).toBe(1);
      expect(result[2].rank).toBe(3);
    });

    it('penalizes cluster crowding', () => {
      const candidates = [
        makeCandidate({ ticker: 'CROWDED', cluster: 'BigTech', ncs: 75 }),
        makeCandidate({ ticker: 'UNCROWDED', cluster: 'Pharma', ncs: 72 }),
      ];
      const context = makeContext({
        positions: [
          { ticker: 'MSFT', sleeve: 'CORE' as Sleeve, sector: 'Technology', cluster: 'BigTech', value: 200 },
          { ticker: 'GOOG', sleeve: 'CORE' as Sleeve, sector: 'Technology', cluster: 'BigTech', value: 200 },
        ],
      });

      const result = scoreAndRankCandidates(candidates, context);

      // UNCROWDED should rank above CROWDED despite lower NCS
      const crowded = result.find((r) => r.ticker === 'CROWDED')!;
      const uncrowded = result.find((r) => r.ticker === 'UNCROWDED')!;
      expect(crowded.clusterCrowdingPenalty).toBeGreaterThan(0);
      expect(uncrowded.clusterCrowdingPenalty).toBe(0);
    });

    it('does NOT apply earnings penalty (pruned OVERLAP-03 — NCS handles it)', () => {
      const candidates = [
        makeCandidate({ ticker: 'EARNINGS', ncs: 80, daysToEarnings: 1 }),
        makeCandidate({ ticker: 'SAFE', ncs: 75, daysToEarnings: null }),
      ];
      const result = scoreAndRankCandidates(candidates, makeContext());

      const earnings = result.find((r) => r.ticker === 'EARNINGS')!;
      // Earnings penalty is now always 0 in allocation score
      // (NCS already includes earnings penalty via computePenalties)
      expect(earnings.earningsNearPenalty).toBe(0);

      // Higher NCS candidate now ranks first (no separate earnings deduction)
      expect(result[0].ticker).toBe('EARNINGS');
    });

    it('applies correlation penalty for correlated holdings', () => {
      const candidates = [
        makeCandidate({ ticker: 'CORR', ncs: 78 }),
        makeCandidate({ ticker: 'INDEP', ncs: 75 }),
      ];
      const context = makeContext({
        positions: [
          { ticker: 'MSFT', sleeve: 'CORE' as Sleeve, sector: 'Technology', cluster: 'BigTech', value: 200 },
        ],
        correlationFlags: [
          { tickerA: 'CORR', tickerB: 'MSFT', correlation: 0.82 },
        ],
      });

      const result = scoreAndRankCandidates(candidates, context);
      const corr = result.find((r) => r.ticker === 'CORR')!;
      const indep = result.find((r) => r.ticker === 'INDEP')!;

      expect(corr.correlationPenalty).toBe(5);
      expect(corr.correlatedHoldings).toEqual(['MSFT']);
      expect(indep.correlationPenalty).toBe(0);
    });

    it('rewards underweight sleeve', () => {
      const candidates = [
        makeCandidate({ ticker: 'CORE_A', sleeve: 'CORE', ncs: 70 }),
        makeCandidate({ ticker: 'HR_A', sleeve: 'HIGH_RISK', ncs: 70 }),
      ];
      // Only CORE positions exist → HIGH_RISK sleeve is completely empty
      const context = makeContext({
        positions: [
          { ticker: 'MSFT', sleeve: 'CORE' as Sleeve, sector: 'Technology', cluster: 'BigTech', value: 500 },
        ],
      });

      const result = scoreAndRankCandidates(candidates, context);
      const core = result.find((r) => r.ticker === 'CORE_A')!;
      const hr = result.find((r) => r.ticker === 'HR_A')!;

      // HIGH_RISK sleeve is 0% utilized → full bonus
      expect(hr.sleeveBalanceBonus).toBe(10);
      // CORE sleeve is 50% utilized → partial bonus
      expect(core.sleeveBalanceBonus).toBeLessThan(10);
    });

    it('uses expectancy when available', () => {
      const candidates = [
        makeCandidate({ ticker: 'GOOD_EV', ncs: 70, atrPct: 3 }),
        makeCandidate({ ticker: 'BAD_EV', ncs: 70, atrPct: 3 }),
      ];
      const evMap = new Map<string, number>();
      evMap.set('CORE|MEDIUM|BULLISH', 0.5);  // GOOD_EV matches this
      const context = makeContext({ expectancyByKey: evMap });

      // Both candidates have same NCS and same atrPct → same EV key
      // So both get same expectancy. Let me make them differ:
      const c2 = [
        makeCandidate({ ticker: 'GOOD_EV', ncs: 70, atrPct: 3, sleeve: 'CORE' }),
        makeCandidate({ ticker: 'NO_EV', ncs: 70, atrPct: 1, sleeve: 'ETF' }),
      ];
      const result = scoreAndRankCandidates(c2, context);
      const goodEv = result.find((r) => r.ticker === 'GOOD_EV')!;
      const noEv = result.find((r) => r.ticker === 'NO_EV')!;

      expect(goodEv.expectancyComponent).toBe(7.5); // 0.5 * 15
      expect(noEv.expectancyComponent).toBe(0); // no matching EV key
    });

    it('returns deterministic ranks', () => {
      const candidates = [
        makeCandidate({ ticker: 'A', ncs: 60 }),
        makeCandidate({ ticker: 'B', ncs: 80 }),
        makeCandidate({ ticker: 'C', ncs: 70 }),
      ];
      const r1 = scoreAndRankCandidates(candidates, makeContext());
      const r2 = scoreAndRankCandidates(candidates, makeContext());

      // Same input → same output
      expect(r1.map((r) => r.ticker)).toEqual(r2.map((r) => r.ticker));
      expect(r1.map((r) => r.allocationScore)).toEqual(r2.map((r) => r.allocationScore));
    });
  });

  describe('WEIGHTS', () => {
    it('all weights are defined', () => {
      expect(WEIGHTS.quality).toBe(0.4);
      expect(WEIGHTS.expectancy).toBe(15);
      expect(WEIGHTS.sleeveBalance).toBe(10);
      expect(WEIGHTS.clusterCrowding).toBe(15);
      expect(WEIGHTS.sectorCrowding).toBe(10);
      expect(WEIGHTS.earningsNear).toBe(10);
      expect(WEIGHTS.correlationPerHolding).toBe(5);
      expect(WEIGHTS.correlationMax).toBe(10);
      expect(WEIGHTS.capitalInefficiency).toBe(10);
    });
  });
});
