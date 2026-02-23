import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Trading212Client, Trading212Error } from '@/lib/trading212';
import type { T212AccountType } from '@/lib/trading212-dual';
import { ensureDefaultUser } from '@/lib/default-user';
import { updateStopLoss, StopLossError } from '@/lib/stop-manager';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const setStopSchema = z.object({
  positionId: z.string().trim().min(1),
  stopPrice: z.coerce.number().positive(),
});

// ============================================================
// Trading 212 Stop Order API
// ============================================================
// GET    — List all pending stop orders from T212
// POST   — Set/replace a stop-loss on T212 (cancel old + place new)
// DELETE — Remove a stop-loss from T212
// PUT    — Push all DB stops to T212 (bulk sync)
// ============================================================

/**
 * Helper: create a T212 client from the user's stored credentials.
 * Routes to the correct account (Invest or ISA) based on accountType.
 * CRITICAL: a stop on an ISA position must NEVER be sent to the Invest client and vice versa.
 */
async function getT212Client(userId: string, accountType?: T212AccountType | string | null) {
  const acctType: T212AccountType = (accountType === 'isa') ? 'isa' : 'invest';

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      t212ApiKey: true,
      t212ApiSecret: true,
      t212Environment: true,
      t212Connected: true,
      t212IsaApiKey: true,
      t212IsaApiSecret: true,
      t212IsaConnected: true,
    },
  });

  if (!user) {
    throw new Error('User not found.');
  }

  if (acctType === 'isa') {
    if (!user.t212IsaApiKey || !user.t212IsaApiSecret || !user.t212IsaConnected) {
      throw new Error('Trading 212 ISA account not connected. Go to Settings to add your ISA API credentials.');
    }
    return new Trading212Client(
      user.t212IsaApiKey,
      user.t212IsaApiSecret,
      user.t212Environment as 'demo' | 'live'
    );
  }

  // Invest (default)
  if (!user.t212ApiKey || !user.t212ApiSecret || !user.t212Connected) {
    throw new Error('Trading 212 Invest account not connected. Go to Settings to add your API credentials.');
  }
  return new Trading212Client(
    user.t212ApiKey,
    user.t212ApiSecret,
    user.t212Environment as 'demo' | 'live'
  );
}

/**
 * Helper: get a T212 client for a specific position, based on its accountType.
 * Guarantees the stop is routed to the correct account.
 */
async function getT212ClientForPosition(position: { userId: string; accountType: string | null }) {
  return getT212Client(position.userId, position.accountType);
}

/**
 * GET — List all pending stop orders from T212
 * Fetches from both Invest and ISA accounts (where connected).
 * Matches them against local DB positions by accountType.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');
    if (!userId) userId = await ensureDefaultUser();

    // Load all open positions
    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    // Determine which accounts we need to query
    const hasInvestPositions = positions.some((p) => p.accountType !== 'isa');
    const hasIsaPositions = positions.some((p) => p.accountType === 'isa');

    // Fetch pending orders from each connected account in parallel
    const pendingOrderFetches: Array<{
      acctType: T212AccountType;
      promise: Promise<Awaited<ReturnType<Trading212Client['getPendingOrders']>>>;
    }> = [];

    if (hasInvestPositions) {
      try {
        const investClient = await getT212Client(userId, 'invest');
        pendingOrderFetches.push({ acctType: 'invest', promise: investClient.getPendingOrders() });
      } catch { /* Invest not connected — skip */ }
    }
    if (hasIsaPositions) {
      try {
        const isaClient = await getT212Client(userId, 'isa');
        pendingOrderFetches.push({ acctType: 'isa', promise: isaClient.getPendingOrders() });
      } catch { /* ISA not connected — skip */ }
    }

    // Collect results, keyed by account type
    const stopOrdersByAccount = new Map<T212AccountType, Awaited<ReturnType<Trading212Client['getPendingOrders']>>>();
    const fetchResults = await Promise.allSettled(
      pendingOrderFetches.map(async ({ acctType, promise }) => ({ acctType, orders: await promise }))
    );
    for (const result of fetchResults) {
      if (result.status === 'fulfilled') {
        const stops = result.value.orders.filter((o) => o.type === 'STOP' && o.side === 'SELL');
        stopOrdersByAccount.set(result.value.acctType, stops);
      }
    }

    // Match each position against the correct account's stop orders
    const matched = await Promise.all(positions.map(async (pos) => {
      const posAcctType: T212AccountType = pos.accountType === 'isa' ? 'isa' : 'invest';
      const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker || '';
      const accountStops = stopOrdersByAccount.get(posAcctType) ?? [];
      const matchedOrder = accountStops.find((o) => o.ticker === t212Ticker);
      const t212Stop = matchedOrder?.stopPrice ?? 0;

      // If T212 has a higher stop than the DB, sync the DB UP (monotonic)
      let dbSyncedUp = false;
      if (t212Stop > pos.currentStop) {
        try {
          await updateStopLoss(
            pos.id,
            t212Stop,
            `Synced from T212 (${posAcctType.toUpperCase()}): ${pos.currentStop.toFixed(2)} → ${t212Stop.toFixed(2)}`
          );
          dbSyncedUp = true;
        } catch {
          // Monotonic or other error — ignore
        }
      }

      return {
        positionId: pos.id,
        ticker: pos.stock.ticker,
        t212Ticker,
        accountType: posAcctType,
        shares: pos.shares,
        currentStop: dbSyncedUp ? t212Stop : pos.currentStop,
        t212StopOrder: matchedOrder
          ? {
              orderId: matchedOrder.id,
              stopPrice: matchedOrder.stopPrice,
              quantity: matchedOrder.quantity,
              status: matchedOrder.status,
              createdAt: matchedOrder.createdAt,
            }
          : null,
        inSync: matchedOrder
          ? Math.abs(t212Stop - (dbSyncedUp ? t212Stop : pos.currentStop)) < 0.01
          : false,
        hasT212Stop: !!matchedOrder,
        dbSyncedUp,
      };
    }));

    // Collect unmatched stop orders across all accounts
    const allStopOrders = Array.from(stopOrdersByAccount.values()).flat();
    const unmatched = allStopOrders.filter(
      (o) => !positions.some((p) => (p.t212Ticker || p.stock.t212Ticker) === o.ticker)
    );

    return NextResponse.json({
      positions: matched,
      unmatched,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Trading212Error) {
      return apiError(error.statusCode === 429 ? 429 : 400, 'T212_ERROR', error.message, undefined, error.statusCode === 429);
    }
    return apiError(500, 'T212_STOPS_FETCH_FAILED', (error as Error).message, undefined, true);
  }
}

