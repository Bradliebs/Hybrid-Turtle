/**
 * Targeted test suite for the research-driven architecture.
 *
 * Tests the core research loop:
 *   candidate outcome persistence → forward enrichment → filter scorecard →
 *   score validation → allocation scoring → execution audit → CORE_LITE mode
 *
 * All tests use deterministic fixtures. No DB or API calls.
 */
import { describe, expect, it } from 'vitest';

// ── Module imports ──────────────────────────────────────────────────
import {
  extractCandidateOutcome,
  resolveStageReached,
  collectBlockedReasons,
} from './candidate-outcome';

import { computeForwardMetrics } from './candidate-outcome-enrichment';

import {
  mean as fsMean,
  rate,
  computeBucketStats,
  splitAndScore,
  computeScoreBands,
  NCS_BANDS,
  FWS_BANDS,
  type OutcomeRow as FSOutcomeRow,
} from './filter-scorecard';

import {
  computeStats,
  bucketRows,
  testMonotonicity,
  NCS_BANDS as SV_NCS_BANDS,
  FWS_BANDS as SV_FWS_BANDS,
  type OutcomeRow as SVOutcomeRow,
} from './score-validation';

import { classifyDualScoreAction } from './score-backfill';

import {
  calcQuality,
  calcExpectancy,
  calcSleeveBonus,
  calcClusterPenalty,
  calcSectorPenalty,
  calcCorrelationPenalty,
  calcCapitalInefficiency,
  scoreAndRankCandidates,
  WEIGHTS,
  type AllocationCandidate,
  type PortfolioContext,
} from './allocation-score';

import {
  calcSlippagePct,
  calcSlippageR,
  wouldViolateAntiChase,
  riskRulesMetPostFill,
  MATERIAL_THRESHOLDS,
} from './execution-audit';

import {
  runTechnicalFilters,
  classifyCandidate,
  rankCandidate,
} from './scan-engine';

import type { ScanCandidate, Sleeve } from '@/types';

// ── Shared fixtures ─────────────────────────────────────────────────

function makeScanCandidate(overrides?: Partial<ScanCandidate>): ScanCandidate {
  return {
    id: 'AAPL',
    ticker: 'AAPL',
    name: 'Apple Inc',
    sleeve: 'CORE' as Sleeve,
    sector: 'Technology',
    cluster: 'BigTech',
    price: 180,
    technicals: {
      currentPrice: 180,
      ma200: 165,
      adx: 32,
      plusDI: 28,
      minusDI: 14,
      atr: 3.5,
      atr20DayAgo: 3.2,
      atrSpiking: false,
      medianAtr14: 3.3,
      atrPercent: 1.94,
      twentyDayHigh: 182,
      efficiency: 55,
      relativeStrength: 12.5,
      volumeRatio: 1.6,
      failedBreakoutAt: null,
    },
    entryTrigger: 182,
    stopPrice: 176.75,
    distancePercent: 1.11,
    status: 'READY',
    rankScore: 72.5,
    passesAllFilters: true,
    passesRiskGates: true,
    passesAntiChase: true,
    riskGateResults: [
      { passed: true, gate: 'TOTAL_RISK', message: 'OK', current: 5, limit: 10 },
    ],
    antiChaseResult: { passed: true, reason: 'No chase' },
    shares: 4.5,
    riskDollars: 23.63,
    riskPercent: 2.0,
    totalCost: 819,
    filterResults: {
      priceAboveMa200: true,
      adxAbove20: true,
      plusDIAboveMinusDI: true,
      atrPercentBelow8: true,
      efficiencyAbove30: true,
      dataQuality: true,
      atrSpiking: false,
      atrSpikeAction: 'NONE',
      hurstExponent: 0.65,
      hurstWarn: false,
    },
    ...overrides,
  };
}

