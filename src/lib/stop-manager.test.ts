import { describe, expect, it } from 'vitest';
import {
  calculateProtectionStop,
  calculateStopRecommendation,
  getProtectionLevel,
} from './stop-manager';
import type { ProtectionLevel } from '@/types';

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

  // ── F-005 regression: updateStopLoss level override ──

  it('calculateStopRecommendation returns price-based level (not stop-based)', () => {
    // Entry=200, risk=6, currentStop=200 (BREAKEVEN), price=225, ATR=4.5
    // Price-based R = (225-200)/6 = 4.17 → LOCK_1R_TRAIL
    // Stop = max(200+6, 225-2*4.5) = max(206, 216) = 216
    // Stop-based R = (216-200)/6 = 2.67 → would be LOCK_08R if re-derived
    // The recommendation must carry LOCK_1R_TRAIL (price-based), not LOCK_08R
    const rec = calculateStopRecommendation(225, 200, 6, 200, 'BREAKEVEN', 4.5);
    expect(rec).not.toBeNull();
    expect(rec?.newLevel).toBe('LOCK_1R_TRAIL');
    expect(rec?.newStop).toBe(216);
    // Verify stop-based R would give a DIFFERENT (wrong) level
    const stopBasedR = (216 - 200) / 6;
    expect(getProtectionLevel(stopBasedR)).toBe('LOCK_08R'); // this is what F-005 was persisting wrongly
    expect(rec?.newLevel).not.toBe(getProtectionLevel(stopBasedR));
  });

  it('recommendation level should be passed to updateStopLoss to avoid re-derivation mismatch', () => {
    // This test documents the contract: the caller should forward rec.newLevel
    // to updateStopLoss so the DB gets the price-based level, not stop-based.
    const rec = calculateStopRecommendation(225, 200, 6, 200, 'BREAKEVEN', 4.5);
    expect(rec).not.toBeNull();
    // The level in the recommendation is price-based
    expect(rec!.newLevel).toBe('LOCK_1R_TRAIL');
    // The stop-based derivation would give LOCK_08R — a mismatch
    const stopBasedR = (rec!.newStop - 200) / 6;
    expect(getProtectionLevel(stopBasedR)).toBe('LOCK_08R');
  });

  // ── F-001 regression: sync-stops R-multiple formula ──

  it('sync-stops R-multiple formula matches getProtectionLevel (F-001)', () => {
    // Simulates the corrected sync-stops formula: (newStop - entryPrice) / initialRisk
    // Entry=100, initialRisk=10
    const entry = 100;
    const risk = 10;
    const cases: { newStop: number; expected: ProtectionLevel }[] = [
      { newStop: 95, expected: 'INITIAL' },      // R = (95-100)/10 = -0.5
      { newStop: 100, expected: 'INITIAL' },     // R = 0
      { newStop: 114, expected: 'INITIAL' },     // R = 1.4
      { newStop: 115, expected: 'BREAKEVEN' },   // R = 1.5
      { newStop: 120, expected: 'BREAKEVEN' },   // R = 2.0
      { newStop: 125, expected: 'LOCK_08R' },    // R = 2.5
      { newStop: 129, expected: 'LOCK_08R' },    // R = 2.9
      { newStop: 130, expected: 'LOCK_1R_TRAIL' }, // R = 3.0
    ];
    for (const { newStop, expected } of cases) {
      const rMultiple = (newStop - entry) / risk;
      expect(getProtectionLevel(rMultiple)).toBe(expected);
    }
  });

  it('old sync-stops formula was shifted +1R (regression proof)', () => {
    // The OLD (buggy) formula: (newStop - entry + risk) / risk
    // which equals (newStop - entry)/risk + 1
    // Entry=100, risk=10, newStop=115
    const entry = 100;
    const risk = 10;
    const newStop = 115;
    const correctR = (newStop - entry) / risk;        // 1.5 → BREAKEVEN ✓
    const buggyR = (newStop - entry + risk) / risk;   // 2.5 → LOCK_08R ✗
    expect(getProtectionLevel(correctR)).toBe('BREAKEVEN');
    expect(getProtectionLevel(buggyR)).toBe('LOCK_08R');
    // These must be different — proving the bug existed
    expect(getProtectionLevel(correctR)).not.toBe(getProtectionLevel(buggyR));
  });
});

// ── F-002 regression: sync-stops initialRisk fallback ──
// Tests the formula logic used in prisma/sync-stops.ts,
// specifically the ?? vs || fix and guard for initialRisk <= 0.

describe('sync-stops initialRisk handling (F-002)', () => {
  /**
   * Replicates the corrected sync-stops initialRisk resolution:
   *   const initialRisk = matched.initialRisk ?? (matched.entryPrice - newStop);
   *   if (!initialRisk || initialRisk <= 0) → skip
   */
  function resolveInitialRisk(
    matchedInitialRisk: number | null | undefined,
    entryPrice: number,
    newStop: number
  ): number | null {
    const initialRisk = matchedInitialRisk ?? (entryPrice - newStop);
    if (!initialRisk || initialRisk <= 0) return null; // guard: skip
    return initialRisk;
  }

  it('uses DB initialRisk when it is a normal positive value', () => {
    // matched.initialRisk = 10, entryPrice = 100, newStop = 115
    expect(resolveInitialRisk(10, 100, 115)).toBe(10);
  });

  it('preserves initialRisk = 0 with ?? (does not fall through to fallback)', () => {
    // With || (old code): 0 is falsy → fallback = 100 - 110 = -10 → guard blocks
    // With ?? (new code): 0 is kept → guard blocks (initialRisk <= 0)
    // Either way the position is skipped, but ?? is correct by design.
    const result = resolveInitialRisk(0, 100, 110);
    expect(result).toBeNull(); // guard blocks: initialRisk = 0 <= 0
  });

  it('falls back to entryPrice - newStop when initialRisk is null', () => {
    // matched.initialRisk = null → fallback = 100 - 90 = 10 (positive, valid)
    expect(resolveInitialRisk(null, 100, 90)).toBe(10);
  });

  it('falls back to entryPrice - newStop when initialRisk is undefined', () => {
    // matched.initialRisk = undefined → fallback = 100 - 90 = 10
    expect(resolveInitialRisk(undefined, 100, 90)).toBe(10);
  });

  it('guard blocks when fallback produces negative value (stop > entry)', () => {
    // matched.initialRisk = null → fallback = 100 - 110 = -10 → guard blocks
    expect(resolveInitialRisk(null, 100, 110)).toBeNull();
  });

  it('guard blocks when fallback produces zero (stop = entry)', () => {
    // matched.initialRisk = null → fallback = 100 - 100 = 0 → guard blocks
    expect(resolveInitialRisk(null, 100, 100)).toBeNull();
  });

  it('old || operator would wrongly use fallback when initialRisk is 0', () => {
    // Proves the bug: with ||, initialRisk=0 → fallback = entryPrice - newStop
    // If stop > entry, fallback is negative → protection level defaults to INITIAL
    // but the real issue is the wrong code path being taken
    const matchedInitialRisk = 0;
    const entryPrice = 100;
    const newStop = 110;
    // Old behavior (||):  0 || (100 - 110) = -10
    const oldResult = matchedInitialRisk || (entryPrice - newStop);
    expect(oldResult).toBe(-10); // wrong: used fallback instead of keeping 0
    // New behavior (??):  0 ?? (100 - 110) = 0
    const newResult = matchedInitialRisk ?? (entryPrice - newStop);
    expect(newResult).toBe(0); // correct: kept the 0
  });
});
