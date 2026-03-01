/**
 * Tests for ev-modifier.ts
 * Covers: all modifier tiers, boundaries, data quality classification,
 *         classifyAtrBucket, edge cases
 */
import { describe, it, expect } from 'vitest';
import { getEVModifier, classifyAtrBucket, type EVModifierResult } from './ev-modifier';
import type { ExpectancySlice } from './ev-tracker';

// ── Helper: build a mock ExpectancySlice ─────────────────────
function makeSlice(overrides: Partial<ExpectancySlice> = {}): ExpectancySlice {
  return {
    key: 'TEST',
    tradeCount: 15,
    winCount: 8,
    lossCount: 5,
    breakevenCount: 2,
    winRate: 0.53,
    avgWin: 2.1,
    avgLoss: -0.8,
    expectancy: 0.7,
    totalR: 10.5,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
//  classifyAtrBucket
// ══════════════════════════════════════════════════════════════

describe('classifyAtrBucket', () => {
  it('returns UNKNOWN for null/undefined/zero/negative', () => {
    expect(classifyAtrBucket(null)).toBe('UNKNOWN');
    expect(classifyAtrBucket(undefined)).toBe('UNKNOWN');
    expect(classifyAtrBucket(0)).toBe('UNKNOWN');
    expect(classifyAtrBucket(-1)).toBe('UNKNOWN');
  });

  it('classifies LOW (< 2%)', () => {
    expect(classifyAtrBucket(0.5)).toBe('LOW');
    expect(classifyAtrBucket(1.99)).toBe('LOW');
  });

  it('classifies MEDIUM (2% – < 4%)', () => {
    expect(classifyAtrBucket(2)).toBe('MEDIUM');
    expect(classifyAtrBucket(3.99)).toBe('MEDIUM');
  });

  it('classifies HIGH (4% – < 7%)', () => {
    expect(classifyAtrBucket(4)).toBe('HIGH');
    expect(classifyAtrBucket(6.99)).toBe('HIGH');
  });

  it('classifies EXTREME (>= 7%)', () => {
    expect(classifyAtrBucket(7)).toBe('EXTREME');
    expect(classifyAtrBucket(15)).toBe('EXTREME');
  });

  it('exact boundary at 2% → MEDIUM', () => {
    expect(classifyAtrBucket(2)).toBe('MEDIUM');
  });

  it('exact boundary at 4% → HIGH', () => {
    expect(classifyAtrBucket(4)).toBe('HIGH');
  });

  it('exact boundary at 7% → EXTREME', () => {
    expect(classifyAtrBucket(7)).toBe('EXTREME');
  });
});

// ══════════════════════════════════════════════════════════════
//  getEVModifier — data quality classification
// ══════════════════════════════════════════════════════════════

describe('getEVModifier data quality', () => {
  it('returns NO_DATA when slice is null', () => {
    const result = getEVModifier(null);
    expect(result.dataQuality).toBe('NO_DATA');
    expect(result.modifier).toBe(0);
    expect(result.tradeCount).toBe(0);
    expect(result.expectancy).toBeNull();
  });

  it('returns NO_DATA when slice has zero trades', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 0 }));
    expect(result.dataQuality).toBe('NO_DATA');
    expect(result.modifier).toBe(0);
  });

  it('returns INSUFFICIENT when trades < 10', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 5, expectancy: 1.5 }));
    expect(result.dataQuality).toBe('INSUFFICIENT');
    expect(result.modifier).toBe(0);
    expect(result.tradeCount).toBe(5);
    expect(result.expectancy).toBe(1.5);
  });

  it('returns INSUFFICIENT at exactly 9 trades', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 9, expectancy: 0.8 }));
    expect(result.dataQuality).toBe('INSUFFICIENT');
    expect(result.modifier).toBe(0);
  });

  it('returns SUFFICIENT at exactly 10 trades', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 10, expectancy: 0.8 }));
    expect(result.dataQuality).toBe('SUFFICIENT');
    expect(result.modifier).toBe(5); // > 0.5R → +5
  });
});

// ══════════════════════════════════════════════════════════════
//  getEVModifier — modifier tiers
// ══════════════════════════════════════════════════════════════

describe('getEVModifier modifier tiers', () => {
  it('strong positive: expectancy > 0.5R → +5', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: 0.8 }));
    expect(result.modifier).toBe(5);
  });

  it('marginal positive: expectancy 0 – 0.5R → 0', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: 0.3 }));
    expect(result.modifier).toBe(0);
  });

  it('exactly 0 expectancy → 0 modifier', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: 0 }));
    expect(result.modifier).toBe(0);
  });

  it('marginal negative: expectancy -0.5 – 0R → -5', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: -0.3 }));
    expect(result.modifier).toBe(-5);
  });

  it('exactly -0.5 expectancy → -5 modifier', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: -0.5 }));
    expect(result.modifier).toBe(-5);
  });

  it('strong negative: expectancy < -0.5R → -10', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: -0.8 }));
    expect(result.modifier).toBe(-10);
  });

  it('very negative: expectancy -2.0R → -10 (capped)', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: -2.0 }));
    expect(result.modifier).toBe(-10);
  });
});

// ══════════════════════════════════════════════════════════════
//  getEVModifier — boundary values
// ══════════════════════════════════════════════════════════════

describe('getEVModifier boundary values', () => {
  it('exactly 0.5R → 0 modifier (not +5, needs > 0.5)', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: 0.5 }));
    expect(result.modifier).toBe(0);
  });

  it('0.51R → +5', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: 0.51 }));
    expect(result.modifier).toBe(5);
  });

  it('-0.01R → -5', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: -0.01 }));
    expect(result.modifier).toBe(-5);
  });

  it('-0.51R → -10', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: -0.51 }));
    expect(result.modifier).toBe(-10);
  });
});

// ══════════════════════════════════════════════════════════════
//  getEVModifier — diagnostics
// ══════════════════════════════════════════════════════════════

describe('getEVModifier diagnostics', () => {
  it('includes expectancy in result', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 20, expectancy: 0.42 }));
    expect(result.expectancy).toBe(0.42);
  });

  it('includes tradeCount in result', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 37, expectancy: 0.1 }));
    expect(result.tradeCount).toBe(37);
  });

  it('INSUFFICIENT still returns expectancy for display', () => {
    const result = getEVModifier(makeSlice({ tradeCount: 7, expectancy: -0.9 }));
    expect(result.dataQuality).toBe('INSUFFICIENT');
    expect(result.expectancy).toBe(-0.9);
    expect(result.modifier).toBe(0); // not applied yet
  });
});