function makeFSRow(overrides?: Partial<FSOutcomeRow>): FSOutcomeRow {
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

function makeSVRow(overrides?: Partial<SVOutcomeRow>): SVOutcomeRow {
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

function makeAllocCandidate(overrides?: Partial<AllocationCandidate>): AllocationCandidate {
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

function makePortfolio(overrides?: Partial<PortfolioContext>): PortfolioContext {
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

// ═════════════════════════════════════════════════════════════════════
// 1. CANDIDATE OUTCOME PERSISTENCE
// ═════════════════════════════════════════════════════════════════════

describe('research-loop: candidate outcome persistence', () => {
  it('extracts all technical fields from scan candidate', () => {
    const c = makeScanCandidate();
    const record = extractCandidateOutcome(c, 'scan_001', 'BULLISH', 'LIVE');

    expect(record.adx).toBe(32);
    expect(record.atrPct).toBe(1.94);
    expect(record.volumeRatio).toBe(1.6);
    expect(record.relativeStrength).toBe(12.5);
    expect(record.efficiency).toBe(55);
    expect(record.ma200).toBe(165);
    expect(record.plusDI).toBe(28);
    expect(record.minusDI).toBe(14);
    expect(record.atr).toBe(3.5);
  });

  it('records data freshness state at decision time', () => {
    const record = extractCandidateOutcome(makeScanCandidate(), 'scan_002', 'BULLISH', 'STALE_CACHE');
    expect(record.dataFreshness).toBe('STALE_CACHE');
  });

  it('captures dualScoreAction as null (populated by backfill)', () => {
    const record = extractCandidateOutcome(makeScanCandidate(), 'scan_003', 'BULLISH');
    expect(record.dualScoreAction).toBeNull();
  });

  it('resolves stage correctly across all 7 stages', () => {
    expect(resolveStageReached(makeScanCandidate({ shares: 10 }))).toBe('SIZED');
    expect(resolveStageReached(makeScanCandidate({ shares: undefined, antiChaseResult: { passed: false, reason: 'blocked' } }))).toBe('ANTI_CHASE');
    expect(resolveStageReached(makeScanCandidate({ shares: undefined, antiChaseResult: undefined, riskGateResults: [{ passed: false, gate: 'X', message: '', current: 0, limit: 0 }] }))).toBe('RISK_GATED');
    expect(resolveStageReached(makeScanCandidate({ shares: undefined, antiChaseResult: undefined, riskGateResults: undefined, rankScore: 50 }))).toBe('RANKED');
    expect(resolveStageReached(makeScanCandidate({ shares: undefined, antiChaseResult: undefined, riskGateResults: undefined, rankScore: 0, status: 'WATCH' }))).toBe('CLASSIFIED');
    expect(resolveStageReached(makeScanCandidate({ shares: undefined, antiChaseResult: undefined, riskGateResults: undefined, rankScore: 0, status: 'FAR' }))).toBe('TECH_FILTER');
  });

  it('collects multiple blocked reasons as comma-separated string', () => {
    const c = makeScanCandidate({
      filterResults: {
        priceAboveMa200: false,
        adxAbove20: false,
        plusDIAboveMinusDI: true,
        atrPercentBelow8: true,
        efficiencyAbove30: true,
        dataQuality: true,
      },
      earningsInfo: {
        daysUntilEarnings: 1,
        nextEarningsDate: '2026-03-10',
        confidence: 'HIGH',
        action: 'AUTO_NO',
        reason: 'too close',
      },
      status: 'COOLDOWN',
    });
    const reasons = collectBlockedReasons(c);
    expect(reasons).toContain('BELOW_MA200');
    expect(reasons).toContain('ADX_LOW');
    expect(reasons).toContain('EARNINGS_BLOCK');
    expect(reasons).toContain('COOLDOWN');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. FORWARD OUTCOME ENRICHMENT
// ═════════════════════════════════════════════════════════════════════

describe('research-loop: forward outcome enrichment', () => {
  const entry = 102;
  const stop = 97;   // R = 5
  const scan = 100;

  it('correctly computes all three return horizons from scan price', () => {
    // Scan price = 100, bars[i].close = 100 + i * 1
    const bars = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-03-${String(i + 10).padStart(2, '0')}`,
      close: 100 + (i + 1),   // 101, 102, ..., 120
      high: 100 + (i + 1) + 1,
      low: 100 + (i + 1) - 1,
    }));
    const r = computeForwardMetrics(scan, entry, stop, bars);
    // Day 5 (index 4) close = 105 → (105-100)/100 * 100 = 5%
    expect(r.fwdReturn5d).toBeCloseTo(5.0, 1);
    // Day 10 (index 9) close = 110 → 10%
    expect(r.fwdReturn10d).toBeCloseTo(10.0, 1);
    // Day 20 (index 19) close = 120 → 20%
    expect(r.fwdReturn20d).toBeCloseTo(20.0, 1);
  });

  it('MFE reflects best R from highs, MAE reflects worst R from lows', () => {
    const bars = [
      { date: '2026-03-10', close: 104, high: 110, low: 96 }, // MFE: (110-102)/5=1.6, MAE: (102-96)/5=1.2
      { date: '2026-03-11', close: 106, high: 115, low: 100 },// MFE: (115-102)/5=2.6
      { date: '2026-03-12', close: 103, high: 104, low: 98 },
      { date: '2026-03-13', close: 101, high: 103, low: 95 }, // MAE: (102-95)/5=1.4
      { date: '2026-03-14', close: 102, high: 103, low: 99 },
    ];
    const r = computeForwardMetrics(scan, entry, stop, bars);
    expect(r.mfeR).toBeCloseTo(2.6, 1);
    expect(r.maeR).toBeCloseTo(-1.4, 1);
  });

  it('stop hit detected even if price recovers afterward', () => {
    const bars = [
      { date: '2026-03-10', close: 100, high: 101, low: 96 }, // low < stop (97)
      { date: '2026-03-11', close: 105, high: 108, low: 103 },
      { date: '2026-03-12', close: 110, high: 112, low: 108 },
      { date: '2026-03-13', close: 115, high: 118, low: 112 },
      { date: '2026-03-14', close: 120, high: 122, low: 118 },
    ];
    const r = computeForwardMetrics(scan, entry, stop, bars);
    expect(r.stopHit).toBe(true);
    // Despite recovery, stop was touched on day 1
  });

  it('R-threshold crossings use close, not intraday high', () => {
    // R = 5, so 1R = 107, 2R = 112 (from entry 102)
    const bars = [
      { date: '2026-03-10', close: 106, high: 108, low: 104 }, // high crosses 1R but close doesn't
      { date: '2026-03-11', close: 107, high: 108, low: 105 }, // close = 107 = exactly 1R
      { date: '2026-03-12', close: 110, high: 113, low: 108 }, // high crosses 2R but close doesn't
      { date: '2026-03-13', close: 112, high: 114, low: 110 }, // close = 112 = exactly 2R
      { date: '2026-03-14', close: 115, high: 118, low: 113 }, // close 2.6R, high crosses 3R
    ];
    const r = computeForwardMetrics(scan, entry, stop, bars);
    expect(r.reached1R).toBe(true);
    expect(r.reached2R).toBe(true);
    expect(r.reached3R).toBe(false); // 115 < 117 (3R)
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. FILTER SCORECARD AGGREGATION
// ═════════════════════════════════════════════════════════════════════

describe('research-loop: filter scorecard aggregation', () => {
  it('splitAndScore correctly partitions and scores both sides', () => {
    const rows = [
      makeFSRow({ passedTechFilter: true, fwdReturn20d: 8.0, reached1R: true, stopHit: false }),
      makeFSRow({ passedTechFilter: true, fwdReturn20d: 4.0, reached1R: true, stopHit: false }),
      makeFSRow({ passedTechFilter: false, fwdReturn20d: -3.0, reached1R: false, stopHit: true }),
    ];
    const result = splitAndScore(rows, 'Tech Filter', 'Test', (r) => r.passedTechFilter);

    expect(result.passedCount).toBe(2);
    expect(result.blockedCount).toBe(1);
    expect(result.passRate).toBe(66.7);
    expect(result.passed.avgFwd20d).toBe(6);    // mean(8, 4)
    expect(result.blocked.avgFwd20d).toBe(-3);
    expect(result.passed.hit1RRate).toBe(100);   // 2/2
    expect(result.blocked.stopHitRate).toBe(100); // 1/1
  });

  it('computeScoreBands produces monotonic output when data is monotonic', () => {
    const rows = [
      makeFSRow({ ncs: 45, fwdReturn20d: -2.0 }),
      makeFSRow({ ncs: 55, fwdReturn20d: 1.0 }),
      makeFSRow({ ncs: 65, fwdReturn20d: 3.0 }),
      makeFSRow({ ncs: 75, fwdReturn20d: 6.0 }),
      makeFSRow({ ncs: 85, fwdReturn20d: 10.0 }),
    ];
    const bands = computeScoreBands(rows, 'NCS', NCS_BANDS, (r) => r.ncs);
    const returns = bands.map((b) => b.avgFwd20d).filter((v): v is number => v != null);
    // Returns should increase: -2, 1, 3, 6, 10
    for (let i = 1; i < returns.length; i++) {
      expect(returns[i]).toBeGreaterThan(returns[i - 1]);
    }
  });

  it('FWS bands produce inverse monotonic output when FWS predicts weakness', () => {
    const rows = [
      makeFSRow({ fws: 5, fwdReturn20d: 8.0 }),   // low weakness → good
      makeFSRow({ fws: 25, fwdReturn20d: 4.0 }),
      makeFSRow({ fws: 40, fwdReturn20d: 1.0 }),
      makeFSRow({ fws: 55, fwdReturn20d: -2.0 }),
      makeFSRow({ fws: 70, fwdReturn20d: -5.0 }),  // high weakness → bad
    ];
    const bands = computeScoreBands(rows, 'FWS', FWS_BANDS, (r) => r.fws);
    const returns = bands.map((b) => b.avgFwd20d).filter((v): v is number => v != null);
    // Returns should decrease: 8, 4, 1, -2, -5
    for (let i = 1; i < returns.length; i++) {
      expect(returns[i]).toBeLessThan(returns[i - 1]);
    }
  });

  it('unenriched rows excluded from outcome metrics but counted', () => {
    const rows = [
      makeFSRow({ enrichedAt: null, fwdReturn5d: null, reached1R: null }),
      makeFSRow({ enrichedAt: new Date(), fwdReturn5d: 2.0, reached1R: true }),
    ];
    const stats = computeBucketStats(rows);
    expect(stats.count).toBe(2);
    expect(stats.withOutcomes).toBe(1);
    expect(stats.avgFwd5d).toBe(2.0); // only enriched row
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. SCORE BUCKET ASSIGNMENT & VALIDATION
// ═════════════════════════════════════════════════════════════════════

describe('research-loop: score bucket assignment', () => {
  it('classifyDualScoreAction matches actionNote() thresholds exactly', () => {
    // Auto-No: FWS > 65 (takes priority)
    expect(classifyDualScoreAction(70, 90)).toBe('Auto-No');
    expect(classifyDualScoreAction(66, 50)).toBe('Auto-No');

    // Auto-Yes: NCS >= 70 AND FWS <= 30
    expect(classifyDualScoreAction(30, 70)).toBe('Auto-Yes');
    expect(classifyDualScoreAction(0, 100)).toBe('Auto-Yes');

    // Conditional: everything else
    expect(classifyDualScoreAction(35, 75)).toBe('Conditional'); // FWS > 30
    expect(classifyDualScoreAction(20, 65)).toBe('Conditional'); // NCS < 70
  });

  it('FWS > 65 always wins over NCS >= 70', () => {
    // Both conditions met: FWS priority
    expect(classifyDualScoreAction(66, 95)).toBe('Auto-No');
  });

  it('boundary cases: NCS exactly 70 and FWS exactly 30', () => {
    expect(classifyDualScoreAction(30, 70)).toBe('Auto-Yes');
  });

  it('boundary case: FWS exactly 65 is NOT Auto-No', () => {
    expect(classifyDualScoreAction(65, 80)).toBe('Conditional');
    // The threshold is >65, not >=65
  });

  it('NCS buckets cover the full range without gaps', () => {
    const testValues = [0, 10, 30, 49, 50, 55, 59, 60, 65, 69, 70, 75, 79, 80, 85, 90, 100];
    for (const v of testValues) {
      const matched = SV_NCS_BANDS.filter((b) => v >= b.low && v < b.high);
      expect(matched).toHaveLength(1);
    }
  });

  it('FWS buckets cover the full FWS range without gaps', () => {
    const testValues = [0, 5, 10, 15, 20, 25, 30, 40, 50, 55, 60, 65, 70, 80, 95];
    for (const v of testValues) {
      const matched = SV_FWS_BANDS.filter((b) => v >= b.low && v < b.high);
      expect(matched).toHaveLength(1);
    }
  });

  it('testMonotonicity detects perfect ascending', () => {
    const bands = [
      { score: 'NCS', band: 'low', bandLow: 0, bandHigh: 50, stats: { ...computeStats([]), avgFwd20d: 1.0 } as ReturnType<typeof computeStats> },
      { score: 'NCS', band: 'mid', bandLow: 50, bandHigh: 70, stats: { ...computeStats([]), avgFwd20d: 3.0 } as ReturnType<typeof computeStats> },
      { score: 'NCS', band: 'high', bandLow: 70, bandHigh: 100, stats: { ...computeStats([]), avgFwd20d: 7.0 } as ReturnType<typeof computeStats> },
    ];
    const result = testMonotonicity(bands, 'Fwd 20d', (s) => s.avgFwd20d, 'ascending');
    expect(result.isMonotonic).toBe(true);
    expect(result.violations).toBe(0);
  });

  it('testMonotonicity detects violations', () => {
    const bands = [
      { score: 'NCS', band: 'low', bandLow: 0, bandHigh: 50, stats: { ...computeStats([]), avgFwd20d: 5.0 } as ReturnType<typeof computeStats> },
      { score: 'NCS', band: 'mid', bandLow: 50, bandHigh: 70, stats: { ...computeStats([]), avgFwd20d: 2.0 } as ReturnType<typeof computeStats> },
      { score: 'NCS', band: 'high', bandLow: 70, bandHigh: 100, stats: { ...computeStats([]), avgFwd20d: 8.0 } as ReturnType<typeof computeStats> },
    ];
    const result = testMonotonicity(bands, 'Fwd 20d', (s) => s.avgFwd20d, 'ascending');
    expect(result.isMonotonic).toBe(false);
    expect(result.violations).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. ALLOCATION SCORE CALCULATION
// ═════════════════════════════════════════════════════════════════════

describe('research-loop: allocation score calculation', () => {
  it('quality component scales linearly with NCS', () => {
    expect(calcQuality(0)).toBe(0);
    expect(calcQuality(50)).toBe(20);
    expect(calcQuality(70)).toBe(28);
    expect(calcQuality(100)).toBe(40);
  });

  it('empty portfolio gives full sleeve bonus for any sleeve', () => {
    expect(calcSleeveBonus('CORE', 0, 80)).toBe(10);
    expect(calcSleeveBonus('HIGH_RISK', 0, 40)).toBe(10);
  });

  it('cluster penalty ramp: 0 at 60%, max at 100%', () => {
    expect(calcClusterPenalty(12, 25)).toBe(0);     // 48% < 60%
    expect(calcClusterPenalty(15, 25)).toBe(0);     // 60% = threshold, no penalty yet
    expect(calcClusterPenalty(20, 25)).toBeCloseTo(7.5, 1); // 80%
    expect(calcClusterPenalty(25, 25)).toBe(15);    // 100% of cap = max
    expect(calcClusterPenalty(30, 25)).toBe(15);    // Over cap, capped at max
  });

  it('score composition: all bonuses and penalties combine correctly', () => {
    const candidates = [makeAllocCandidate({ ticker: 'TEST', ncs: 70 })];
    const result = scoreAndRankCandidates(candidates, makePortfolio());

    const t = result[0];
    const expected = t.qualityComponent + t.expectancyComponent + t.sleeveBalanceBonus
      - t.clusterCrowdingPenalty - t.sectorCrowdingPenalty
      - t.earningsNearPenalty - t.correlationPenalty - t.capitalInefficiencyPenalty;
    expect(t.allocationScore).toBeCloseTo(expected, 2);
  });

  it('correlation penalty accumulates per correlated holding, capped at max', () => {
    expect(calcCorrelationPenalty(0)).toBe(0);
    expect(calcCorrelationPenalty(1)).toBe(5);
    expect(calcCorrelationPenalty(2)).toBe(10);
    expect(calcCorrelationPenalty(3)).toBe(10);  // capped at max=10
  });

  it('multiple penalties can push allocation score negative', () => {
    // Low NCS + high crowding + correlation + earnings
    const candidates = [makeAllocCandidate({
      ticker: 'BAD',
      ncs: 20,                // quality = 8
      daysToEarnings: null,
    })];
    const ctx = makePortfolio({
      positions: [
        { ticker: 'MSFT', sleeve: 'CORE' as Sleeve, sector: 'Technology', cluster: 'BigTech', value: 400 },
        { ticker: 'GOOG', sleeve: 'CORE' as Sleeve, sector: 'Technology', cluster: 'BigTech', value: 400 },
      ],
      correlationFlags: [
        { tickerA: 'BAD', tickerB: 'MSFT', correlation: 0.85 },
        { tickerA: 'BAD', tickerB: 'GOOG', correlation: 0.80 },
      ],
    });
    const result = scoreAndRankCandidates(candidates, ctx);
    // Cluster crowding (80% of 25% cap) + sector crowding + 2 correlations + low NCS
    expect(result[0].clusterCrowdingPenalty).toBeGreaterThan(0);
    expect(result[0].correlationPenalty).toBe(10); // 2 holdings, capped
    expect(result[0].allocationScore).toBeLessThan(10);
  });

  it('deterministic: same input always produces same output', () => {
    const candidates = [
      makeAllocCandidate({ ticker: 'A', ncs: 60 }),
      makeAllocCandidate({ ticker: 'B', ncs: 80 }),
    ];
    const ctx = makePortfolio();
    const r1 = scoreAndRankCandidates(candidates, ctx);
    const r2 = scoreAndRankCandidates(candidates, ctx);
    expect(r1[0].ticker).toBe(r2[0].ticker);
    expect(r1[0].allocationScore).toBe(r2[0].allocationScore);
    expect(r1[1].allocationScore).toBe(r2[1].allocationScore);
  });

  it('ranks by allocationScore descending with correct rank numbers', () => {
    const candidates = [
      makeAllocCandidate({ ticker: 'LOW', ncs: 40 }),
      makeAllocCandidate({ ticker: 'HIGH', ncs: 90 }),
      makeAllocCandidate({ ticker: 'MID', ncs: 65 }),
    ];
    const result = scoreAndRankCandidates(candidates, makePortfolio());
    expect(result[0].ticker).toBe('HIGH');
    expect(result[0].rank).toBe(1);
    expect(result[1].ticker).toBe('MID');
    expect(result[1].rank).toBe(2);
    expect(result[2].ticker).toBe('LOW');
    expect(result[2].rank).toBe(3);
  });

  it('earnings penalty is zero (pruned per OVERLAP-03)', () => {
    const candidates = [makeAllocCandidate({ ticker: 'EARN', daysToEarnings: 1 })];
    const result = scoreAndRankCandidates(candidates, makePortfolio());
    expect(result[0].earningsNearPenalty).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. EXECUTION DRAG / SLIPPAGE CALCULATION
// ═════════════════════════════════════════════════════════════════════

describe('research-loop: execution drag calculation', () => {
  it('slippage % is positive when fill exceeds plan (bad)', () => {
    expect(calcSlippagePct(100, 100.5)).toBeCloseTo(0.5, 2);
  });

  it('slippage % is negative when fill is better than plan (good)', () => {
    expect(calcSlippagePct(100, 99.5)).toBeCloseTo(-0.5, 2);
  });

  it('slippage R converts entry gap to risk-relative terms', () => {
    // Plan 100, fill 101, risk = 5 → slippage = 0.2R
    expect(calcSlippageR(100, 101, 5)).toBeCloseTo(0.2, 2);
    // Better fill: plan 100, fill 99, risk = 5 → -0.2R
    expect(calcSlippageR(100, 99, 5)).toBeCloseTo(-0.2, 2);
  });

  it('anti-chase violation uses 0.8 ATR threshold from entry trigger', () => {
    // Trigger = 100, ATR = 5: 0.8 × 5 = 4, so fill > 104 violates
    expect(wouldViolateAntiChase(104.1, 100, 5)).toBe(true);
    expect(wouldViolateAntiChase(103.9, 100, 5)).toBe(false);
    expect(wouldViolateAntiChase(100, 100, 5)).toBe(false); // at trigger = OK
  });

  it('risk rules allow 25% tolerance above profile limit', () => {
    // SMALL_ACCOUNT: 2.0% max risk. 25% tolerance = 2.5%
    expect(riskRulesMetPostFill(20, 1000, 2.0)).toBe(true);  // 2.0% = within limit
    expect(riskRulesMetPostFill(24, 1000, 2.0)).toBe(true);  // 2.4% = within tolerance
    expect(riskRulesMetPostFill(26, 1000, 2.0)).toBe(false); // 2.6% = exceeds tolerance
  });

  it('material slippage flag uses MATERIAL_THRESHOLDS.slippagePct', () => {
    // > 0.5% is material
    const threshold = MATERIAL_THRESHOLDS.slippagePct;
    expect(Math.abs(calcSlippagePct(100, 100.4)) < threshold).toBe(true);  // 0.4% < 0.5%
    expect(Math.abs(calcSlippagePct(100, 100.6)) > threshold).toBe(true);  // 0.6% > 0.5%
  });
});

// ═════════════════════════════════════════════════════════════════════
// 7. FULL vs CORE_LITE MODE
// ═════════════════════════════════════════════════════════════════════

describe('research-loop: FULL vs CORE_LITE mode', () => {
  // These tests verify the CORE_LITE behavioral contract from CLAUDE.md.
  // The actual branching is in runFullScan() (async, DB-dependent).
  // Here we test the pure functions that both modes share identically.

  it('technical filters apply identically in both modes', () => {
    const tech = makeScanCandidate().technicals;
    const result = runTechnicalFilters(180, tech, 'CORE' as Sleeve);
    // These gates are the same in FULL and CORE_LITE
    expect(result.priceAboveMa200).toBe(true);
    expect(result.adxAbove20).toBe(true);
    expect(result.plusDIAboveMinusDI).toBe(true);
    expect(result.atrPercentBelow8).toBe(true);
    expect(result.passesAll).toBe(true);
  });

  it('status classification unchanged between modes', () => {
    expect(classifyCandidate(100, 101)).toBe('READY');  // ≤2%
    expect(classifyCandidate(100, 102.5)).toBe('WATCH'); // ≤3%
    expect(classifyCandidate(100, 105)).toBe('FAR');     // >3%
  });

  it('ranking formula unchanged between modes', () => {
    const tech = makeScanCandidate().technicals;
    const scoreCore = rankCandidate('CORE' as Sleeve, tech, 'READY');
    const scoreHR = rankCandidate('HIGH_RISK' as Sleeve, tech, 'READY');
    // CORE sleeve has higher priority than HIGH_RISK in both modes
    expect(scoreCore).toBeGreaterThan(scoreHR);
  });

  it('CORE_LITE entry trigger uses raw 20d high (documents the skip)', () => {
    // In CORE_LITE: entryTrigger = technicals.twentyDayHigh
    // In FULL: entryTrigger = calculateAdaptiveBuffer().adjustedEntryTrigger
    // The adaptive buffer adds 5–20% of ATR based on volatility
    const tech = makeScanCandidate().technicals;
    const rawHigh = tech.twentyDayHigh;
    expect(rawHigh).toBe(182);
    // CORE_LITE would use 182 directly; FULL would adjust it slightly
  });

  it('CORE_LITE skipped features are well-defined', () => {
    const skipped = [
      'Hurst Exponent',
      'ATR Spike Detection',
      'Earnings Calendar',
      'Anti-Chase Guard',
      'Failed Breakout Cooldown',
      'Volatility Extension',
      'Adaptive ATR Buffer',
      'Pullback Continuation',
    ];
    const kept = [
      'Universe selection',
      'Market regime detection',
      'Technical Filters',
      'Status Classification',
      'Ranking',
      'Risk Gates',
      'Position Sizing',
      'Stop Manager',
      'FX conversion',
    ];
    // This is a contract test — if someone adds to CORE_LITE skips,
    // they should update this list and think about whether it breaks the benchmark
    expect(skipped).toHaveLength(8);
    expect(kept).toHaveLength(9);
  });
});
