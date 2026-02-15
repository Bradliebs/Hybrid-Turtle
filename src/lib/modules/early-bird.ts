// ============================================================
// Module 2: Early Bird Entry
// ============================================================
// Allows aggressive entry before ADX confirms — top 10% of 55d
// range + volume > 1.5× + bullish regime. Catches fast movers.
// ============================================================

import 'server-only';
import type { EarlyBirdSignal, MarketRegime } from '@/types';
import { getDailyPrices } from '../market-data';

/**
 * Check if a stock qualifies for Early Bird entry.
 * Criteria:
 *   1. Price in top 10% of 55-day range
 *   2. Volume > 1.5× the 20-day average
 *   3. Market regime is BULLISH
 */
export function checkEarlyBird(
  ticker: string,
  name: string,
  price: number,
  fiftyFiveDayHigh: number,
  fiftyFiveDayLow: number,
  volume: number,
  avgVolume20: number,
  regime: MarketRegime
): EarlyBirdSignal {
  const range = fiftyFiveDayHigh - fiftyFiveDayLow;
  const rangePctile = range > 0 ? ((price - fiftyFiveDayLow) / range) * 100 : 0;
  const volumeRatio = avgVolume20 > 0 ? volume / avgVolume20 : 0;

  const inTop10 = rangePctile >= 90;
  const volumeConfirm = volumeRatio >= 1.5;
  const regimeOk = regime === 'BULLISH';

  const eligible = inTop10 && volumeConfirm && regimeOk;

  const reasons: string[] = [];
  if (!inTop10) reasons.push(`Price at ${rangePctile.toFixed(0)}% of 55d range (need ≥90%)`);
  if (!volumeConfirm) reasons.push(`Volume ratio ${volumeRatio.toFixed(1)}× (need ≥1.5×)`);
  if (!regimeOk) reasons.push(`Regime is ${regime} (need BULLISH)`);

  return {
    ticker,
    name,
    price,
    fiftyFiveDayHigh,
    rangePctile,
    volumeRatio,
    regime,
    eligible,
    reason: eligible
      ? `EARLY BIRD: Top ${(100 - rangePctile).toFixed(0)}% of 55d range, volume ${volumeRatio.toFixed(1)}×`
      : reasons.join('; '),
  };
}

/**
 * Scan universe for Early Bird candidates using live data.
 * Parallelized in batches of 10 for performance.
 */
export async function scanEarlyBirds(
  tickers: { ticker: string; name: string }[],
  regime: MarketRegime
): Promise<EarlyBirdSignal[]> {
  const signals: EarlyBirdSignal[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ ticker, name }) => {
        const bars = await getDailyPrices(ticker, 'compact');
        if (bars.length < 55) return null;

        const price = bars[0].close;
        const last55 = bars.slice(0, 55);
        const fiftyFiveDayHigh = Math.max(...last55.map(b => b.high));
        const fiftyFiveDayLow = Math.min(...last55.map(b => b.low));
        const volume = bars[0].volume;
        const avgVolume20 = bars.slice(0, 20).reduce((s, b) => s + b.volume, 0) / 20;

        const signal = checkEarlyBird(
          ticker, name, price,
          fiftyFiveDayHigh, fiftyFiveDayLow,
          volume, avgVolume20, regime
        );

        return signal.eligible ? signal : null;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) signals.push(r.value);
    }

    if (i + BATCH_SIZE < tickers.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return signals.sort((a, b) => b.rangePctile - a.rangePctile);
}
