import { describe, expect, it } from 'vitest';
import {
  calculateProtectionStop,
  calculateStopRecommendation,
  getProtectionLevel,
} from './stop-manager';

describe('stop-manager formulas', () => {
  it('maps R-multiple thresholds to expected protection levels', () => {
    expect(getProtectionLevel(1.49)).toBe('INITIAL');
    expect(getProtectionLevel(1.5)).toBe('BREAKEVEN');
    expect(getProtectionLevel(2.5)).toBe('LOCK_08R');
    expect(getProtectionLevel(3.0)).toBe('LOCK_1R_TRAIL');
  });

  it('uses max(lock floor, trailing ATR) for LOCK_1R_TRAIL stop', () => {
    const stop = calculateProtectionStop(100, 10, 'LOCK_1R_TRAIL', 150, 5);
    expect(stop).toBe(140);
  });

  it('recommends breakeven upgrade when +1.5R is reached', () => {
    const rec = calculateStopRecommendation(116, 100, 10, 90, 'INITIAL');
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('BREAKEVEN');
    expect(rec?.newStop).toBe(100);
  });

  it('returns null when recommended level is not an upgrade', () => {
    const rec = calculateStopRecommendation(118, 100, 10, 100, 'BREAKEVEN');
    expect(rec).toBeNull();
  });

  it('returns null when computed stop would not move up (monotonic)', () => {
    const rec = calculateStopRecommendation(125, 100, 10, 105, 'INITIAL');
    expect(rec).toBeNull();
  });

  it('uses max(lock floor, trailing ATR) for LOCK_1R_TRAIL recommendation', () => {
    // Entry: 100, risk: 10, current stop: 90 (INITIAL)
    // Price at 130 = 3R → LOCK_1R_TRAIL
    // Lock floor = 100 + 1*10 = 110
    // Trailing ATR = 130 - 2*5 = 120
    // Should pick max(110, 120) = 120
    const rec = calculateStopRecommendation(130, 100, 10, 90, 'INITIAL', 5);
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_1R_TRAIL');
    expect(rec?.newStop).toBe(120);
  });

  it('falls back to lock floor when ATR is not provided for LOCK_1R_TRAIL', () => {
    // Same scenario but no ATR → should still upgrade to 110 (lock floor)
    const rec = calculateStopRecommendation(130, 100, 10, 90, 'INITIAL');
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_1R_TRAIL');
    expect(rec?.newStop).toBe(110);
  });
});
