export const dynamic = 'force-dynamic';

/**
 * DEPENDENCIES
 * Consumed by: Portfolio positions page (T212 closure sync button)
 * Consumes: position-sync.ts, prisma.ts, api-response.ts
 * Risk-sensitive: YES — triggers auto-close of positions via T212 state
 * Last modified: 2026-03-02
 * Notes: Rate-limited to once per 60 seconds. Does NOT modify syncClosedPositions() —
 *        queries recently-closed positions from DB after sync for UI display.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { syncClosedPositions } from '@/lib/position-sync';
import { apiError } from '@/lib/api-response';

// In-memory rate limit — last successful sync timestamp
let lastSyncAt = 0;
const RATE_LIMIT_MS = 60_000; // 60 seconds
const TIMEOUT_MS = 30_000; // 30 second timeout

// POST /api/positions/sync — manually trigger T212 closed-position detection
export async function POST() {
  try {
    // Rate limit check
    const now = Date.now();
    const elapsed = now - lastSyncAt;
    if (elapsed < RATE_LIMIT_MS) {
      const waitSeconds = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      return apiError(429, 'RATE_LIMITED', `Sync already ran recently. Please wait ${waitSeconds}s before syncing again.`);
    }

    // Check if any open positions exist
    const openCount = await prisma.position.count({ where: { status: 'OPEN' } });

    if (openCount === 0) {
      lastSyncAt = now;
      return NextResponse.json({
        ok: true,
        checked: 0,
        closed: 0,
        closedPositions: [],
        errors: [],
        message: 'No open positions to sync.',
      });
    }

    // Run sync with timeout
    const syncPromise = syncClosedPositions('default-user');
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Sync timed out after 30 seconds')), TIMEOUT_MS)
    );

    const result = await Promise.race([syncPromise, timeoutPromise]);

    lastSyncAt = Date.now();

    // Query positions closed by AUTO_SYNC in the last 5 minutes for display details
    const recentlyClosed = await prisma.position.findMany({
      where: {
        closedBy: 'AUTO_SYNC',
        exitDate: { gte: new Date(now - 5 * 60_000) },
      },
      select: {
        id: true,
        exitPrice: true,
        exitReason: true,
        realisedPnlGbp: true,
        realisedPnlR: true,
        stock: { select: { ticker: true, name: true } },
      },
    });

    const closedPositions = recentlyClosed.map((p) => ({
      positionId: p.id,
      ticker: p.stock.ticker,
      companyName: p.stock.name,
      exitPrice: p.exitPrice,
      exitReason: p.exitReason,
      realisedPnlGbp: p.realisedPnlGbp,
      realisedPnlR: p.realisedPnlR,
    }));

    return NextResponse.json({
      ok: true,
      checked: result.checked,
      closed: result.closed,
      closedPositions,
      errors: result.errors,
    });
  } catch (error) {
    console.error('POST /api/positions/sync error:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';
    return apiError(500, 'SYNC_FAILED', message, undefined, true);
  }
}
