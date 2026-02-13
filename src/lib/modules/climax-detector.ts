// ============================================================
// Module 5 + 14: Climax Top Exit / Trim & Tighten
// ============================================================
// Detects blow-off tops: price >18% above MA20 + volume >3× avg.
// Configurable action: TRIM 50% or TIGHTEN stop.
// ============================================================

import 'server-only';
import type { ClimaxSignal } from '@/types';
import { getDailyPrices, calculateMA } from '../market-data';

const CLIMAX_PRICE_THRESHOLD = 18; // % above MA20
const CLIMAX_VOLUME_MULTIPLIER = 3; // × avg volume

interface PositionForClimax {
  id: string;
  ticker: string;
}

/**
 * Check a single position for climax top conditions.
 */
export function checkClimaxTop(
  ticker: string,
  positionId: string,
  price: number,
  ma20: number,
  volume: number,
  avgVolume20: number,
  mode: 'TRIM' | 'TIGHTEN' = 'TRIM'
): ClimaxSignal {
  const priceAboveMa20Pct = ma20 > 0 ? ((price - ma20) / ma20) * 100 : 0;
  const volumeRatio = avgVolume20 > 0 ? volume / avgVolume20 : 0;

  const priceSignal = priceAboveMa20Pct >= CLIMAX_PRICE_THRESHOLD;
  const volumeSignal = volumeRatio >= CLIMAX_VOLUME_MULTIPLIER;
  const isClimax = priceSignal && volumeSignal;

  let action: 'TRIM' | 'TIGHTEN' | 'NONE' = 'NONE';
  if (isClimax) {
    action = mode;
  }

  return {
    ticker,
    positionId,
    price,
    ma20,
    priceAboveMa20Pct,
    volumeRatio,
    isClimax,
    action,
    reason: isClimax
      ? `CLIMAX TOP: +${priceAboveMa20Pct.toFixed(1)}% above MA20, volume ${volumeRatio.toFixed(1)}× → ACTION: ${action}`
      : `No climax (${priceAboveMa20Pct.toFixed(1)}% above MA20, vol ${volumeRatio.toFixed(1)}×)`,
  };
}

/**
 * Scan all open positions for climax signals using live data.
 */
export async function scanClimaxSignals(
  positions: PositionForClimax[],
  mode: 'TRIM' | 'TIGHTEN' = 'TRIM'
): Promise<ClimaxSignal[]> {
  const signals: ClimaxSignal[] = [];

  for (const pos of positions) {
    try {
      const bars = await getDailyPrices(pos.ticker, 'compact');
      if (bars.length < 20) continue;

      const price = bars[0].close;
      const closes = bars.slice(0, 20).map(b => b.close);
      const ma20 = calculateMA(closes, 20);
      const volume = bars[0].volume;
      const avgVolume20 = bars.slice(0, 20).reduce((s, b) => s + b.volume, 0) / 20;

      const signal = checkClimaxTop(pos.ticker, pos.id, price, ma20, volume, avgVolume20, mode);

      if (signal.isClimax) {
        signals.push(signal);
      }
    } catch {
      // Skip failed tickers
    }
  }

  return signals;
}
