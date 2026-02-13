import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { scoreAll, normaliseRow, type SnapshotRow, type ScoredTicker } from '@/lib/dual-score';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

// ── Locate master_snapshot.csv as fallback ──────────────────
const PLANNING_SIBLING = path.resolve(process.cwd(), '../Planning');
const PLANNING_LOCAL = path.resolve(process.cwd(), 'Planning');
const PLANNING_DIR = fs.existsSync(PLANNING_SIBLING) ? PLANNING_SIBLING : PLANNING_LOCAL;
const CSV_PATH = path.join(PLANNING_DIR, 'master_snapshot.csv');

// ── CSV parser (handles quoted fields) ──────────────────────
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

// ── DB row → SnapshotRow for the scoring engine ─────────────
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

// ── Helper: build standard API response from scored tickers ──
function buildResponse(scored: ScoredTicker[], updatedAt: string, source: string) {
  const autoYes = scored.filter((r) => r.NCS >= 70 && r.FWS <= 30).length;
  const autoNo = scored.filter((r) => r.FWS > 65).length;
  const conditional = scored.length - autoYes - autoNo;
  const avg = (arr: ScoredTicker[], key: 'NCS' | 'BQS' | 'FWS') =>
    arr.length > 0
      ? Math.round((arr.reduce((s, r) => s + r[key], 0) / arr.length) * 10) / 10
      : 0;

  const sleeves = Array.from(new Set(scored.map((r) => r.sleeve).filter(Boolean))).sort();
  const statuses = Array.from(new Set(scored.map((r) => r.status).filter(Boolean))).sort();

  return {
    tickers: scored,
    summary: {
      total: scored.length,
      autoYes,
      autoNo,
      conditional,
      avgNCS: avg(scored, 'NCS'),
      avgBQS: avg(scored, 'BQS'),
      avgFWS: avg(scored, 'FWS'),
    },
    filters: { sleeves, statuses },
    source,
    updatedAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const preferCSV = searchParams.get('source') === 'csv';
    const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

    // ── Strategy 1: Database (latest synced snapshot) ────────
    if (!preferCSV && hasDatabaseUrl) {
      try {
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
            const scored = scoreAll(snapshotRows);
            scored.sort((a, b) => b.NCS - a.NCS);

            return NextResponse.json(
              buildResponse(scored, snapshot.createdAt.toISOString(), snapshot.source || 'database')
            );
          }
        }
      } catch (dbError) {
        console.warn('[DualScore] DB unavailable, falling back to CSV:', (dbError as Error).message);
      }
    }

    // ── Strategy 2: Fallback to CSV file ────────────────────
    if (fs.existsSync(CSV_PATH)) {
      const stat = fs.statSync(CSV_PATH);
      const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
      const rawRows = parseCSV(csvText);
      const snapshotRows: SnapshotRow[] = rawRows.map((r) =>
        normaliseRow(r as unknown as Record<string, unknown>)
      );
      const scored = scoreAll(snapshotRows);
      scored.sort((a, b) => b.NCS - a.NCS);

      return NextResponse.json(
        buildResponse(scored, stat.mtime.toISOString(), 'csv')
      );
    }

    // ── No data available ───────────────────────────────────
    return NextResponse.json(
      {
        error: 'No snapshot data available',
        message: 'Click "Sync from Yahoo" to fetch live data, or place a master_snapshot.csv in the Planning folder.',
        hasData: false,
      },
      { status: 404 }
    );
  } catch (error) {
    console.error('[DualScore] Error:', error);
    return NextResponse.json(
      { error: 'Failed to compute scores', message: (error as Error).message },
      { status: 500 }
    );
  }
}
