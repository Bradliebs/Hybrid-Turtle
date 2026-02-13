import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';

// ── CSV parser (handles quoted fields) ──────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────
function safeFloat(v: string | undefined, fallback = 0): number {
  if (!v || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeInt(v: string | undefined): number | null {
  if (!v || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function safeBool(v: string | undefined, fallback = false): boolean {
  if (!v || v === '') return fallback;
  return ['true', '1', 'yes'].includes(v.toLowerCase());
}

const snapshotJsonSchema = z.object({
  csv: z.string().min(1),
  filename: z.string().optional(),
  source: z.string().optional(),
});

// ── POST: Upload CSV text → store in DB ─────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let csvText: string;
    let filename = 'master_snapshot.csv';
    let source = 'upload';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      source = (formData.get('source') as string) || 'upload';
      if (!file) {
        return apiError(400, 'INVALID_REQUEST', 'No file uploaded');
      }
      filename = file.name;
      csvText = await file.text();
    } else {
      // Accept raw JSON body with csv field
      const rawBody = await request.json().catch(() => null);
      if (rawBody === null) {
        return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
      }
      const bodyParsed = snapshotJsonSchema.safeParse(rawBody);
      if (!bodyParsed.success) {
        return apiError(
          400,
          'INVALID_REQUEST',
          'Invalid snapshot payload',
          bodyParsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
        );
      }
      const body = bodyParsed.data;
      csvText = body.csv;
      filename = body.filename || filename;
      source = body.source || source;
    }

    const rawRows = parseCSV(csvText);
    if (rawRows.length === 0) {
      return apiError(400, 'INVALID_CSV', 'CSV is empty or malformed');
    }

    // Create snapshot + tickers in a transaction
    const snapshot = await prisma.$transaction(async (tx) => {
      const snap = await tx.snapshot.create({
        data: {
          source,
          filename,
          rowCount: rawRows.length,
        },
      });

      // Batch insert tickers
      const tickerData = rawRows.map((raw) => ({
        snapshotId: snap.id,
        ticker: raw.ticker || raw.ticker_yf || '',
        name: raw.name || raw.instrument_name || null,
        sleeve: raw.sleeve || null,
        status: raw.status || null,
        currency: raw.currency || raw.t212_currency || null,

        close: safeFloat(raw.close),
        atr14: safeFloat(raw.atr_14 || raw.atr),
        atrPct: safeFloat(raw.atr_pct),

        adx14: safeFloat(raw.adx_14 || raw.adx),
        plusDi: safeFloat(raw.plus_di),
        minusDi: safeFloat(raw.minus_di),

        volRatio: safeFloat(raw.vol_ratio, 1),
        dollarVol20: safeFloat(raw.dollar_vol_20),
        liquidityOk: safeBool(raw.liquidity_ok, true),

        marketRegime: raw.market_regime || 'NEUTRAL',
        marketRegimeStable: safeBool(raw.market_regime_stable, true),

        high20: safeFloat(raw.high_20 || raw['20d_high']),
        high55: safeFloat(raw.high_55 || raw['55d_high']),
        distanceTo20dHighPct: safeFloat(raw.distance_to_20d_high_pct),
        distanceTo55dHighPct: safeFloat(raw.distance_to_55d_high_pct),
        entryTrigger: safeFloat(raw.entry_trigger || raw.breakout_entry_trigger),
        stopLevel: safeFloat(raw.stop_level || raw.stop_price),

        chasing20Last5: safeBool(raw.chasing_20_last5),
        chasing55Last5: safeBool(raw.chasing_55_last5),
        atrSpiking: safeBool(raw.atr_spiking),
        atrCollapsing: safeBool(raw.atr_collapsing),

        rsVsBenchmarkPct: safeFloat(raw.rs_vs_benchmark || raw.rs_vs_benchmark_pct || raw.rs_pct),

        daysToEarnings: safeInt(raw.days_to_earnings),
        earningsInNext5d: safeBool(raw.earnings_in_next_5d),

        clusterName: raw.cluster || raw.cluster_name || null,
        superClusterName: raw.super_cluster || raw.super_cluster_name || null,
        clusterExposurePct: safeFloat(raw.cluster_risk_pct || raw.cluster_exposure_pct),
        superClusterExposurePct: safeFloat(raw.super_cluster_risk_pct || raw.super_cluster_exposure_pct),
        maxClusterPct: safeFloat(raw.max_cluster_pct_default || raw.max_cluster_pct),
        maxSuperClusterPct: safeFloat(raw.max_supercluster_pct_default || raw.max_super_cluster_pct),

        rawJson: JSON.stringify(raw),
      }));

      // SQLite doesn't support createMany efficiently, so batch in chunks
      const BATCH = 50;
      for (let i = 0; i < tickerData.length; i += BATCH) {
        const batch = tickerData.slice(i, i + BATCH);
        for (const data of batch) {
          await tx.snapshotTicker.create({ data });
        }
      }

      return snap;
    });

    return NextResponse.json({
      id: snapshot.id,
      source: snapshot.source,
      filename: snapshot.filename,
      rowCount: snapshot.rowCount,
      createdAt: snapshot.createdAt,
      message: `Imported ${rawRows.length} tickers successfully`,
    });
  } catch (error) {
    console.error('[Snapshot Import] Error:', error);
    return apiError(500, 'SNAPSHOT_IMPORT_FAILED', 'Import failed', (error as Error).message, true);
  }
}

// ── GET: List all snapshots (most recent first) ─────────────────────
export async function GET() {
  try {
    const snapshots = await prisma.snapshot.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        source: true,
        filename: true,
        rowCount: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error('[Snapshot List] Error:', error);
    return apiError(500, 'SNAPSHOT_LIST_FAILED', 'Failed to list snapshots', (error as Error).message, true);
  }
}

// ── DELETE: Remove a snapshot (and cascade tickers) ─────────────────
export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return apiError(400, 'INVALID_REQUEST', 'Snapshot id is required');
    }
    // Delete tickers first (cascade), then snapshot
    await prisma.snapshotTicker.deleteMany({ where: { snapshotId: id } });
    await prisma.snapshot.delete({ where: { id } });
    return NextResponse.json({ message: 'Snapshot deleted' });
  } catch (error) {
    console.error('[Snapshot Delete] Error:', error);
    return apiError(500, 'SNAPSHOT_DELETE_FAILED', 'Delete failed', (error as Error).message, true);
  }
}
