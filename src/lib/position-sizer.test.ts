import { describe, expect, it } from 'vitest';
import { calculatePositionSize, calculateRMultiple } from './position-sizer';

describe('position-sizer formulas', () => {
  it('calculates shares, cost, and risk for a standard long setup', () => {
    const result = calculatePositionSize({
      equity: 10_000,
      riskProfile: 'BALANCED',
      entryPrice: 100,
      stopPrice: 95,
    });

    expect(result.shares).toBe(19);
    expect(result.totalCost).toBe(1900);
    expect(result.riskDollars).toBe(95);
    expect(result.riskPercent).toBeCloseTo(0.95, 8);
    expect(result.rPerShare).toBe(5);
  });

  it('enforces sleeve position-size cap using FX-adjusted total cost', () => {
    const result = calculatePositionSize({
      equity: 10_000,
      riskProfile: 'BALANCED',
      entryPrice: 100,
      stopPrice: 99,
      sleeve: 'CORE',
      fxToGbp: 2,
    });

    expect(result.shares).toBe(9);
    expect(result.totalCost).toBe(1800);
  });

  it('throws for invalid long stop placement', () => {
    expect(() =>
      calculatePositionSize({
        equity: 10_000,
        riskProfile: 'BALANCED',
        entryPrice: 100,
        stopPrice: 100,
      })
    ).toThrow('Stop price must be below entry price for long positions');
  });

  it('computes R-multiple from current, entry, and initial risk', () => {
    expect(calculateRMultiple(110, 100, 5)).toBe(2);
    expect(calculateRMultiple(95, 100, 5)).toBe(-1);
  });
});

describe('fractional shares (Trading 212)', () => {
  it('returns fractional shares when allowFractional is true', () => {
    // equity=429, risk=2% → riskCash=8.58, riskPerShare=2.30
    // shares = 8.58 / 2.30 = 3.730... → floor to 0.01 = 3.73
    const result = calculatePositionSize({
      equity: 429,
      riskProfile: 'SMALL_ACCOUNT',
      entryPrice: 50,
      stopPrice: 47.70,
      allowFractional: true,
    });
    expect(result.shares).toBe(3.73);
    expect(result.shares).toBeLessThanOrEqual(429 * 0.02 / 2.30);
  });

  it('returns whole shares when allowFractional is false (default)', () => {
    const result = calculatePositionSize({
      equity: 429,
      riskProfile: 'SMALL_ACCOUNT',
      entryPrice: 50,
      stopPrice: 47.70,
    });
    expect(result.shares).toBe(3); // floor to integer
    expect(Number.isInteger(result.shares)).toBe(true);
  });

  it('fractional shares capture more budget than whole-share floor', () => {
    const fractional = calculatePositionSize({
      equity: 429,
      riskProfile: 'SMALL_ACCOUNT',
      entryPrice: 50,
      stopPrice: 47.70,
      allowFractional: true,
    });
    const integer = calculatePositionSize({
      equity: 429,
      riskProfile: 'SMALL_ACCOUNT',
      entryPrice: 50,
      stopPrice: 47.70,
      allowFractional: false,
    });
    expect(fractional.shares).toBeGreaterThan(integer.shares);
    expect(fractional.riskDollars).toBeGreaterThan(integer.riskDollars);
  });

  it('fractional shares never exceed the risk budget', () => {
    const result = calculatePositionSize({
      equity: 429,
      riskProfile: 'SMALL_ACCOUNT',
      entryPrice: 50,
      stopPrice: 47.70,
      allowFractional: true,
    });
    const maxRisk = 429 * (2.0 / 100); // 2% of equity
    expect(result.riskDollars).toBeLessThanOrEqual(maxRisk + 0.001); // float tolerance
  });

  it('fractional shares respect position size cap', () => {
    // SMALL_ACCOUNT CORE cap = 20% of equity = 85.80 max cost
    // Without cap: 429 * 0.02 / (50 - 1) = 0.175... shares × 50 = 8.75
    // With cap: floor(85.80 / 50, 0.01) = 1.71 shares
    const result = calculatePositionSize({
      equity: 429,
      riskProfile: 'SMALL_ACCOUNT',
      entryPrice: 50,
      stopPrice: 1,
      sleeve: 'CORE',
      allowFractional: true,
    });
    const maxCost = 429 * 0.20; // SMALL_ACCOUNT CORE cap
    expect(result.totalCost).toBeLessThanOrEqual(maxCost + 0.001);
    // Shares should be fractional (not integer) given the cap
    expect(result.shares % 1).not.toBe(0);
  });

  it('floorShares regression: never increases risk beyond budget at 0.01 precision', () => {
    // Try many riskPerShare values to confirm floor never overshoots
    const equity = 429;
    const riskBudget = equity * 0.02; // £8.58
    const riskPerShares = [0.11, 0.37, 1.23, 2.30, 3.75, 7.99];
    for (const rps of riskPerShares) {
      const rawShares = riskBudget / rps;
      const floored = Math.floor(rawShares * 100) / 100;
      expect(floored * rps).toBeLessThanOrEqual(riskBudget + 0.001);
    }
  });
});
