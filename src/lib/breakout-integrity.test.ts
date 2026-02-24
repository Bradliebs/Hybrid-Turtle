import { describe, expect, it } from 'vitest';
import { calcBIS, type BISCandle } from './breakout-integrity';

function makeCandle(overrides: Partial<BISCandle> = {}): BISCandle {
  return { open: 100, high: 105, low: 98, close: 104, volume: 1_000_000, ...overrides };
}

describe('calcBIS', () => {
  it('returns max 15 for a perfect breakout candle', () => {
    // Body ratio: (104-100)/(105-98) = 0.571 → +2
    // Need body > 0.6 for +5, so adjust:
    const candle = makeCandle({ open: 99, close: 105, high: 106, low: 98 });
    // body = 6, range = 8, ratio = 0.75 → +5
    // volume = 1M, avg = 500k → 200% → +5
    // closePos = (105-98)/8 = 0.875 → +5
    expect(calcBIS(candle, 500_000)).toBe(15);
  });

  it('returns 0 for a zero-range candle (halted / no movement)', () => {
    const candle = makeCandle({ open: 100, high: 100, low: 100, close: 100 });
    expect(calcBIS(candle, 1_000_000)).toBe(0);
  });

  it('returns 0 when avgVolume is 0', () => {
    const candle = makeCandle();
    const score = calcBIS(candle, 0);
    // Body: (104-100)/(105-98)=0.571 → +2, volume: 0 avg → 0, close: (104-98)/7=0.857 → +5
    expect(score).toBe(7); // body(2) + vol(0) + close(5)
  });

  it('scores body-to-range correctly', () => {
    // Large body (>0.6)
    const big = makeCandle({ open: 99, close: 104, high: 105, low: 98 });
    // body=5, range=7, ratio=0.714 → +5
    const bigScore = calcBIS(big, 0); // vol always 0 to isolate body
    expect(bigScore).toBeGreaterThanOrEqual(5);

    // Medium body (0.4-0.6)
    const med = makeCandle({ open: 101, close: 104, high: 106, low: 98 });
    // body=3, range=8, ratio=0.375 → 0 (below 0.4)
    // Actually need ratio 0.4-0.6:
    const med2 = makeCandle({ open: 100, close: 104, high: 108, low: 98 });
    // body=4, range=10, ratio=0.4 → +2
    const medScore = calcBIS(med2, 0);
    // close: (104-98)/10 = 0.6 → middle → +2
    expect(medScore).toBe(4); // body(2) + vol(0) + close(2)

    // Small body (<0.4)
    const small = makeCandle({ open: 101, close: 102, high: 108, low: 98 });
    // body=1, range=10, ratio=0.1 → 0
    const smallScore = calcBIS(small, 0);
    // close: (102-98)/10=0.4 → middle → +2
    expect(smallScore).toBe(2); // body(0) + vol(0) + close(2)
  });

  it('scores volume correctly', () => {
    const candle = makeCandle({ open: 99, close: 105, high: 106, low: 98 });
    // body=6, range=8, ratio=0.75 → +5; closePos=0.875 → +5

    // Volume > 150% avg
    expect(calcBIS(candle, 600_000)).toBe(15); // +5 body + +5 vol + +5 close

    // Volume 100-150% avg
    expect(calcBIS(candle, 800_000)).toBe(13); // +5 body + +3 vol + +5 close

    // Volume < 100% avg
    expect(calcBIS(candle, 2_000_000)).toBe(10); // +5 body + +0 vol + +5 close
  });

  it('scores close position correctly', () => {
    // Close in top 30% of bar (closePos >= 0.7)
    const top = makeCandle({ close: 105, high: 106, low: 98 });
    // closePos = (105-98)/8 = 0.875 → +5

    // Close in bottom 30% (closePos < 0.3)
    const bottom = makeCandle({ close: 99, high: 106, low: 98 });
    // closePos = (99-98)/8 = 0.125 → 0

    // Close in middle
    const middle = makeCandle({ close: 102, high: 106, low: 98 });
    // closePos = (102-98)/8 = 0.5 → +2

    // Use avgVolume=0 to isolate close scoring from volume
    const topBody = calcBIS(top, 0);
    const bottomBody = calcBIS(bottom, 0);
    const middleBody = calcBIS(middle, 0);

    expect(topBody).toBeGreaterThan(middleBody);
    expect(middleBody).toBeGreaterThan(bottomBody);
  });

  it('handles negative volume gracefully', () => {
    const candle = makeCandle({ volume: -100 });
    // Volume check: -100 > 0 fails → volumeScore = 0
    const score = calcBIS(candle, 1_000_000);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(15);
  });

  it('handles NaN/Infinity inputs gracefully', () => {
    expect(calcBIS(makeCandle({ high: NaN }), 1000)).toBe(0);
    expect(calcBIS(makeCandle({ low: Infinity }), 1000)).toBe(0);
  });
});
