import { describe, expect, it } from 'vitest';
import {
  checkAntiChasingGuard,
  checkPullbackContinuationEntry,
} from './scan-guards';

// ── Anti-Chasing Guard (Mode A) ─────────────────────────────

describe('checkAntiChasingGuard', () => {
  it('passes on non-Monday regardless of gap', () => {
    // Tuesday=2, any gap should pass
    const result = checkAntiChasingGuard(110, 100, 2, 2);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('Not Monday');
  });

  it('passes when price below entry trigger on Monday', () => {
    const result = checkAntiChasingGuard(99, 100, 2, 1);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('Below entry trigger');
  });

  it('blocks when Monday gap > 0.75 ATR', () => {
    // Gap = 105 - 100 = 5, ATR = 2, gapATR = 2.5 > 0.75
    const result = checkAntiChasingGuard(105, 100, 2, 1);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('CHASE RISK');
    expect(result.reason).toContain('ATR');
  });

  it('blocks when Monday price > 3% above trigger', () => {
    // 103.5 is 3.5% above 100 → blocked
    const result = checkAntiChasingGuard(103.5, 100, 100, 1);
    // ATR is 100 so gapATR = 3.5/100 = 0.035 < 0.75, but percent = 3.5% > 3%
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('CHASE RISK');
    expect(result.reason).toContain('%');
  });

  it('passes when Monday gap is small', () => {
    // Gap = 100.5 - 100 = 0.5, ATR = 2, gapATR = 0.25 < 0.75
    // Percent = 0.5% < 3%
    const result = checkAntiChasingGuard(100.5, 100, 2, 1);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('OK');
  });

  it('handles zero ATR gracefully', () => {
    const result = checkAntiChasingGuard(101, 100, 0, 1);
    // gapATR = 0 when ATR=0, so ATR check passes, percent = 1% < 3%
    expect(result.passed).toBe(true);
  });

  it('boundary: exactly 0.75 ATR gap passes', () => {
    // Gap = 1.5, ATR = 2, gapATR = 0.75 — not > 0.75, so passes
    const result = checkAntiChasingGuard(101.5, 100, 2, 1);
    expect(result.passed).toBe(true);
  });

  it('boundary: exactly 3.0% above trigger — FP precision makes this block', () => {
    // ((103/100) - 1) * 100 = 3.0000000000000004 due to IEEE 754 — guard correctly blocks
    const result = checkAntiChasingGuard(103.0, 100, 100, 1);
    expect(result.passed).toBe(false);
  });
});

// ── Pullback Continuation Entry (Mode B) ────────────────────

describe('checkPullbackContinuationEntry', () => {
  it('inactive for non-WAIT_PULLBACK status', () => {
    const result = checkPullbackContinuationEntry({
      status: 'READY',
      hh20: 105,
      ema20: 102,
      atr: 2,
      close: 106,
      low: 104,
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('Mode B inactive');
  });

  it('triggers when price dips into zone and closes above', () => {
    // anchor = max(105, 102) = 105
    // zone = 105 ± 0.5 = [104.5, 105.5]
    // low = 105 (in zone), close = 106 (above 105.5)
    const result = checkPullbackContinuationEntry({
      status: 'WAIT_PULLBACK',
      hh20: 105,
      ema20: 102,
      atr: 2,
      close: 106,
      low: 105,
    });
    expect(result.triggered).toBe(true);
    expect(result.mode).toBe('PULLBACK_CONTINUATION');
    expect(result.entryPrice).toBe(106);
    expect(result.stopPrice).toBeDefined();
  });

  it('does not trigger when low is outside zone', () => {
    // anchor = 105, zone = [104.5, 105.5]
    // low = 108 — above zone
    const result = checkPullbackContinuationEntry({
      status: 'WAIT_PULLBACK',
      hh20: 105,
      ema20: 102,
      atr: 2,
      close: 109,
      low: 108,
    });
    expect(result.triggered).toBe(false);
  });

  it('does not trigger when close is below zone high', () => {
    // anchor = 105, zone = [104.5, 105.5]
    // low = 104.8 (in zone), close = 105 (below 105.5)
    const result = checkPullbackContinuationEntry({
      status: 'WAIT_PULLBACK',
      hh20: 105,
      ema20: 102,
      atr: 2,
      close: 105,
      low: 104.8,
    });
    expect(result.triggered).toBe(false);
  });

  it('calculates stop from pullbackLow', () => {
    const result = checkPullbackContinuationEntry({
      status: 'WAIT_PULLBACK',
      hh20: 105,
      ema20: 102,
      atr: 2,
      close: 106,
      low: 105,
      pullbackLow: 103,
    });
    // stopPrice = 103 - 0.5 * 2 = 102
    expect(result.triggered).toBe(true);
    expect(result.stopPrice).toBe(102);
  });

  it('uses low as fallback when pullbackLow is undefined', () => {
    const result = checkPullbackContinuationEntry({
      status: 'WAIT_PULLBACK',
      hh20: 105,
      ema20: 102,
      atr: 2,
      close: 106,
      low: 105,
    });
    // stopPrice = 105 - 0.5 * 2 = 104
    expect(result.triggered).toBe(true);
    expect(result.stopPrice).toBe(104);
  });

  it('returns invalid for zero ATR', () => {
    const result = checkPullbackContinuationEntry({
      status: 'WAIT_PULLBACK',
      hh20: 105,
      ema20: 102,
      atr: 0,
      close: 106,
      low: 105,
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('Invalid ATR');
  });

  it('anchor uses max of hh20 and ema20', () => {
    // ema20 > hh20 → anchor = ema20
    const result = checkPullbackContinuationEntry({
      status: 'WAIT_PULLBACK',
      hh20: 100,
      ema20: 108,
      atr: 2,
      close: 110,
      low: 108.3,
    });
    expect(result.anchor).toBe(108);
  });
});
