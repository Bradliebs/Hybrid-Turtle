/**
 * DEPENDENCIES
 * Consumed by: vpin-calculator.ts
 * Consumes: (standalone — pure math)
 * Risk-sensitive: NO — signal computation only
 * Last modified: 2026-03-07
 * Notes: Tick Rule approximation of buy/sell volume from OHLCV bars.
 *        True order flow requires tick data; this approximation uses the
 *        relationship between open, high, low, close to estimate directional volume.
 *        ⛔ Does NOT modify sacred files.
 */

// ── Types ────────────────────────────────────────────────────

export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ClassifiedVolume {
  date: string;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  imbalance: number;  // (buy - sell) / total, range [-1, 1]
}

// ── Tick Rule Classification ─────────────────────────────────

/**
 * Classify a single OHLCV bar's volume into buy-initiated and sell-initiated
 * using the Tick Rule approximation.
 *
 * Logic:
 *   close > open → bullish bar → buy proportion = (close - low) / (high - low)
 *   close < open → bearish bar → sell proportion = (high - close) / (high - low)
 *   close == open → split 50/50
 */
export function classifyBarVolume(bar: OHLCVBar): ClassifiedVolume {
  const range = bar.high - bar.low;
  const vol = bar.volume;

  if (range <= 0 || vol <= 0) {
    // No range or no volume — split evenly
    return {
      date: bar.date,
      buyVolume: vol / 2,
      sellVolume: vol / 2,
      totalVolume: vol,
      imbalance: 0,
    };
  }

  let buyRatio: number;

  if (bar.close > bar.open) {
    // Bullish bar: more of the range was up
    buyRatio = (bar.close - bar.low) / range;
  } else if (bar.close < bar.open) {
    // Bearish bar: more of the range was down
    buyRatio = (bar.high - bar.close) / range;
    buyRatio = 1 - buyRatio; // invert: high sell ratio → low buy ratio
  } else {
    // Doji: equal buy/sell
    buyRatio = 0.5;
  }

  // Clamp to [0, 1]
  buyRatio = Math.max(0, Math.min(1, buyRatio));

  const buyVol = vol * buyRatio;
  const sellVol = vol * (1 - buyRatio);
  const imbalance = vol > 0 ? (buyVol - sellVol) / vol : 0;

  return {
    date: bar.date,
    buyVolume: Math.round(buyVol),
    sellVolume: Math.round(sellVol),
    totalVolume: vol,
    imbalance: Math.round(imbalance * 1000) / 1000,
  };
}

/**
 * Classify an array of OHLCV bars into buy/sell volume.
 */
export function classifyAllBars(bars: OHLCVBar[]): ClassifiedVolume[] {
  return bars.map(classifyBarVolume);
}
