import { describe, expect, it } from 'vitest';
import { canPyramid, validateRiskGates } from './risk-gates';

describe('risk-gates formulas', () => {
  it('fails total open risk gate when risk exceeds profile cap', () => {
    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'TECH',
        cluster: 'SOFTWARE',
        value: 1000,
        riskDollars: 300,
      },
      [
        {
          id: '1',
          ticker: 'AAA',
          sleeve: 'CORE',
          sector: 'TECH',
          cluster: 'SOFTWARE',
          value: 1000,
          riskDollars: 300,
          shares: 10,
          entryPrice: 100,
          currentStop: 90,
          currentPrice: 120,
        },
      ],
      10_000,
      'BALANCED'
    );

    const openRiskGate = results.find((r) => r.gate === 'Total Open Risk');
    expect(openRiskGate?.passed).toBe(false);
    expect(openRiskGate?.current).toBeCloseTo(6, 8);
  });

  it('excludes HEDGE positions from open-risk and max-position counting', () => {
    const results = validateRiskGates(
      {
        sleeve: 'CORE',
        sector: 'INDUSTRIALS',
        cluster: 'AEROSPACE',
        value: 1000,
        riskDollars: 100,
      },
      [
        {
          id: 'h1',
          ticker: 'HEDGE1',
          sleeve: 'HEDGE',
          sector: 'N/A',
          cluster: 'N/A',
          value: 5000,
          riskDollars: 5000,
          shares: 50,
          entryPrice: 100,
          currentStop: 1,
          currentPrice: 120,
        },
        {
          id: 'c1',
          ticker: 'CORE1',
          sleeve: 'CORE',
          sector: 'INDUSTRIALS',
          cluster: 'AEROSPACE',
          value: 1000,
          riskDollars: 100,
          shares: 10,
          entryPrice: 100,
          currentStop: 90,
          currentPrice: 110,
        },
      ],
      10_000,
      'BALANCED'
    );

    const openRiskGate = results.find((r) => r.gate === 'Total Open Risk');
    const maxPositionsGate = results.find((r) => r.gate === 'Max Positions');
    expect(openRiskGate?.passed).toBe(true);
    expect(openRiskGate?.current).toBeCloseTo(2, 8);
    expect(maxPositionsGate?.passed).toBe(true);
    expect(maxPositionsGate?.current).toBe(2);
  });

  it('allows ATR-triggered pyramid add when trigger is reached', () => {
    const result = canPyramid(106, 100, 5, 10, 0);
    expect(result.allowed).toBe(true);
    expect(result.addNumber).toBe(1);
    expect(result.triggerPrice).toBe(105);
  });

  it('blocks pyramid adds once max adds is reached', () => {
    const result = canPyramid(130, 100, 5, 10, 2);
    expect(result.allowed).toBe(false);
    expect(result.addNumber).toBe(0);
  });
});
