// ============================================================
// Module 2: Early Bird Entry
// ============================================================
// Allows aggressive entry before ADX confirms — top 10% of 55d
// range + volume > 1.5× + bullish regime. Catches fast movers.
// ============================================================

import 'server-only';
import type { EarlyBirdSignal, MarketRegime } from '@/types';
import { ATR_STOP_MULTIPLIER } from '@/types';
import { getDailyPrices, calculateATR, calculateADX, calculateMA, calculate20DayHigh } from '../market-data';
import { calculateEntryTrigger } from '../position-sizer';

/**
 * Check if a stock qualifies for Early Bird entry.
 * Criteria:
 *   1. Price in top 10% of 55-day range
 *   2. Volume > 1.5× the 20-day average
 *   3. Market regime is BULLISH
 */
/**
 * Graduation Probability (0–100): weighted composite of how likely
 * this Early Bird candidate is to trigger a full breakout entry.
 *
 * Weights:
 *   Range position   30%  — how close to breakout (rangePctile)
 *   Volume surge     20%  — recent volume vs 20d avg
 *   ADX strength     20%  — trend conviction
 *   ATR% (inverse)   15%  — lower volatility = more stable
 *   MA200 distance   15%  — higher above MA200 = stronger trend
 */
function calcGraduationProbability(
  rangePctile: number,
  volumeRatio: number,
  adx: number,
  atrPercent: number,
  ma200Distance: number
): number {
  // Normalise each component to 0–100
  const rangeScore = Math.min(rangePctile, 100);                       // already 0–100
  const volScore = Math.min((volumeRatio / 4) * 100, 100);             // 4× = max score
  const adxScore = Math.min(((adx - 15) / 30) * 100, 100);            // 15–45 range → 0–100
  const atrInvScore = Math.max(0, 100 - (atrPercent / 6) * 100);      // 0–6% range, lower is better
  const ma200Score = Math.min((ma200Distance / 20) * 100, 100);        // 0–20% above MA200 → 0–100

  const weighted =
    rangeScore * 0.30 +
    volScore * 0.20 +
    Math.max(0, adxScore) * 0.20 +
    atrInvScore * 0.15 +
    Math.max(0, ma200Score) * 0.15;

  return Math.round(Math.max(0, Math.min(100, weighted)));
}

export function checkEarlyBird(
  ticker: string,
  name: string,
  price: number,
  fiftyFiveDayHigh: number,
  fiftyFiveDayLow: number,
  volume: number,
  avgVolume20: number,
  regime: MarketRegime,
  adx: number,
  atrPercent: number,
  ma200Distance: number,
  entryTrigger: number,
  candidateStop: number,
  atr: number
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

  const graduationProbability = calcGraduationProbability(
    rangePctile, volumeRatio, adx, atrPercent, ma200Distance
  );

  // Risk Efficiency = (entryTrigger - stop) / ATR — measures stop width in ATR units
  // Lower is better: tight stop relative to volatility = cleaner sizing
  const riskEfficiency = atr > 0 ? (entryTrigger - candidateStop) / atr : 0;

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
    adx,
    atrPercent,
    ma200Distance,
    graduationProbability,
    riskEfficiency,
    entryTrigger,
    candidateStop,
    // priceCurrency set by scanEarlyBirds which has DB context
  };
}

/**
 * Scan universe for Early Bird candidates using live data.
 * Parallelized in batches of 10 for performance.
 */
export async function scanEarlyBirds(
  tickers: { ticker: string; name: string; currency?: string | null }[],
  regime: MarketRegime
): Promise<EarlyBirdSignal[]> {
  const signals: EarlyBirdSignal[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ ticker, name, currency }) => {
        // Need 200+ bars for MA200; fall back to compact (55) only if full fetch fails
        const bars = await getDailyPrices(ticker, 'full');
        if (bars.length < 55) return null;

        const price = bars[0].close;
        const closes = bars.map(b => b.close);
        const last55 = bars.slice(0, 55);
        const fiftyFiveDayHigh = Math.max(...last55.map(b => b.high));
        const fiftyFiveDayLow = Math.min(...last55.map(b => b.low));
        const volume = bars[0].volume;
        const avgVolume20 = bars.slice(0, 20).reduce((s, b) => s + b.volume, 0) / 20;

        // Technical enrichment for Graduation Probability + Risk Efficiency
        const atr = calculateATR(bars, 14);
        const atrPercent = price > 0 ? (atr / price) * 100 : 0;
        const { adx } = bars.length >= 29 ? calculateADX(bars, 14) : { adx: 0 };
        const ma200 = bars.length >= 200 ? calculateMA(closes, 200) : 0;
        const ma200Distance = ma200 > 0 ? ((price - ma200) / ma200) * 100 : 0;

        // Entry trigger (20d high + 0.1×ATR) and candidate stop (trigger - 1.5×ATR)
        const twentyDayHigh = calculate20DayHigh(bars);
        const entryTrigger = calculateEntryTrigger(twentyDayHigh, atr);
        const candidateStop = entryTrigger - atr * ATR_STOP_MULTIPLIER;

        const signal = checkEarlyBird(
          ticker, name, price,
          fiftyFiveDayHigh, fiftyFiveDayLow,
          volume, avgVolume20, regime,
          adx, atrPercent, ma200Distance,
          entryTrigger, candidateStop, atr
        );

        if (signal.eligible) {
          // Derive display currency: .L tickers trade in GBX (pence), others use DB currency or USD
          const isUK = ticker.endsWith('.L');
          signal.priceCurrency = isUK ? 'GBX' : (currency || 'USD').toUpperCase();
        }

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
