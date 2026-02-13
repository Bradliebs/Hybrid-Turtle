import { NextResponse } from 'next/server';
import { getScanCache } from '@/lib/scan-cache';
import prisma from '@/lib/prisma';
import { scoreAll, normaliseRow, type SnapshotRow, type ScoredTicker } from '@/lib/dual-score';
import * as fs from 'fs';
import * as path from 'path';

// ── Locate master_snapshot.csv as fallback ──────────────────
const PLANNING_SIBLING = path.resolve(process.cwd(), '../Planning');
const PLANNING_LOCAL = path.resolve(process.cwd(), 'Planning');
const PLANNING_DIR = fs.existsSync(PLANNING_SIBLING) ? PLANNING_SIBLING : PLANNING_LOCAL;
const CSV_PATH = path.join(PLANNING_DIR, 'master_snapshot.csv');

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.length < 2) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = (values[j] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function dbRowToSnapshotRow(row: Record<string, unknown>): SnapshotRow {
  return {
    ticker: row.ticker as string,
    name: (row.name as string) || (row.ticker as string),
    sleeve: (row.sleeve as string) || '',
    status: (row.status as string) || '',
    currency: (row.currency as string) || '',
    close: (row.close as number) || 0,
    atr_14: (row.atr14 as number) || 0,
    atr_pct: (row.atrPct as number) || 0,
    adx_14: (row.adx14 as number) || 0,
    plus_di: (row.plusDi as number) || 0,
    minus_di: (row.minusDi as number) || 0,
    vol_ratio: (row.volRatio as number) || 1,
    dollar_vol_20: (row.dollarVol20 as number) || 0,
    liquidity_ok: (row.liquidityOk as boolean) ?? true,
    market_regime: (row.marketRegime as string) || 'NEUTRAL',
    market_regime_stable: (row.marketRegimeStable as boolean) ?? true,
    high_20: (row.high20 as number) || 0,
    high_55: (row.high55 as number) || 0,
    distance_to_20d_high_pct: (row.distanceTo20dHighPct as number) || 0,
    distance_to_55d_high_pct: (row.distanceTo55dHighPct as number) || 0,
    entry_trigger: (row.entryTrigger as number) || 0,
    stop_level: (row.stopLevel as number) || 0,
    chasing_20_last5: (row.chasing20Last5 as boolean) ?? false,
    chasing_55_last5: (row.chasing55Last5 as boolean) ?? false,
    atr_spiking: (row.atrSpiking as boolean) ?? false,
    atr_collapsing: (row.atrCollapsing as boolean) ?? false,
    rs_vs_benchmark_pct: (row.rsVsBenchmarkPct as number) || 0,
    days_to_earnings: (row.daysToEarnings as number | null) ?? null,
    earnings_in_next_5d: (row.earningsInNext5d as boolean) ?? false,
    cluster_name: (row.clusterName as string) || '',
    super_cluster_name: (row.superClusterName as string) || '',
    cluster_exposure_pct: (row.clusterExposurePct as number) || 0,
    super_cluster_exposure_pct: (row.superClusterExposurePct as number) || 0,
    max_cluster_pct: (row.maxClusterPct as number) || 0,
    max_super_cluster_pct: (row.maxSuperClusterPct as number) || 0,
  };
}

// ── Load dual-score tickers ─────────────────────────────────
async function getDualScoreTickers(): Promise<ScoredTicker[]> {
  // Try DB first
  const snapshot = await prisma.snapshot.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  if (snapshot) {
    const dbRows = await prisma.snapshotTicker.findMany({
      where: { snapshotId: snapshot.id },
    });
    if (dbRows.length > 0) {
      const snapshotRows: SnapshotRow[] = dbRows.map((r) =>
        dbRowToSnapshotRow(r as unknown as Record<string, unknown>)
      );
      return scoreAll(snapshotRows);
    }
  }
  // Fallback to CSV
  if (fs.existsSync(CSV_PATH)) {
    const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
    const rawRows = parseCSV(csvText);
    const snapshotRows: SnapshotRow[] = rawRows.map((r) =>
      normaliseRow(r as unknown as Record<string, unknown>)
    );
    return scoreAll(snapshotRows);
  }
  return [];
}

// ── Cross-reference types ───────────────────────────────────
interface CrossRefTicker {
  ticker: string;
  name: string;
  sleeve: string;
  // 7-Stage Scan data
  scanStatus: string | null;      // READY / WATCH / FAR
  scanRankScore: number | null;
  scanPassesFilters: boolean | null;
  scanPassesRiskGates: boolean | null;
  scanPassesAntiChase: boolean | null;
  scanDistancePercent: number | null;
  scanEntryTrigger: number | null;
  scanPrice: number | null;
  scanShares: number | null;
  // Dual Score data
  dualBQS: number | null;
  dualFWS: number | null;
  dualNCS: number | null;
  dualAction: string | null;
  dualStatus: string | null;
  // Cross-reference classification
  matchType: 'BOTH_RECOMMEND' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'BOTH_REJECT' | 'CONFLICT';
  agreementScore: number;          // 0-100 how aligned the two systems are
}

export async function GET() {
  try {
    // ── Load both datasets ──────────────────────────────────
    const scanCache = getScanCache();
    const dualTickers = await getDualScoreTickers();

    const hasScanData = scanCache && Array.isArray(scanCache.candidates) && scanCache.candidates.length > 0;
    const hasDualData = dualTickers.length > 0;

    if (!hasScanData && !hasDualData) {
      return NextResponse.json(
        {
          error: 'No data available',
          message: 'Run the 7-Stage Scan and/or sync Dual Score data first.',
          hasScanData: false,
          hasDualData: false,
        },
        { status: 404 }
      );
    }

    // ── Build lookup maps ───────────────────────────────────
    const scanMap = new Map<string, any>();
    if (hasScanData) {
      for (const c of scanCache!.candidates as any[]) {
        scanMap.set(c.ticker, c);
      }
    }

    const dualMap = new Map<string, ScoredTicker>();
    for (const t of dualTickers) {
      dualMap.set(t.ticker, t);
    }

    // ── Merge all tickers ───────────────────────────────────
    const allTickerArr: string[] = [];
    scanMap.forEach((_, k) => allTickerArr.push(k));
    dualMap.forEach((_, k) => { if (!scanMap.has(k)) allTickerArr.push(k); });
    const crossRef: CrossRefTicker[] = [];

    for (const ticker of allTickerArr) {
      const scan = scanMap.get(ticker);
      const dual = dualMap.get(ticker);

      // Determine if each system "recommends"
      const scanRecommends = scan
        ? scan.passesAllFilters && (scan.status === 'READY' || scan.status === 'WATCH')
        : null;
      const dualRecommends = dual
        ? dual.NCS >= 50 && dual.FWS <= 50
        : null;

      // Classify match type
      let matchType: CrossRefTicker['matchType'];
      if (scanRecommends === true && dualRecommends === true) {
        matchType = 'BOTH_RECOMMEND';
      } else if (scanRecommends === true && dualRecommends === false) {
        matchType = 'CONFLICT';
      } else if (scanRecommends === false && dualRecommends === true) {
        matchType = 'CONFLICT';
      } else if (scanRecommends === null && dualRecommends === true) {
        matchType = 'DUAL_ONLY';
      } else if (scanRecommends === true && dualRecommends === null) {
        matchType = 'SCAN_ONLY';
      } else if (scanRecommends === null && dualRecommends === false) {
        matchType = 'BOTH_REJECT';
      } else if (scanRecommends === false && dualRecommends === null) {
        matchType = 'BOTH_REJECT';
      } else if (scanRecommends === false && dualRecommends === false) {
        matchType = 'BOTH_REJECT';
      } else {
        matchType = 'BOTH_REJECT';
      }

      // Calculate agreement score (0-100)
      let agreementScore = 50; // neutral start
      if (scan && dual) {
        // Both have data — measure alignment
        const scanScore = scanRecommends ? 100 : 0;
        const dualScore = dualRecommends ? 100 : 0;
        // Add nuance from NCS and rank
        const ncsNorm = Math.min(100, Math.max(0, dual.NCS));
        const rankNorm = Math.min(100, Math.max(0, scan.rankScore));
        agreementScore = Math.round(
          (scanScore * 0.25 + dualScore * 0.25 + ncsNorm * 0.25 + rankNorm * 0.25)
        );
      } else if (scan) {
        agreementScore = scanRecommends ? 75 : 25;
      } else if (dual) {
        agreementScore = dualRecommends ? 75 : 25;
      }

      crossRef.push({
        ticker,
        name: scan?.name || dual?.name || ticker,
        sleeve: scan?.sleeve || dual?.sleeve || '',
        // 7-Stage scan data
        scanStatus: scan?.status ?? null,
        scanRankScore: scan?.rankScore ?? null,
        scanPassesFilters: scan?.passesAllFilters ?? null,
        scanPassesRiskGates: scan?.passesRiskGates ?? null,
        scanPassesAntiChase: scan?.passesAntiChase ?? null,
        scanDistancePercent: scan?.distancePercent ?? null,
        scanEntryTrigger: scan?.entryTrigger ?? null,
        scanPrice: scan?.price ?? null,
        scanShares: scan?.shares ?? null,
        // Dual score data
        dualBQS: dual?.BQS ?? null,
        dualFWS: dual?.FWS ?? null,
        dualNCS: dual?.NCS ?? null,
        dualAction: dual?.ActionNote ?? null,
        dualStatus: dual?.status ?? null,
        // Classification
        matchType,
        agreementScore,
      });
    }

    // Sort: BOTH_RECOMMEND first (by agreement desc), then CONFLICT, SCAN_ONLY, DUAL_ONLY, BOTH_REJECT
    const typeOrder: Record<string, number> = {
      BOTH_RECOMMEND: 0,
      CONFLICT: 1,
      SCAN_ONLY: 2,
      DUAL_ONLY: 3,
      BOTH_REJECT: 4,
    };
    crossRef.sort((a, b) => {
      const oa = typeOrder[a.matchType] ?? 5;
      const ob = typeOrder[b.matchType] ?? 5;
      if (oa !== ob) return oa - ob;
      return b.agreementScore - a.agreementScore;
    });

    // ── Summary stats ───────────────────────────────────────
    const summary = {
      total: crossRef.length,
      bothRecommend: crossRef.filter((c) => c.matchType === 'BOTH_RECOMMEND').length,
      conflict: crossRef.filter((c) => c.matchType === 'CONFLICT').length,
      scanOnly: crossRef.filter((c) => c.matchType === 'SCAN_ONLY').length,
      dualOnly: crossRef.filter((c) => c.matchType === 'DUAL_ONLY').length,
      bothReject: crossRef.filter((c) => c.matchType === 'BOTH_REJECT').length,
      hasScanData: !!hasScanData,
      hasDualData,
      scanCachedAt: scanCache?.cachedAt ?? null,
    };

    return NextResponse.json({ tickers: crossRef, summary });
  } catch (error) {
    console.error('[CrossRef] Error:', error);
    return NextResponse.json(
      { error: 'Failed to build cross-reference', message: (error as Error).message },
      { status: 500 }
    );
  }
}
