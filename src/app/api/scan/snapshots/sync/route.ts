export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { syncSnapshot } from '@/lib/snapshot-sync';
import { apiError } from '@/lib/api-response';

// ── POST: Trigger a full data sync from Yahoo Finance ───────
// Fetches live market data for every stock in the universe,
// computes technicals, and writes a new Snapshot to the DB.
// This replaces the Python master_snapshot pipeline.
export async function POST() {
  try {
    const result = await syncSnapshot();

    return NextResponse.json({
      success: true,
      snapshotId: result.snapshotId,
      rowCount: result.rowCount,
      failed: result.failed,
      regime: result.regime,
      durationMs: result.durationMs,
      message: `Synced ${result.rowCount} tickers in ${(result.durationMs / 1000).toFixed(1)}s` +
        (result.failed.length > 0 ? ` (${result.failed.length} failed)` : ''),
    });
  } catch (error) {
    console.error('[Snapshot Sync] Error:', error);
    return apiError(500, 'SNAPSHOT_SYNC_FAILED', 'Sync failed', (error as Error).message, true);
  }
}
