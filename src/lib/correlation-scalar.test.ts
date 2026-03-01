import { describe, expect, it } from 'vitest';
import { getCorrelationScalar, applyCorrelationScalar } from './correlation-scalar';
import type { CorrelationWarning } from './correlation-scalar';

describe('getCorrelationScalar', () => {
  it('returns scalar 1.0 when no warnings exist (fail-safe: no data = no reduction)', () => {
    const result = getCorrelationScalar([]);
    expect(result.scalar).toBe(1.0);
    expect(result.reason).toBeNull();
    expect(result.correlatedTicker).toBeNull();
    expect(result.maxCorrelation).toBeNull();
  });

  it('returns scalar 0.75 for r in 0.75–0.85 range (25% reduction)', () => {
    const warnings: CorrelationWarning[] = [
      { ticker: 'MSFT', correlation: 0.80 },
    ];
    const result = getCorrelationScalar(warnings);
    expect(result.scalar).toBe(0.75);
    expect(result.correlatedTicker).toBe('MSFT');
    expect(result.maxCorrelation).toBe(0.80);
    expect(result.reason).toContain('80% correlated');
    expect(result.reason).toContain('MSFT');
    expect(result.reason).toContain('reduced by 25%');
  });

  it('returns scalar 0.50 for r in 0.85–0.93 range (50% reduction)', () => {
    const warnings: CorrelationWarning[] = [
      { ticker: 'FIX', correlation: 0.91 },
    ];
    const result = getCorrelationScalar(warnings);
    expect(result.scalar).toBe(0.50);
    expect(result.correlatedTicker).toBe('FIX');
    expect(result.maxCorrelation).toBe(0.91);
    expect(result.reason).toContain('91% correlated');
    expect(result.reason).toContain('reduced by 50%');
  });

  it('returns scalar 0.25 for r > 0.93 (75% reduction)', () => {
    const warnings: CorrelationWarning[] = [
      { ticker: 'GOOG', correlation: 0.96 },
    ];
    const result = getCorrelationScalar(warnings);
    expect(result.scalar).toBe(0.25);
    expect(result.correlatedTicker).toBe('GOOG');
    expect(result.maxCorrelation).toBe(0.96);
    expect(result.reason).toContain('96% correlated');
    expect(result.reason).toContain('reduced by 75%');
  });

  it('returns scalar 0.25 for r exactly at 0.93 boundary', () => {
    const result = getCorrelationScalar([{ ticker: 'XYZ', correlation: 0.93 }]);
    expect(result.scalar).toBe(0.25);
  });

  it('returns scalar 0.50 for r exactly at 0.85 boundary', () => {
    const result = getCorrelationScalar([{ ticker: 'XYZ', correlation: 0.85 }]);
    expect(result.scalar).toBe(0.50);
  });

  it('returns scalar 0.75 for r exactly at 0.75 boundary', () => {
    const result = getCorrelationScalar([{ ticker: 'XYZ', correlation: 0.75 }]);
    expect(result.scalar).toBe(0.75);
  });

  it('uses the highest correlation when multiple warnings exist', () => {
    const warnings: CorrelationWarning[] = [
      { ticker: 'AAPL', correlation: 0.78 },
      { ticker: 'MSFT', correlation: 0.92 },
      { ticker: 'GOOG', correlation: 0.80 },
    ];
    const result = getCorrelationScalar(warnings);
    // MSFT has highest r=0.92 → 0.85–0.93 tier → scalar 0.50
    expect(result.scalar).toBe(0.50);
    expect(result.correlatedTicker).toBe('MSFT');
    expect(result.maxCorrelation).toBe(0.92);
  });

  it('uses the highest correlation when one is extreme', () => {
    const warnings: CorrelationWarning[] = [
      { ticker: 'AAPL', correlation: 0.76 },
      { ticker: 'NVDA', correlation: 0.95 },
    ];
    const result = getCorrelationScalar(warnings);
    expect(result.scalar).toBe(0.25);
    expect(result.correlatedTicker).toBe('NVDA');
  });
});

describe('applyCorrelationScalar', () => {
  it('returns base shares unchanged when scalar is 1.0', () => {
    expect(applyCorrelationScalar(1.58, 1.0)).toBe(1.58);
  });

  it('floors to 0.01 precision after applying scalar (never rounds up)', () => {
    // 1.58 × 0.50 = 0.79 → exactly 0.79
    expect(applyCorrelationScalar(1.58, 0.50)).toBe(0.79);
  });

  it('floors fractional result correctly (T212 0.01 precision)', () => {
    // 1.33 × 0.75 = 0.9975 → floor to 0.99
    expect(applyCorrelationScalar(1.33, 0.75)).toBe(0.99);
  });

  it('floors aggressively — never overshoots', () => {
    // 2.57 × 0.25 = 0.6425 → floor to 0.64
    expect(applyCorrelationScalar(2.57, 0.25)).toBe(0.64);
  });

  it('handles zero base shares', () => {
    expect(applyCorrelationScalar(0, 0.50)).toBe(0);
  });

  it('handles whole number shares', () => {
    // 10 × 0.75 = 7.5 → floor to 7.50
    expect(applyCorrelationScalar(10, 0.75)).toBe(7.5);
  });

  it('handles very small scalar result that floors to zero', () => {
    // 0.03 × 0.25 = 0.0075 → floor to 0.00
    expect(applyCorrelationScalar(0.03, 0.25)).toBe(0);
  });
});
