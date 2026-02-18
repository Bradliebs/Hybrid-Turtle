import { describe, expect, it } from 'vitest';
import { detectLaggards, LAGGARD_CONFIG } from './laggard-detector';

// ── Helper: build position data ─────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

function makePosition(overrides: Partial<Parameters<typeof detectLaggards>[0][0]> = {}) {
  return {
    id: 'pos-1',
    ticker: 'TEST',
    entryPrice: 100,
    entryDate: daysAgo(15), // 15 days held by default
    currentStop: 90,
    shares: 10,
    initialRisk: 5,
    currentPrice: 95, // 5% underwater by default
    currency: 'USD',
    sleeve: 'CORE',
    ...overrides,
  };
}

// ── Basic detection tests ───────────────────────────────────

describe('detectLaggards', () => {
  it('returns empty array for no positions', () => {
    expect(detectLaggards([])).toEqual([]);
  });

  it('flags classic laggard: held 15d, 5% underwater, above stop', () => {
    const results = detectLaggards([makePosition()]);
    expect(results).toHaveLength(1);
    expect(results[0].flag).toBe('TRIM_LAGGARD');
    expect(results[0].ticker).toBe('TEST');
    expect(results[0].daysHeld).toBe(15);
    expect(results[0].lossPct).toBeCloseTo(5.0, 0);
  });

  it('does not flag positions held less than holdingDays', () => {
    const results = detectLaggards([
      makePosition({ entryDate: daysAgo(5) }), // Only 5 days
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag positions that are profitable', () => {
    const results = detectLaggards([
      makePosition({ currentPrice: 110 }), // In profit
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag positions with small loss < minLossPct', () => {
    const results = detectLaggards([
      makePosition({ currentPrice: 99 }), // Only 1% loss, below 2% threshold
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag positions at stop level', () => {
    const results = detectLaggards([
      makePosition({ currentPrice: 89, currentStop: 90 }), // Below stop
    ]);
    expect(results).toHaveLength(0);
  });

  it('skips HEDGE positions', () => {
    const results = detectLaggards([
      makePosition({ sleeve: 'HEDGE' }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('skips positions with zero initialRisk', () => {
    const results = detectLaggards([
      makePosition({ initialRisk: 0 }),
    ]);
    expect(results).toHaveLength(0);
  });
});

// ── Dead money detection ─────────────────────────────────────

describe('dead money detection', () => {
  it('flags dead money: held 35d, slightly profitable (0.3R), stalled', () => {
    // R-multiple = (currentPrice - entryPrice) / initialRisk = (101.5 - 100) / 5 = 0.3
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(35),
        currentPrice: 101.5,
      }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].flag).toBe('DEAD_MONEY');
    expect(results[0].rMultiple).toBeCloseTo(0.3, 1);
  });

  it('does not flag dead money before deadMoneyDays threshold', () => {
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(25), // < 30 days
        currentPrice: 101.5,
      }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag dead money if R >= deadMoneyMaxR', () => {
    // R = (103 - 100) / 5 = 0.6 → above 0.5R threshold
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(35),
        currentPrice: 103,
      }),
    ]);
    expect(results).toHaveLength(0);
  });

  it('does not flag dead money if in freefall (R < -1.0)', () => {
    // R = (92 - 100) / 5 = -1.6 → freefall, should be a stop issue
    const results = detectLaggards([
      makePosition({
        entryDate: daysAgo(35),
        currentPrice: 92,
        currentStop: 85, // Above stop so not stop-hit
      }),
    ]);
    // This position is deeply underwater but above stop. It should be flagged as TRIM_LAGGARD
    // since it meets laggard criteria (held 35d, 8% loss, above stop), not dead money.
    const deadMoney = results.filter(r => r.flag === 'DEAD_MONEY');
    expect(deadMoney).toHaveLength(0);
  });
});

// ── Multiple positions ──────────────────────────────────────

describe('multiple positions', () => {
  it('flags multiple laggards independently', () => {
    const results = detectLaggards([
      makePosition({ id: 'pos-1', ticker: 'AAPL', currentPrice: 95 }),
      makePosition({ id: 'pos-2', ticker: 'MSFT', currentPrice: 96 }),
      makePosition({ id: 'pos-3', ticker: 'GOOD', currentPrice: 110 }), // profitable → not flagged
    ]);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.ticker).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('does not double-flag laggard as dead money', () => {
    // Position meets BOTH laggard and dead money criteria
    // Held 35d, 5% underwater, above stop — should be TRIM_LAGGARD only
    const results = detectLaggards([
      makePosition({ entryDate: daysAgo(35) }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].flag).toBe('TRIM_LAGGARD');
  });
});

// ── Result shape ────────────────────────────────────────────

describe('result shape', () => {
  it('includes all required fields', () => {
    const results = detectLaggards([makePosition()]);
    const r = results[0];
    expect(r.positionId).toBe('pos-1');
    expect(r.ticker).toBe('TEST');
    expect(typeof r.daysHeld).toBe('number');
    expect(typeof r.rMultiple).toBe('number');
    expect(typeof r.lossPct).toBe('number');
    expect(r.flag).toBeDefined();
    expect(r.reason).toBeDefined();
    expect(r.currency).toBe('USD');
  });
});
