// ============================================================
// Module 10: Market Breadth Safety Valve
// ============================================================
// Checks % of universe above 50DMA.
// If < 40%, reduces max positions from 8 → 4.
// Protects in narrow/deteriorating markets.
// ============================================================

import 'server-only';
import type { BreadthSafetyResult } from '@/types';
import { getDailyPrices, calculateMA } from '../market-data';

const BREADTH_THRESHOLD = 40; // percent
const RESTRICTED_MAX_POSITIONS = 4;

/**
 * Calculate market breadth: % of given tickers above their 50DMA.
 * Uses random sampling (max 30 tickers) and parallel fetching for speed.
 */
export async function calculateBreadth(
  tickers: string[]
): Promise<number> {
  if (tickers.length === 0) return 100;

  // Sample max 30 tickers for performance (shuffled for representativeness)
  const sampled = tickers.length > 30
    ? [...tickers].sort(() => Math.random() - 0.5).slice(0, 30)
    : tickers;

  let above50DMA = 0;
  let checked = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < sampled.length; i += BATCH_SIZE) {
    const batch = sampled.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => {
        const bars = await getDailyPrices(ticker, 'compact');
        if (bars.length < 50) return null;

        const price = bars[0].close;
        const closes = bars.map(b => b.close);
        const ma50 = calculateMA(closes, 50);
        return price > ma50;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value !== null) {
        checked++;
        if (r.value) above50DMA++;
      }
    }

    if (i + BATCH_SIZE < sampled.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return checked > 0 ? (above50DMA / checked) * 100 : 100;
}

/**
 * Run the breadth safety valve check.
 * Returns whether max positions should be reduced.
 */
export function checkBreadthSafety(
  breadthPct: number,
  currentMaxPositions: number
): BreadthSafetyResult {
  const isRestricted = breadthPct < BREADTH_THRESHOLD;

  // Use the lower of the profile's max and the hardcoded cap.
  // This prevents over-restricting AGGRESSIVE (max 3) or under-restricting CONSERVATIVE (max 8).
  const restrictedMax = Math.min(currentMaxPositions, RESTRICTED_MAX_POSITIONS);

  return {
    breadthPct,
    threshold: BREADTH_THRESHOLD,
    maxPositionsOverride: isRestricted ? restrictedMax : null,
    isRestricted,
    reason: isRestricted
      ? `SAFETY VALVE: Only ${breadthPct.toFixed(0)}% above 50DMA (< ${BREADTH_THRESHOLD}%) — max positions reduced to ${restrictedMax}`
      : `Breadth healthy: ${breadthPct.toFixed(0)}% above 50DMA — normal position limits`,
  };
}
