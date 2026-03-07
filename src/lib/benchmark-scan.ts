/**
 * DEPENDENCIES
 * Consumed by: /api/scan/benchmark/route.ts
 * Consumes: scan-engine.ts (getUniverse, classifyCandidate), market-data.ts, position-sizer.ts, prisma.ts, @/types
 * Risk-sensitive: NO — produces comparison data only, never generates orders
 * Last modified: 2026-03-06
 * Notes: Stripped-down scan using only MA200 filter. Produces an "unfiltered"
 *        baseline for measuring the value added by ADX, Hurst, earnings,
 *        anti-chase, and other filters. Reuses universe + classification + sizing.
 */
import type {
  ScanCandidate,
  CandidateStatus,
  MarketRegime,
  Sleeve,
  RiskProfileType,
} from '@/types';
import { ATR_STOP_MULTIPLIER } from '@/types';
import { getUniverse, classifyCandidate } from './scan-engine';
import { getTechnicalData, getMarketRegime } from './market-data';
import { calculatePositionSize } from './position-sizer';

export interface BenchmarkScanResult {
  regime: MarketRegime;
  candidates: BenchmarkCandidate[];
  totalScanned: number;
  passedMa200: number;
  readyCount: number;
  watchCount: number;
}

export interface BenchmarkCandidate {
  ticker: string;
  name: string;
  sleeve: Sleeve;
  price: number;
  ma200: number;
  entryTrigger: number;
  stopPrice: number;
  distancePercent: number;
  status: CandidateStatus;
  adx: number;
  atrPercent: number;
  shares?: number;
  riskDollars?: number;
}

/**
 * Benchmark scan: MA200 filter only.
 * Skips ADX, +DI/-DI, Hurst, earnings, anti-chase — just price > MA200.
 * This is the "dumb" baseline to compare against the full pipeline.
 */
export async function runBenchmarkScan(
  equity: number,
  riskProfile: RiskProfileType,
  onProgress?: (stage: string, processed: number, total: number) => void
): Promise<BenchmarkScanResult> {
  const universe = await getUniverse();
  const regime = await getMarketRegime();
  const candidates: BenchmarkCandidate[] = [];

  onProgress?.('Benchmark: Loading universe', 0, universe.length);

  const BATCH_SIZE = 10;
  for (let batch = 0; batch < universe.length; batch += BATCH_SIZE) {
    const stockBatch = universe.slice(batch, batch + BATCH_SIZE);

    const batchPromises = stockBatch.map(async (stock) => {
      try {
        const technicals = await getTechnicalData(stock.ticker);
        if (!technicals) return null;

        const price = technicals.currentPrice;
        if (!price || price <= 0) return null;

        // Only filter: price > MA200
        if (price <= technicals.ma200 || technicals.ma200 <= 0) return null;

        const entryTrigger = technicals.twentyDayHigh;
        const stopPrice = entryTrigger - technicals.atr * ATR_STOP_MULTIPLIER;
        const distancePercent = ((entryTrigger - price) / price) * 100;
        const status = classifyCandidate(price, entryTrigger);

        let shares: number | undefined;
        let riskDollars: number | undefined;

        if (status === 'READY' || status === 'WATCH') {
          try {
            const sizing = calculatePositionSize({
              equity,
              riskProfile,
              entryPrice: entryTrigger,
              stopPrice,
              sleeve: stock.sleeve,
              fxToGbp: 1, // simplified — benchmark doesn't need precise FX
              allowFractional: true,
            });
            shares = sizing.shares;
            riskDollars = sizing.riskDollars;
          } catch {
            // sizing failed
          }
        }

        return {
          ticker: stock.ticker,
          name: stock.name,
          sleeve: stock.sleeve,
          price,
          ma200: technicals.ma200,
          entryTrigger,
          stopPrice,
          distancePercent,
          status,
          adx: technicals.adx,
          atrPercent: technicals.atrPercent,
          shares,
          riskDollars,
        } satisfies BenchmarkCandidate;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(batchPromises);
    for (const r of results) {
      if (r) candidates.push(r);
    }

    onProgress?.('Benchmark: Scanning', Math.min(batch + BATCH_SIZE, universe.length), universe.length);

    if (batch + BATCH_SIZE < universe.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Sort same as full scan: READY first, then by distance
  const statusOrder: Record<string, number> = { READY: 0, WATCH: 1, FAR: 3 };
  candidates.sort((a, b) => {
    const aOrd = statusOrder[a.status] ?? 3;
    const bOrd = statusOrder[b.status] ?? 3;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return a.distancePercent - b.distancePercent;
  });

  return {
    regime,
    candidates,
    totalScanned: universe.length,
    passedMa200: candidates.length,
    readyCount: candidates.filter((c) => c.status === 'READY').length,
    watchCount: candidates.filter((c) => c.status === 'WATCH').length,
  };
}
