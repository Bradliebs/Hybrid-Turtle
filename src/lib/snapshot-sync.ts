/**
 * DEPENDENCIES
 * Consumed by: nightly.ts, /api/nightly/route.ts, /api/snapshot/route.ts (if present)
 * Consumes: market-data.ts, prisma.ts, @/types
 * Risk-sensitive: YES
 * Last modified: 2026-02-22
 * Notes: Snapshot sync should reject stale/invalid data.
 */
// ============================================================
// Snapshot Sync — Builds SnapshotTicker rows from live data
// ============================================================
// Replaces the Python master_snapshot pipeline.  Pulls market data
// from Yahoo Finance (via market-data.ts), enriches with cluster /
// regime / T212 info from the DB, and writes a full Snapshot.
// ============================================================

import prisma from './prisma';
import {
  getDailyPrices,
  calculateMA,
  calculateATR,
  calculateADX,
  calculateTrendEfficiency,
  getMarketRegime,
  getFXRate,
} from './market-data';
import { validateTickerData } from './modules/data-validator';
import type { Sleeve } from '@/types';
import { ATR_STOP_MULTIPLIER, SNAPSHOT_CLUSTER_WARNING, SNAPSHOT_SUPER_CLUSTER_WARNING } from '@/types';

// ── Types ─────────────────────────────────────────────────────
export interface SyncProgress {
  total: number;
  done: number;
  failed: number;
  ticker: string;
}

export type SyncProgressCallback = (p: SyncProgress) => void;

export interface SyncResult {
  snapshotId: string;
  rowCount: number;
  failed: string[];
  regime: string;
  durationMs: number;
}

// ── Constants ─────────────────────────────────────────────────
const BATCH_SIZE = 8;          // concurrent Yahoo requests per batch
const BATCH_DELAY_MS = 400;    // pause between batches

// ── Helpers ───────────────────────────────────────────────────

function nDayHigh(data: { high: number }[], n: number): number {
  const highs = data.slice(0, n).map((d) => d.high);
  return highs.length > 0 ? Math.max(...highs) : 0;
}

function nDayLow(data: { low: number }[], n: number): number {
  const lows = data.slice(0, n).map((d) => d.low);
  return lows.length > 0 ? Math.min(...lows) : 0;
}

/** Check if the 20-day (or 55-day) high was set in the last 5 bars. */
function chasingLastN(
  data: { high: number }[],
  breakoutPeriod: number,
  lookback: number = 5
): boolean {
  if (data.length < breakoutPeriod) return false;
  const periodHigh = nDayHigh(data, breakoutPeriod);
  // Check if any of the last `lookback` bars touched the high
  for (let i = 0; i < Math.min(lookback, data.length); i++) {
    if (data[i].high >= periodHigh * 0.999) return true;
  }
  return false;
}

/** ATR 20 days ago for spike detection */
function atr20DaysAgo(data: { high: number; low: number; close: number }[]): number {
  if (data.length < 34) return 0;
  return calculateATR(data.slice(20), 14);
}

/** Dollar volume (20-day average) */
function dollarVol20(data: { close: number; volume: number }[]): number {
  const slice = data.slice(0, 20);
  if (slice.length === 0) return 0;
  const total = slice.reduce((s, d) => s + d.close * d.volume, 0);
  return total / slice.length;
}

/** Volume ratio — today vs 20-day average */
function volumeRatio(data: { volume: number }[]): number {
  if (data.length < 2) return 1;
  const avg20 = data.slice(0, 20).reduce((s, d) => s + d.volume, 0) / Math.min(data.length, 20);
  return avg20 > 0 ? data[0].volume / avg20 : 1;
}

/** Relative strength vs SPY over 3 months (%) */
async function rsVsBenchmark(
  closes: number[],
  spyCloses: number[]
): Promise<number> {
  const period = 63; // ~3 months
  if (closes.length < period || spyCloses.length < period) return 0;
  const stockReturn = (closes[0] - closes[period - 1]) / closes[period - 1];
  const spyReturn = (spyCloses[0] - spyCloses[period - 1]) / spyCloses[period - 1];
  return (stockReturn - spyReturn) * 100;
}

// ── Main sync function ────────────────────────────────────────

