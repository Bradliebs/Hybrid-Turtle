import { describe, expect, it } from 'vitest';
import { extractAttribution } from './filter-attribution';
import type { ScanCandidate, Sleeve } from '@/types';

function makeMockCandidate(overrides?: Partial<ScanCandidate>): ScanCandidate {
  return {
    id: 'TEST',
    ticker: 'TEST',
    name: 'Test Corp',
    sleeve: 'CORE' as Sleeve,
    sector: 'Technology',
    cluster: 'BigTech',
    price: 100,
    technicals: {
      currentPrice: 100,
      ma200: 90,
      adx: 25,
      plusDI: 30,
      minusDI: 15,
      atr: 3,
      atr20DayAgo: 2.8,
      atrSpiking: false,
      medianAtr14: 2.9,
      atrPercent: 3.0,
      twentyDayHigh: 102,
      efficiency: 45,
      relativeStrength: 12,
      volumeRatio: 1.5,
      failedBreakoutAt: null,
    },
    entryTrigger: 102,
    stopPrice: 97.5,
    distancePercent: 2.0,
    status: 'READY',
    rankScore: 65.4,
    passesAllFilters: true,
    passesRiskGates: true,
    passesAntiChase: true,
    riskGateResults: [
      { passed: true, gate: 'TOTAL_RISK', message: 'OK', current: 5, limit: 10 },
    ],
    antiChaseResult: { passed: true, reason: 'No chase detected' },
    filterResults: {
      priceAboveMa200: true,
      adxAbove20: true,
      plusDIAboveMinusDI: true,
      atrPercentBelow8: true,
      efficiencyAbove30: true,
      dataQuality: true,
      atrSpiking: false,
      atrSpikeAction: 'NONE',
      hurstExponent: 0.62,
      hurstWarn: false,
    },
    ...overrides,
  };
}

describe('filter-attribution', () => {
  describe('extractAttribution', () => {
    it('extracts all filter fields from a READY candidate', () => {
      const candidate = makeMockCandidate();
      const result = extractAttribution(candidate, 'scan_001', 'BULLISH');

      expect(result.ticker).toBe('TEST');
      expect(result.scanId).toBe('scan_001');
      expect(result.regime).toBe('BULLISH');
      expect(result.sleeve).toBe('CORE');
      expect(result.status).toBe('READY');
      expect(result.priceAboveMa200).toBe(true);
      expect(result.adxAbove20).toBe(true);
      expect(result.adxValue).toBe(25);
      expect(result.plusDIAboveMinusDI).toBe(true);
      expect(result.atrPctBelow8).toBe(true);
      expect(result.atrPctValue).toBe(3.0);
      expect(result.efficiencyAbove30).toBe(true);
      expect(result.efficiencyValue).toBe(45);
      expect(result.hurstExponent).toBe(0.62);
      expect(result.hurstWarn).toBe(false);
      expect(result.atrSpiking).toBe(false);
      expect(result.passesAllFilters).toBe(true);
      expect(result.passesRiskGates).toBe(true);
      expect(result.passesAntiChase).toBe(true);
      expect(result.riskGatesFailed).toBeNull();
      expect(result.rankScore).toBe(65.4);
    });

    it('captures failed risk gates as CSV', () => {
      const candidate = makeMockCandidate({
        passesRiskGates: false,
        riskGateResults: [
          { passed: false, gate: 'TOTAL_RISK', message: 'Over limit', current: 12, limit: 10 },
          { passed: true, gate: 'MAX_POSITIONS', message: 'OK', current: 3, limit: 4 },
          { passed: false, gate: 'CLUSTER', message: 'Cluster full', current: 26, limit: 25 },
        ],
      });
      const result = extractAttribution(candidate, 'scan_002', 'SIDEWAYS');

      expect(result.passesRiskGates).toBe(false);
      expect(result.riskGatesFailed).toBe('TOTAL_RISK,CLUSTER');
    });

    it('captures anti-chase failure reason', () => {
      const candidate = makeMockCandidate({
        passesAntiChase: false,
        antiChaseResult: {
          passed: false,
          reason: 'WAIT_PULLBACK — ext_atr 0.95 > 0.80',
        },
      });
      const result = extractAttribution(candidate, 'scan_003', 'BULLISH');

      expect(result.passesAntiChase).toBe(false);
      expect(result.antiChaseReason).toBe('WAIT_PULLBACK — ext_atr 0.95 > 0.80');
    });

    it('captures earnings info', () => {
      const candidate = makeMockCandidate({
        earningsInfo: {
          daysUntilEarnings: 3,
          nextEarningsDate: '2026-03-10T00:00:00Z',
          confidence: 'HIGH',
          action: 'DEMOTE_WATCH',
          reason: '3 days to earnings',
        },
      });
      const result = extractAttribution(candidate, 'scan_004', 'BULLISH');

      expect(result.earningsAction).toBe('DEMOTE_WATCH');
      expect(result.daysToEarnings).toBe(3);
    });

    it('handles candidate with no optional fields', () => {
      const candidate = makeMockCandidate({
        riskGateResults: undefined,
        antiChaseResult: undefined,
        earningsInfo: undefined,
        passesRiskGates: undefined,
        passesAntiChase: undefined,
      });
      const result = extractAttribution(candidate, 'scan_005', 'BEARISH');

      expect(result.passesRiskGates).toBe(true);
      expect(result.passesAntiChase).toBe(true);
      expect(result.riskGatesFailed).toBeNull();
      expect(result.antiChaseReason).toBeNull();
      expect(result.earningsAction).toBeNull();
    });
  });
});
