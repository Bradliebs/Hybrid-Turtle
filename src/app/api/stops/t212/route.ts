import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Trading212Client, Trading212Error } from '@/lib/trading212';
import { ensureDefaultUser } from '@/lib/default-user';
import { updateStopLoss, StopLossError } from '@/lib/stop-manager';

// ============================================================
// Trading 212 Stop Order API
// ============================================================
// GET    — List all pending stop orders from T212
// POST   — Set/replace a stop-loss on T212 (cancel old + place new)
// DELETE — Remove a stop-loss from T212
// PUT    — Push all DB stops to T212 (bulk sync)
// ============================================================

/**
 * Helper: create a T212 client from the user's stored credentials
 */
async function getT212Client(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      t212ApiKey: true,
      t212ApiSecret: true,
      t212Environment: true,
      t212Connected: true,
    },
  });

  if (!user || !user.t212ApiKey || !user.t212ApiSecret || !user.t212Connected) {
    throw new Error('Trading 212 not connected. Go to Settings to add your API credentials.');
  }

  return new Trading212Client(
    user.t212ApiKey,
    user.t212ApiSecret,
    user.t212Environment as 'demo' | 'live'
  );
}

/**
 * GET — List all pending stop orders from T212
 * Matches them against local DB positions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');
    if (!userId) userId = await ensureDefaultUser();

    const client = await getT212Client(userId);

    // Fetch pending orders and positions in parallel
    const [pendingOrders, positions] = await Promise.all([
      client.getPendingOrders(),
      prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: true },
      }),
    ]);

    // Filter to STOP sell orders only
    const stopOrders = pendingOrders.filter(
      (o) => o.type === 'STOP' && o.side === 'SELL'
    );

    // Match against local positions and sync DB if T212 has a higher stop
    const matched = await Promise.all(positions.map(async (pos) => {
      const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker || '';
      const matchedOrder = stopOrders.find((o) => o.ticker === t212Ticker);
      const t212Stop = matchedOrder?.stopPrice ?? 0;

      // If T212 has a higher stop than the DB, sync the DB UP (monotonic)
      let dbSyncedUp = false;
      if (t212Stop > pos.currentStop) {
        try {
          await updateStopLoss(
            pos.id,
            t212Stop,
            `Synced from T212: ${pos.currentStop.toFixed(2)} → ${t212Stop.toFixed(2)}`
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

    return NextResponse.json({
      positions: matched,
      unmatched: stopOrders.filter(
        (o) => !positions.some((p) => (p.t212Ticker || p.stock.t212Ticker) === o.ticker)
      ),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Trading212Error) {
      return NextResponse.json(
        { error: error.message, code: 'T212_ERROR' },
        { status: error.statusCode === 429 ? 429 : 400 }
      );
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
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
    const body = await request.json();
    const { positionId, stopPrice } = body;

    if (!positionId || !stopPrice) {
      return NextResponse.json(
        { error: 'positionId and stopPrice are required' },
        { status: 400 }
      );
    }

    // Load position with stock info
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { stock: true },
    });

    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    if (position.status === 'CLOSED') {
      return NextResponse.json({ error: 'Cannot set stop on a closed position' }, { status: 400 });
    }

    const t212Ticker = position.t212Ticker || position.stock.t212Ticker;
    if (!t212Ticker) {
      return NextResponse.json(
        { error: `No Trading 212 ticker mapped for ${position.stock.ticker}. Sync with T212 first.` },
        { status: 400 }
      );
    }

    // Validate stop price
    if (stopPrice <= 0) {
      return NextResponse.json({ error: 'Stop price must be positive' }, { status: 400 });
    }

    const client = await getT212Client(position.userId);

    // Check existing T212 stop before placing — enforce monotonic rule
    const pendingOrders = await client.getPendingOrders();
    const existingT212Stops = pendingOrders.filter(
      (o) => o.ticker === t212Ticker && o.type === 'STOP' && o.side === 'SELL'
    );
    const highestT212Stop = existingT212Stops.reduce(
      (max, o) => Math.max(max, o.stopPrice ?? 0),
      0
    );
    if (highestT212Stop > 0 && stopPrice < highestT212Stop) {
      return NextResponse.json(
        {
          error: `Monotonic rule: T212 already has a stop at ${highestT212Stop.toFixed(2)}. New stop (${stopPrice.toFixed(2)}) cannot be lower. Stops can only move UP.`,
          existingT212Stop: highestT212Stop,
        },
        { status: 400 }
      );
    }

    // Place or replace stop on T212
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
      return NextResponse.json(
        { error: error.message, code: 'T212_ERROR' },
        { status: error.statusCode === 429 ? 429 : 400 }
      );
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
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
      return NextResponse.json({ error: 'positionId is required' }, { status: 400 });
    }

    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { stock: true },
    });

    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    const t212Ticker = position.t212Ticker || position.stock.t212Ticker;
    if (!t212Ticker) {
      return NextResponse.json({ error: 'No T212 ticker mapped' }, { status: 400 });
    }

    const client = await getT212Client(position.userId);
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
      return NextResponse.json(
        { error: error.message, code: 'T212_ERROR' },
        { status: error.statusCode === 429 ? 429 : 400 }
      );
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * PUT — Bulk push all DB stops to Trading 212
 * For each open position with a T212 ticker:
 *   - Cancel existing T212 stop orders
 *   - Place a new stop at the DB's currentStop price
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let userId = body.userId;
    if (!userId) userId = await ensureDefaultUser();

    const client = await getT212Client(userId);

    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    const results: {
      ticker: string;
      t212Ticker: string;
      stopPrice: number;
      action: string;
      orderId?: number;
    }[] = [];

    for (const pos of positions) {
      const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker;
      if (!t212Ticker) {
        results.push({
          ticker: pos.stock.ticker,
          t212Ticker: '',
          stopPrice: pos.currentStop,
          action: 'SKIPPED_NO_T212_TICKER',
        });
        continue;
      }

      if (pos.currentStop <= 0) {
        results.push({
          ticker: pos.stock.ticker,
          t212Ticker,
          stopPrice: 0,
          action: 'SKIPPED_NO_STOP',
        });
        continue;
      }

      try {
        const order = await client.setStopLoss(t212Ticker, pos.shares, pos.currentStop);

        results.push({
          ticker: pos.stock.ticker,
          t212Ticker,
          stopPrice: pos.currentStop,
          action: 'PLACED',
          orderId: order?.id,
        });

        // Rate limit spacing — 2s between orders
        await new Promise((r) => setTimeout(r, 2000));
      } catch (error) {
        results.push({
          ticker: pos.stock.ticker,
          t212Ticker,
          stopPrice: pos.currentStop,
          action: `FAILED: ${(error as Error).message}`,
        });
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
      return NextResponse.json(
        { error: error.message, code: 'T212_ERROR' },
        { status: error.statusCode === 429 ? 429 : 400 }
      );
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