/**
 * POST — Set or replace a stop-loss on Trading 212
 * Body: { positionId, stopPrice }
 * 1. Looks up position & T212 ticker
 * 2. Cancels existing stop orders for that ticker
 * 3. Places a new STOP SELL order at stopPrice (GTC)
 * 4. Updates local DB stop
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, setStopSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { positionId, stopPrice } = parsed.data;

    // Load position with stock info
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { stock: true },
    });

    if (!position) {
      return apiError(404, 'POSITION_NOT_FOUND', 'Position not found');
    }

    if (position.status === 'CLOSED') {
      return apiError(400, 'POSITION_CLOSED', 'Cannot set stop on a closed position');
    }

    const t212Ticker = position.t212Ticker || position.stock.t212Ticker;
    if (!t212Ticker) {
      return apiError(400, 'MISSING_T212_TICKER', `No Trading 212 ticker mapped for ${position.stock.ticker}. Sync with T212 first.`);
    }

    // Validate stop price
    if (stopPrice <= 0) {
      return apiError(400, 'INVALID_STOP_PRICE', 'Stop price must be positive');
    }

    const client = await getT212ClientForPosition(position);

    // setStopLoss handles: fetch pending orders, monotonic check, cancel old, place new
    // — no need to call getPendingOrders() separately (avoids 1-req/5s rate limit)
    const order = await client.setStopLoss(t212Ticker, position.shares, stopPrice);

    // Also update local DB stop (respecting monotonic rule)
    let dbUpdated = false;
    if (stopPrice > position.currentStop) {
      try {
        await updateStopLoss(
          positionId,
          stopPrice,
          `T212 stop order placed: ${position.currentStop.toFixed(2)} → ${stopPrice.toFixed(2)}`
        );
        dbUpdated = true;
      } catch (e) {
        if (e instanceof StopLossError) {
          // DB update failed but T212 order was placed - still a success
          console.warn(`T212 stop placed but DB update blocked: ${e.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      ticker: position.stock.ticker,
      t212Ticker,
      stopPrice,
      orderId: order?.id ?? null,
      orderStatus: order?.status ?? null,
      dbUpdated,
      message: `Stop-loss ${order ? 'placed' : 'cleared'} on Trading 212 at ${stopPrice.toFixed(2)}`,
    });
  } catch (error) {
    if (error instanceof Trading212Error) {
      return apiError(error.statusCode === 429 ? 429 : 400, 'T212_ERROR', error.message, undefined, error.statusCode === 429);
    }
    return apiError(500, 'T212_STOPS_SET_FAILED', (error as Error).message, undefined, true);
  }
}

/**
 * DELETE — Remove stop-loss orders from Trading 212
 * Body: { positionId } or query param positionId
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let positionId = searchParams.get('positionId');

    if (!positionId) {
      const body = await request.json().catch(() => ({}));
      positionId = body.positionId;
    }

    if (!positionId) {
      return apiError(400, 'INVALID_REQUEST', 'positionId is required');
    }

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { stock: true },
    });

    if (!position) {
      return apiError(404, 'POSITION_NOT_FOUND', 'Position not found');
    }

    const t212Ticker = position.t212Ticker || position.stock.t212Ticker;
    if (!t212Ticker) {
      return apiError(400, 'MISSING_T212_TICKER', 'No T212 ticker mapped');
    }

    const client = await getT212ClientForPosition(position);
    const cancelled = await client.removeStopLoss(t212Ticker);

    return NextResponse.json({
      success: true,
      ticker: position.stock.ticker,
      cancelled,
      message: cancelled > 0
        ? `Removed ${cancelled} stop order(s) from Trading 212`
        : 'No active stop orders found on Trading 212',
    });
  } catch (error) {
    if (error instanceof Trading212Error) {
      return apiError(error.statusCode === 429 ? 429 : 400, 'T212_ERROR', error.message, undefined, error.statusCode === 429);
    }
    return apiError(500, 'T212_STOPS_DELETE_FAILED', (error as Error).message, undefined, true);
  }
}

/**
 * PUT — Bulk push all DB stops to Trading 212
 * Uses setStopLossBatch to fetch pending orders ONCE per account, then process all positions.
 * Much faster than individual setStopLoss calls (seconds vs minutes for many positions).
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let userId = body.userId;
    if (!userId) userId = await ensureDefaultUser();

    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    // Group positions by account type for batched processing
    const byAccount = new Map<T212AccountType, typeof positions>();
    const skippedResults: Array<{
      ticker: string; t212Ticker: string; accountType: string; stopPrice: number; action: string;
    }> = [];

    for (const pos of positions) {
      const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker;
      const posAcctType: T212AccountType = pos.accountType === 'isa' ? 'isa' : 'invest';

      if (!t212Ticker) {
        skippedResults.push({ ticker: pos.stock.ticker, t212Ticker: '', accountType: posAcctType, stopPrice: pos.currentStop, action: 'SKIPPED_NO_T212_TICKER' });
        continue;
      }
      if (pos.currentStop <= 0) {
        skippedResults.push({ ticker: pos.stock.ticker, t212Ticker, accountType: posAcctType, stopPrice: 0, action: 'SKIPPED_NO_STOP' });
        continue;
      }

      const group = byAccount.get(posAcctType) ?? [];
      group.push(pos);
      byAccount.set(posAcctType, group);
    }

    // Process each account type with a single batch call
    const results: Array<{
      ticker: string; t212Ticker: string; accountType: string; stopPrice: number; action: string; orderId?: number;
    }> = [...skippedResults];

    for (const [acctType, acctPositions] of byAccount.entries()) {
      try {
        const client = await getT212Client(userId, acctType);

        const batchInput = acctPositions.map((pos) => ({
          t212Ticker: (pos.t212Ticker || pos.stock.t212Ticker)!,
          shares: pos.shares,
          stopPrice: pos.currentStop,
        }));

        // Ticker lookup for results
        const tickerMap = new Map(acctPositions.map((p) => [p.t212Ticker || p.stock.t212Ticker, p.stock.ticker]));

        const batchResults = await client.setStopLossBatch(batchInput);

        for (const r of batchResults) {
          results.push({
            ticker: tickerMap.get(r.t212Ticker) || r.t212Ticker,
            t212Ticker: r.t212Ticker,
            accountType: acctType,
            stopPrice: r.stopPrice,
            action: r.action === 'FAILED' ? `FAILED: ${r.error}` : r.action,
            orderId: r.orderId,
          });
        }
      } catch (error) {
        // Client creation failed — mark all positions in this account as failed
        for (const pos of acctPositions) {
          results.push({
            ticker: pos.stock.ticker,
            t212Ticker: pos.t212Ticker || pos.stock.t212Ticker || '',
            accountType: acctType,
            stopPrice: pos.currentStop,
            action: `FAILED: ${(error as Error).message}`,
          });
        }
      }
    }

    return NextResponse.json({
      total: positions.length,
      placed: results.filter((r) => r.action === 'PLACED').length,
      skipped: results.filter((r) => r.action.startsWith('SKIPPED')).length,
      failed: results.filter((r) => r.action.startsWith('FAILED')).length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Trading212Error) {
      return apiError(error.statusCode === 429 ? 429 : 400, 'T212_ERROR', error.message, undefined, error.statusCode === 429);
    }
    return apiError(500, 'T212_STOPS_BULK_SYNC_FAILED', (error as Error).message, undefined, true);
  }
}
