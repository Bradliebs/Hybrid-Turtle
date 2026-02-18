import { describe, expect, it } from 'vitest';
import {
  detectRegime,
  checkRegimeStability,
  detectDualRegime,
  canBuy,
} from './regime-detector';

// ── detectRegime tests ──────────────────────────────────────

describe('detectRegime', () => {
  const base = {
    spyPrice: 500,
    spy200MA: 480,
    spyAdx: 30,
    spyPlusDI: 25,
    spyMinusDI: 15,
    vixLevel: 15,
    advanceDeclineRatio: 1.3,
  };

  it('detects BULLISH when all signals positive', () => {
    const result = detectRegime(base);
    expect(result.regime).toBe('BULLISH');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('detects BEARISH when all signals negative', () => {
    const result = detectRegime({
      spyPrice: 420,
      spy200MA: 480,
      spyAdx: 30,
      spyPlusDI: 12,
      spyMinusDI: 28,
      vixLevel: 35,
      advanceDeclineRatio: 0.6,
    });
    expect(result.regime).toBe('BEARISH');
  });

  it('forces SIDEWAYS in ±2% CHOP band', () => {
    // Price within ±2% of 200MA → forced SIDEWAYS
    const result = detectRegime({
      ...base,
      spyPrice: 481, // 0.2% above MA — inside ±2% band
      spy200MA: 480,
    });
    expect(result.regime).toBe('SIDEWAYS');
    expect(result.inChopBand).toBe(true);
    expect(result.reasons.some(r => r.includes('CHOP BAND'))).toBe(true);
  });

  it('detects CHOP band correctly at boundaries', () => {
    // Upper bound: 480 * 1.02 = 489.6
    const atUpper = detectRegime({ ...base, spyPrice: 489, spy200MA: 480 });
    expect(atUpper.inChopBand).toBe(true);

    // Just above upper bound
    const aboveUpper = detectRegime({ ...base, spyPrice: 491, spy200MA: 480 });
    expect(aboveUpper.inChopBand).toBe(false);

    // Lower bound: 480 * 0.98 = 470.4
    const atLower = detectRegime({ ...base, spyPrice: 471, spy200MA: 480 });
    expect(atLower.inChopBand).toBe(true);
  });

  it('includes VIX assessment in reasons', () => {
    const lowVix = detectRegime({ ...base, vixLevel: 12 });
    expect(lowVix.reasons.some(r => r.includes('VIX'))).toBe(true);

    const highVix = detectRegime({ ...base, vixLevel: 35 });
    expect(highVix.reasons.some(r => r.includes('VIX'))).toBe(true);
  });

  it('detects SIDEWAYS on mixed signals', () => {
    // Price above MA (+3) but -DI > +DI (-2), low VIX (+1), neutral A/D (0)
    // bull=4, bear=2 → SIDEWAYS (neither reaches 5)
    const result = detectRegime({
      spyPrice: 500,
      spy200MA: 480,
      spyAdx: 15,
      spyPlusDI: 15,
      spyMinusDI: 20, // -DI wins
      vixLevel: 15,   // calm → +1 bull
      advanceDeclineRatio: 1.0, // neutral
    });
    expect(result.regime).toBe('SIDEWAYS');
  });
});

// ── checkRegimeStability tests ──────────────────────────────

describe('checkRegimeStability', () => {
  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000);

  it('confirms BULLISH after 3 consecutive days', () => {
    const history = [
      { regime: 'BULLISH', date: daysAgo(0) },
      { regime: 'BULLISH', date: daysAgo(1) },
      { regime: 'BULLISH', date: daysAgo(2) },
    ];
    const result = checkRegimeStability('BULLISH', history);
    expect(result.isStable).toBe(true);
    expect(result.currentRegime).toBe('BULLISH');
    expect(result.consecutiveDays).toBe(3);
  });

  it('rejects BULLISH with only 2 consecutive days', () => {
    const history = [
      { regime: 'BULLISH', date: daysAgo(0) },
      { regime: 'BULLISH', date: daysAgo(1) },
      { regime: 'SIDEWAYS', date: daysAgo(2) },
    ];
    const result = checkRegimeStability('BULLISH', history);
    expect(result.isStable).toBe(false);
    expect(result.currentRegime).toBe('CHOP');
    expect(result.consecutiveDays).toBe(2);
  });

  it('returns CHOP with no history', () => {
    const result = checkRegimeStability('BEARISH', []);
    expect(result.isStable).toBe(false);
    expect(result.currentRegime).toBe('CHOP');
    expect(result.consecutiveDays).toBe(0);
  });

  it('handles unsorted history correctly', () => {
    // Dates out of order — function should sort by date desc
    const history = [
      { regime: 'BULLISH', date: daysAgo(2) },
      { regime: 'BULLISH', date: daysAgo(0) },
      { regime: 'BULLISH', date: daysAgo(1) },
    ];
    const result = checkRegimeStability('BULLISH', history);
    expect(result.isStable).toBe(true);
    expect(result.consecutiveDays).toBe(3);
  });

  it('counts consecutive from most recent only', () => {
    const history = [
      { regime: 'BEARISH', date: daysAgo(0) },
      { regime: 'BEARISH', date: daysAgo(1) },
      { regime: 'BEARISH', date: daysAgo(2) },
      { regime: 'BULLISH', date: daysAgo(3) },
      { regime: 'BEARISH', date: daysAgo(4) },
    ];
    const result = checkRegimeStability('BEARISH', history);
    expect(result.isStable).toBe(true);
    expect(result.consecutiveDays).toBe(3);
  });
});

// ── detectDualRegime tests ──────────────────────────────────

describe('detectDualRegime', () => {
  it('BULLISH when both SPY and VWRL above MA200', () => {
    const result = detectDualRegime(500, 450, 110, 100);
    expect(result.combined).toBe('BULLISH');
    expect(result.spy.regime).toBe('BULLISH');
    expect(result.vwrl.regime).toBe('BULLISH');
  });

  it('BEARISH if either benchmark is BEARISH', () => {
    // SPY below MA, VWRL above
    const result = detectDualRegime(420, 480, 110, 100);
    expect(result.combined).toBe('BEARISH');
    expect(result.spy.regime).toBe('BEARISH');
    expect(result.vwrl.regime).toBe('BULLISH');
  });

  it('SIDEWAYS when SPY in CHOP band and VWRL bullish', () => {
    // SPY within ±2% of MA200 → SIDEWAYS
    const result = detectDualRegime(481, 480, 110, 100);
    expect(result.spy.regime).toBe('SIDEWAYS');
    expect(result.combined).toBe('SIDEWAYS');
    expect(result.chopDetected).toBe(true);
  });

  it('SIDEWAYS when both in CHOP band', () => {
    const result = detectDualRegime(481, 480, 101, 100);
    expect(result.combined).toBe('SIDEWAYS');
    expect(result.chopDetected).toBe(true);
  });

  it('returns price and MA data for both benchmarks', () => {
    const result = detectDualRegime(500, 450, 110, 100);
    expect(result.spy.price).toBe(500);
    expect(result.spy.ma200).toBe(450);
    expect(result.vwrl.price).toBe(110);
    expect(result.vwrl.ma200).toBe(100);
  });
});

// ── canBuy tests ────────────────────────────────────────────

describe('canBuy', () => {
  it('allows buying in BULLISH regime', () => {
    expect(canBuy('BULLISH')).toBe(true);
  });

  it('blocks buying in SIDEWAYS regime', () => {
    expect(canBuy('SIDEWAYS')).toBe(false);
  });

  it('blocks buying in BEARISH regime', () => {
    expect(canBuy('BEARISH')).toBe(false);
  });
});
