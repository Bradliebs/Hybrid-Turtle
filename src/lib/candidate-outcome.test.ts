import { describe, expect, it } from 'vitest';
import {
  extractCandidateOutcome,
  resolveStageReached,
  collectBlockedReasons,
} from './candidate-outcome';
import type { ScanCandidate, Sleeve } from '@/types';

function makeMockCandidate(overrides?: Partial<ScanCandidate>): ScanCandidate {
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
      { passed: true, gate: 'MAX_POSITIONS', message: 'OK', current: 2, limit: 4 },
    ],
    antiChaseResult: { passed: true, reason: 'No chase detected' },
    shares: 4.5,
    riskDollars: 23.63,
    riskPercent: 2.0,
    totalCost: 819,
    earningsInfo: undefined,
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

describe('candidate-outcome', () => {
  describe('resolveStageReached', () => {
    it('returns SIZED when shares are computed', () => {
      const c = makeMockCandidate({ shares: 10 });
      expect(resolveStageReached(c)).toBe('SIZED');
    });

    it('returns ANTI_CHASE when anti-chase result exists but no shares', () => {
      const c = makeMockCandidate({
        shares: undefined,
        antiChaseResult: { passed: false, reason: 'ext_atr > 0.8' },
      });
      expect(resolveStageReached(c)).toBe('ANTI_CHASE');
    });

    it('returns RISK_GATED when risk gate results exist but no anti-chase', () => {
      const c = makeMockCandidate({
        shares: undefined,
        antiChaseResult: undefined,
        riskGateResults: [{ passed: false, gate: 'TOTAL_RISK', message: 'Over', current: 12, limit: 10 }],
      });
      expect(resolveStageReached(c)).toBe('RISK_GATED');
    });

    it('returns RANKED when rankScore > 0 but no gate results', () => {
      const c = makeMockCandidate({
        shares: undefined,
        antiChaseResult: undefined,
        riskGateResults: undefined,
        rankScore: 45,
      });
      expect(resolveStageReached(c)).toBe('RANKED');
    });

    it('returns CLASSIFIED for READY/WATCH status with no ranking', () => {
      const c = makeMockCandidate({
        shares: undefined,
        antiChaseResult: undefined,
        riskGateResults: undefined,
        rankScore: 0,
        status: 'WATCH',
      });
      expect(resolveStageReached(c)).toBe('CLASSIFIED');
    });

    it('returns TECH_FILTER for FAR status with filter results', () => {
      const c = makeMockCandidate({
        shares: undefined,
        antiChaseResult: undefined,
        riskGateResults: undefined,
        rankScore: 0,
        status: 'FAR',
      });
      expect(resolveStageReached(c)).toBe('TECH_FILTER');
    });
  });

  describe('collectBlockedReasons', () => {
    it('returns null for a fully passing candidate', () => {
      const c = makeMockCandidate();
      expect(collectBlockedReasons(c)).toBeNull();
    });

    it('captures failed technical filters', () => {
      const c = makeMockCandidate({
        filterResults: {
          priceAboveMa200: false,
          adxAbove20: false,
          plusDIAboveMinusDI: true,
          atrPercentBelow8: true,
          efficiencyAbove30: true,
          dataQuality: true,
        },
      });
      const reasons = collectBlockedReasons(c);
      expect(reasons).toContain('BELOW_MA200');
      expect(reasons).toContain('ADX_LOW');
    });

    it('captures failed risk gates', () => {
      const c = makeMockCandidate({
        riskGateResults: [
          { passed: false, gate: 'TOTAL_RISK', message: 'Over', current: 12, limit: 10 },
          { passed: true, gate: 'MAX_POSITIONS', message: 'OK', current: 2, limit: 4 },
          { passed: false, gate: 'CLUSTER', message: 'Cluster full', current: 26, limit: 25 },
        ],
      });
      const reasons = collectBlockedReasons(c);
      expect(reasons).toContain('GATE_TOTAL_RISK');
      expect(reasons).toContain('GATE_CLUSTER');
      expect(reasons).not.toContain('GATE_MAX_POSITIONS');
    });

    it('captures anti-chase failure', () => {
      const c = makeMockCandidate({
        antiChaseResult: { passed: false, reason: 'ext_atr 0.95 > 0.80' },
      });
      const reasons = collectBlockedReasons(c);
      expect(reasons).toContain('ANTI_CHASE');
    });

    it('captures earnings block', () => {
      const c = makeMockCandidate({
        earningsInfo: {
          daysUntilEarnings: 2,
          nextEarningsDate: '2026-03-10T00:00:00Z',
          confidence: 'HIGH',
          action: 'AUTO_NO',
          reason: '2 days to earnings',
        },
      });
      const reasons = collectBlockedReasons(c);
      expect(reasons).toContain('EARNINGS_BLOCK');
    });

    it('captures ATR spike actions', () => {
      const c = makeMockCandidate({
        filterResults: {
          priceAboveMa200: true,
          adxAbove20: true,
          plusDIAboveMinusDI: true,
          atrPercentBelow8: true,
          efficiencyAbove30: true,
          dataQuality: true,
          atrSpiking: true,
          atrSpikeAction: 'HARD_BLOCK',
        },
      });
      const reasons = collectBlockedReasons(c);
      expect(reasons).toContain('ATR_SPIKE_BLOCK');
    });

    it('captures cooldown status', () => {
      const c = makeMockCandidate({ status: 'COOLDOWN' });
      const reasons = collectBlockedReasons(c);
      expect(reasons).toContain('COOLDOWN');
    });
  });

  describe('extractCandidateOutcome', () => {
    it('extracts a full record from a READY candidate', () => {
      const c = makeMockCandidate();
      const record = extractCandidateOutcome(c, 'scan_001', 'BULLISH', 'LIVE');

      expect(record.scanId).toBe('scan_001');
      expect(record.ticker).toBe('AAPL');
      expect(record.name).toBe('Apple Inc');
      expect(record.sleeve).toBe('CORE');
      expect(record.sector).toBe('Technology');
      expect(record.cluster).toBe('BigTech');
      expect(record.status).toBe('READY');
      expect(record.stageReached).toBe('SIZED');
      expect(record.passedTechFilter).toBe(true);
      expect(record.passedRiskGates).toBe(true);
      expect(record.passedAntiChase).toBe(true);
      expect(record.blockedByRegime).toBe(false);
      expect(record.regime).toBe('BULLISH');
      expect(record.price).toBe(180);
      expect(record.ma200).toBe(165);
      expect(record.adx).toBe(32);
      expect(record.atrPct).toBe(1.94);
      expect(record.volumeRatio).toBe(1.6);
      expect(record.relativeStrength).toBe(12.5);
      expect(record.hurstExponent).toBe(0.65);
      expect(record.rankScore).toBe(72.5);
      expect(record.entryTrigger).toBe(182);
      expect(record.stopPrice).toBe(176.75);
      expect(record.suggestedShares).toBe(4.5);
      expect(record.suggestedRiskGbp).toBe(23.63);
      expect(record.dataFreshness).toBe('LIVE');
      expect(record.tradePlaced).toBe(false);
      expect(record.tradeLogId).toBeNull();
      expect(record.fwdReturn5d).toBeNull();
      expect(record.enrichedAt).toBeNull();
    });

    it('marks blockedByRegime=true for BEARISH regime', () => {
      const c = makeMockCandidate();
      const record = extractCandidateOutcome(c, 'scan_002', 'BEARISH');
      expect(record.blockedByRegime).toBe(true);
    });

    it('captures entry mode as PULLBACK_CONTINUATION when triggered', () => {
      const c = makeMockCandidate({
        pullbackSignal: {
          triggered: true,
          mode: 'PULLBACK_CONTINUATION',
          anchor: 181,
          zoneLow: 180,
          zoneHigh: 182,
          entryPrice: 181,
          stopPrice: 178,
          reason: 'Pullback from 20d high',
        },
      });
      const record = extractCandidateOutcome(c, 'scan_003', 'BULLISH');
      expect(record.entryMode).toBe('PULLBACK_CONTINUATION');
    });

    it('handles candidate with no optional fields', () => {
      const c = makeMockCandidate({
        riskGateResults: undefined,
        antiChaseResult: undefined,
        earningsInfo: undefined,
        shares: undefined,
        riskDollars: undefined,
        passesRiskGates: undefined,
        passesAntiChase: undefined,
      });
      const record = extractCandidateOutcome(c, 'scan_004', 'SIDEWAYS');

      expect(record.passedRiskGates).toBe(false);
      expect(record.passedAntiChase).toBe(true);
      expect(record.suggestedShares).toBeNull();
      expect(record.suggestedRiskGbp).toBeNull();
      expect(record.riskGatesFailed).toBeNull();
      expect(record.antiChaseReason).toBeNull();
    });
  });
});
