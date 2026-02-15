import { describe, expect, it } from 'vitest';
import { getPassedGateCounts, reconstructCandidatesFromDbRows, type ScanResultRowForReconstruction } from './scan-db-reconstruction';

function makeRow(overrides: Partial<ScanResultRowForReconstruction>): ScanResultRowForReconstruction {
  return {
    stock: {
      ticker: 'AAA',
      name: 'AAA Inc',
      sleeve: 'CORE',
      sector: 'TECH',
      cluster: 'SOFTWARE',
      currency: 'USD',
    },
    price: 100,
    ma200: 95,
    adx: 25,
    plusDI: 30,
    minusDI: 20,
    atrPercent: 4,
    efficiency: 40,
    twentyDayHigh: 102,
    entryTrigger: 103,
    stopPrice: 97,
    distancePercent: 3,
    status: 'WATCH',
    rankScore: 60,
    passesAllFilters: true,
    passesRiskGates: true,
    passesAntiChase: true,
    shares: 10,
    riskDollars: 60,
    ...overrides,
  };
}

describe('cross-ref DB reconstruction mapper', () => {
  it('applies sleeve-aware ATR cap logic while keeping atrPercentBelow8 field name', () => {
    const rows: ScanResultRowForReconstruction[] = [
      makeRow({
        stock: { ticker: 'HR1', name: 'HR1 Inc', sleeve: 'HIGH_RISK', sector: 'TECH', cluster: 'SOFTWARE', currency: 'USD' },
        atrPercent: 7.5,
      }),
      makeRow({
        stock: { ticker: 'CR1', name: 'CR1 Inc', sleeve: 'CORE', sector: 'TECH', cluster: 'SOFTWARE', currency: 'USD' },
        atrPercent: 7.5,
      }),
      makeRow({
        stock: { ticker: 'HR2', name: 'HR2 Inc', sleeve: 'HIGH_RISK', sector: 'TECH', cluster: 'SOFTWARE', currency: 'USD' },
        atrPercent: 6.9,
      }),
    ];

    const candidates = reconstructCandidatesFromDbRows(rows);

    expect(candidates[0].filterResults.atrPercentBelow8).toBe(false);
    expect(candidates[1].filterResults.atrPercentBelow8).toBe(true);
    expect(candidates[2].filterResults.atrPercentBelow8).toBe(true);
  });

  it('preserves persisted true/false and keeps missing as unknown', () => {
    const rows: ScanResultRowForReconstruction[] = [
      makeRow({ stock: { ticker: 'AAA', name: 'AAA Inc', sleeve: 'CORE', sector: 'TECH', cluster: 'SOFTWARE', currency: 'USD' }, passesRiskGates: true, passesAntiChase: false }),
      makeRow({ stock: { ticker: 'BBB', name: 'BBB Inc', sleeve: 'CORE', sector: null, cluster: null, currency: 'USD' }, passesRiskGates: false, passesAntiChase: null }),
      makeRow({ stock: { ticker: 'CCC', name: 'CCC Inc', sleeve: 'ETF', sector: 'ETF', cluster: 'INDEX', currency: 'USD' }, passesAllFilters: false, passesRiskGates: true, passesAntiChase: true }),
    ];

    const candidates = reconstructCandidatesFromDbRows(rows);

    expect(candidates[0].passesRiskGates).toBe(true);
    expect(candidates[0].passesAntiChase).toBe(false);

    expect(candidates[1].passesRiskGates).toBe(false);
    expect(candidates[1].passesAntiChase).toBeUndefined();
    expect(candidates[1].sector).toBe('Unknown');
    expect(candidates[1].cluster).toBe('General');
  });

  it('counts only explicit true values on passed-filter candidates', () => {
    const rows: ScanResultRowForReconstruction[] = [
      makeRow({ stock: { ticker: 'AAA', name: 'AAA Inc', sleeve: 'CORE', sector: 'TECH', cluster: 'SOFTWARE', currency: 'USD' }, passesAllFilters: true, passesRiskGates: true, passesAntiChase: false }),
      makeRow({ stock: { ticker: 'BBB', name: 'BBB Inc', sleeve: 'CORE', sector: 'TECH', cluster: 'SOFTWARE', currency: 'USD' }, passesAllFilters: true, passesRiskGates: false, passesAntiChase: null }),
      makeRow({ stock: { ticker: 'CCC', name: 'CCC Inc', sleeve: 'CORE', sector: 'TECH', cluster: 'SOFTWARE', currency: 'USD' }, passesAllFilters: false, passesRiskGates: true, passesAntiChase: true }),
    ];

    const candidates = reconstructCandidatesFromDbRows(rows);
    const counts = getPassedGateCounts(candidates);

    expect(counts.passedRiskGates).toBe(1);
    expect(counts.passedAntiChase).toBe(0);
  });
});