export async function syncSnapshot(
  onProgress?: SyncProgressCallback
): Promise<SyncResult> {
  const t0 = Date.now();

  // 1. Get universe from DB
  const stocks = await prisma.stock.findMany({
    where: { active: true },
    orderBy: { ticker: 'asc' },
  });

  if (stocks.length === 0) {
    throw new Error('No active stocks in the database. Run the seed first.');
  }

  // 2. Detect market regime
  const regime = await getMarketRegime();

  // 3. Get SPY data for relative strength calc (fetch once)
  const spyData = await getDailyPrices('SPY', 'full');
  const spyCloses = spyData.map((d) => d.close);
  const spyMa200 = calculateMA(spyCloses, 200);
  const spyPrice = spyCloses[0] || 0;

  // Check regime stability (simple: is SPY clearly above/below MA200?)
  // Guard against division by zero when SPY data is unavailable
  const regimeStable = spyMa200 > 0
    ? Math.abs(spyPrice - spyMa200) / spyMa200 > 0.02
    : true; // Default to stable when data is unavailable

  // 4. Get open positions for cluster exposure calc
  const openPositions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    include: { stock: true },
  });

  // Get user equity
  const defaultUser = await prisma.user.findFirst();
  const equity = defaultUser?.equity || 10000;

  // Calculate cluster/super-cluster risk exposure from open positions
  // HEDGE positions excluded from open risk per CLAUDE.md
  const clusterRisk = new Map<string, number>();
  const superClusterRisk = new Map<string, number>();
  let totalRisk = 0;

  for (const pos of openPositions) {
    // Skip HEDGE — excluded from risk calculations
    if ((pos.stock as { sleeve?: string }).sleeve === 'HEDGE') continue;
    const rawRisk = Math.max(0, (pos.entryPrice - pos.currentStop) * pos.shares);
    // Approximate GBP conversion
    const currency = (pos.stock.currency || 'USD').toUpperCase();
    let fxToGbp = 1;
    if (currency !== 'GBP' && currency !== 'GBX') {
      try { fxToGbp = await getFXRate(currency, 'GBP'); } catch { fxToGbp = 0.79; }
    } else if (currency === 'GBX') {
      fxToGbp = 0.01;
    }
    const riskGbp = rawRisk * fxToGbp;
    totalRisk += riskGbp;

    const cluster = pos.stock.cluster || 'General';
    clusterRisk.set(cluster, (clusterRisk.get(cluster) || 0) + riskGbp);

    const superCluster = pos.stock.superCluster || 'Other';
    superClusterRisk.set(superCluster, (superClusterRisk.get(superCluster) || 0) + riskGbp);
  }

  // Early-warning thresholds for snapshot display (not hard trading gates)
  const maxClusterPct = SNAPSHOT_CLUSTER_WARNING;
  const maxSuperClusterPct = SNAPSHOT_SUPER_CLUSTER_WARNING;

  // 5. Create the snapshot record
  const snapshot = await prisma.snapshot.create({
    data: {
      source: 'sync',
      filename: null,
      rowCount: 0,
    },
  });

  // 6. Process each stock in batches
  const failed: string[] = [];
  let done = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batchData: Record<string, unknown>[] = [];

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (stock) => {
        try {
          const daily = await getDailyPrices(stock.ticker, 'full');
          if (daily.length < 55) {
            throw new Error(`Insufficient data: ${daily.length} bars`);
          }

          const validation = validateTickerData(stock.ticker, daily);
          if (!validation.isValid) {
            throw new Error(`Invalid data: ${validation.issues.join('; ')}`);
          }

          const closes = daily.map((d) => d.close);
          const close = closes[0];

          // ── Technical indicators ──
          const atr14 = calculateATR(daily, 14);
          const atrPct = close > 0 ? (atr14 / close) * 100 : 0;
          const { adx, plusDI, minusDI } = calculateADX(daily, 14);
          const ma200 = closes.length >= 200 ? calculateMA(closes, 200) : 0;
          const ma50 = closes.length >= 50 ? calculateMA(closes, 50) : 0;
          const efficiency = calculateTrendEfficiency(closes, 20);

          // ── Highs / distances ──
          const high20 = nDayHigh(daily, 20);
          const high55 = nDayHigh(daily, 55);
          const distTo20 = high20 > 0 ? ((high20 - close) / close) * 100 : 0;
          const distTo55 = high55 > 0 ? ((high55 - close) / close) * 100 : 0;

          // ── Entry / Stop levels ──
          const entryTrigger = high20 + atr14 * 0.1;
          const stopLevel = entryTrigger - atr14 * ATR_STOP_MULTIPLIER;

          // ── Chasing detection ──
          const chasing20 = chasingLastN(daily, 20, 5);
          const chasing55 = chasingLastN(daily, 55, 5);

          // ── ATR spike / collapse ──
          const atrOld = atr20DaysAgo(daily);
          const atrSpiking = atrOld > 0 ? atr14 >= atrOld * 1.3 : false;
          const atrCollapsing = atrOld > 0 ? atr14 <= atrOld * 0.5 : false;

          // ── Volume ──
          const volRatio = volumeRatio(daily);
          const dVol20 = dollarVol20(daily);
          const liquidityOk = dVol20 > 500_000;

          // ── Relative strength ──
          const rsPct = await rsVsBenchmark(closes, spyCloses);

          // ── Status classification (aligned with scan-engine spec) ──
          // READY: ≤2% to 20d high, WATCH: ≤3%, FAR: >3%
          let status: string;
          const priceAboveMa200 = ma200 > 0 && close > ma200;
          const bullishDI = plusDI > minusDI;

          if (!priceAboveMa200 || !bullishDI) {
            status = 'IGNORE';
          } else if (distTo20 <= 2) {
            status = 'READY';
          } else if (distTo20 <= 3) {
            status = 'WATCH';
          } else {
            status = 'FAR';
          }

          // Trend override
          if (priceAboveMa200 && adx >= 20 && bullishDI && distTo20 > 5) {
            status = 'TREND';
          }

          // ── Cluster exposure ──
          const cluster = stock.cluster || 'General';
          const superCluster = stock.superCluster || 'Other';
          const clusterRiskPct = equity > 0 ? ((clusterRisk.get(cluster) || 0) / equity) * 100 : 0;
          const superClusterRiskPct = equity > 0 ? ((superClusterRisk.get(superCluster) || 0) / equity) * 100 : 0;

          // ── Build raw JSON (all key-value pairs) ──
          const rawJson = JSON.stringify({
            ticker: stock.ticker,
            name: stock.name,
            sleeve: stock.sleeve,
            close, atr14, atrPct, adx14: adx, plusDI, minusDI,
            ma50, ma200, efficiency,
            high20, high55, distTo20, distTo55,
            entryTrigger, stopLevel,
            chasing20, chasing55,
            atrSpiking, atrCollapsing,
            volRatio, dVol20, liquidityOk,
            rsPct, regime, regimeStable,
            status, cluster, superCluster,
            clusterRiskPct, superClusterRiskPct,
          });

          return {
            snapshotId: snapshot.id,
            ticker: stock.ticker,
            name: stock.name,
            sleeve: stock.sleeve,
            status,
            currency: stock.currency,
            close,
            atr14,
            atrPct,
            adx14: adx,
            plusDi: plusDI,
            minusDi: minusDI,
            volRatio,
            dollarVol20: dVol20,
            liquidityOk,
            marketRegime: regime,
            marketRegimeStable: regimeStable,
            high20,
            high55,
            distanceTo20dHighPct: distTo20,
            distanceTo55dHighPct: distTo55,
            entryTrigger,
            stopLevel,
            chasing20Last5: chasing20,
            chasing55Last5: chasing55,
            atrSpiking,
            atrCollapsing,
            rsVsBenchmarkPct: rsPct,
            daysToEarnings: null,  // Not available from Yahoo without premium
            earningsInNext5d: false,
            clusterName: cluster,
            superClusterName: superCluster,
            clusterExposurePct: clusterRiskPct,
            superClusterExposurePct: superClusterRiskPct,
            maxClusterPct: maxClusterPct * 100,
            maxSuperClusterPct: maxSuperClusterPct * 100,
            rawJson,
          };
        } catch (err) {
          console.warn(`[Sync] Failed ${stock.ticker}:`, (err as Error).message);
          failed.push(stock.ticker);
          return null;
        }
      })
    );

    // Collect successful results for batch write at end
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        batchData.push(result.value);
        done++;
      }
    }

    // Report progress
    if (onProgress) {
      onProgress({
        total: stocks.length,
        done,
        failed: failed.length,
        ticker: batch[batch.length - 1]?.ticker || '',
      });
    }

    // Pause between batches (be kind to Yahoo)
    if (i + BATCH_SIZE < stocks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // 7. Write all collected rows + update snapshot count in a single transaction
  await prisma.$transaction([
    ...batchData.map((d) =>
      prisma.snapshotTicker.create({ data: d as Parameters<typeof prisma.snapshotTicker.create>[0]['data'] })
    ),
    prisma.snapshot.update({
      where: { id: snapshot.id },
      data: { rowCount: done },
    }),
  ]);

  return {
    snapshotId: snapshot.id,
    rowCount: done,
    failed,
    regime,
    durationMs: Date.now() - t0,
  };
}
