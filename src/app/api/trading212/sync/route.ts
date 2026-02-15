import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Trading212Client, mapT212Position, mapT212AccountSummary } from '@/lib/trading212';
import { ensureDefaultUser } from '@/lib/default-user';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const syncRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
});

// POST /api/trading212/sync — Sync positions from Trading 212
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, syncRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    let { userId } = parsed.data;

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    // Get user's Trading 212 credentials
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        t212ApiKey: true,
        t212ApiSecret: true,
        t212Environment: true,
        riskProfile: true,
      },
    });

    if (!user || !user.t212ApiKey || !user.t212ApiSecret) {
      return apiError(400, 'T212_NOT_CONFIGURED', 'Trading 212 API credentials not configured. Go to Settings to add them.');
    }

    // Create API client
    const client = new Trading212Client(
      user.t212ApiKey,
      user.t212ApiSecret,
      user.t212Environment as 'demo' | 'live'
    );

    // Fetch positions and account summary in parallel
    const [t212Positions, t212Account] = await Promise.all([
      client.getPositions(),
      client.getAccountSummary(),
    ]);

    const mappedPositions = t212Positions.map(mapT212Position);
    const accountData = mapT212AccountSummary(t212Account);

    // Sync positions to database
    const syncResults = {
      created: 0,
      updated: 0,
      closed: 0,
      errors: [] as string[],
    };

    // Get existing T212-sourced positions for this user
    const existingPositions = await prisma.position.findMany({
      where: { userId, source: 'trading212', status: 'OPEN' },
      include: { stock: true },
    });

    const existingTickerMap = new Map(
      existingPositions.map((p) => [p.t212Ticker || p.stock.ticker, p])
    );

    // Track which T212 tickers are still open
    const activeT212Tickers = new Set<string>();

    for (const pos of mappedPositions) {
      activeT212Tickers.add(pos.fullTicker);

      try {
        // Ensure stock exists in our database
        let stock = await prisma.stock.findUnique({
          where: { ticker: pos.ticker },
        });

        if (!stock) {
          stock = await prisma.stock.create({
            data: {
              ticker: pos.ticker,
              name: pos.name,
              sleeve: 'CORE', // Default — user can reclassify
            },
          });
        }

        const existing = existingTickerMap.get(pos.fullTicker);

        if (existing) {
          // Update existing position
          await prisma.position.update({
            where: { id: existing.id },
            data: {
              shares: pos.shares,
              entryPrice: pos.entryPrice,
              updatedAt: new Date(),
            },
          });
          syncResults.updated++;
        } else {
          // Create new position
          const initialRisk = pos.entryPrice * 0.05; // Default 5% stop-loss for synced positions
          const stopLoss = pos.entryPrice - initialRisk;

          await prisma.position.create({
            data: {
              userId,
              stockId: stock.id,
              status: 'OPEN',
              source: 'trading212',
              t212Ticker: pos.fullTicker,
              entryPrice: pos.entryPrice,
              entryDate: new Date(pos.entryDate),
              shares: pos.shares,
              stopLoss,
              initialRisk,
              currentStop: stopLoss,
              entry_price: pos.entryPrice,
              initial_stop: stopLoss,
              initial_R: initialRisk,
              atr_at_entry: null,
              profile_used: user.riskProfile,
              entry_type: 'BREAKOUT',
              protectionLevel: 'INITIAL',
              notes: `Synced from Trading 212. ISIN: ${pos.isin}`,
            },
          });
          syncResults.created++;
        }
      } catch (err) {
        syncResults.errors.push(`Error syncing ${pos.ticker}: ${(err as Error).message}`);
      }
    }

    // Mark positions as closed if they no longer exist on Trading 212
    const existingEntries = Array.from(existingTickerMap.entries());
    for (const [t212Ticker, existing] of existingEntries) {
      if (!activeT212Tickers.has(t212Ticker)) {
        await prisma.position.update({
          where: { id: existing.id },
          data: {
            status: 'CLOSED',
            exitDate: new Date(),
            exitReason: 'Closed on Trading 212',
          },
        });
        syncResults.closed++;
      }
    }

    // Update user's last sync time, equity, and cached account data
    await prisma.user.update({
      where: { id: userId },
      data: {
        t212Connected: true,
        t212LastSync: new Date(),
        t212AccountId: accountData.accountId.toString(),
        t212Currency: accountData.currency,
        equity: accountData.totalValue,
        t212Cash: accountData.cash,
        t212Invested: accountData.investmentsValue,
        t212UnrealisedPL: accountData.unrealizedPL,
        t212TotalValue: accountData.totalValue,
      },
    });

    await recordEquitySnapshot(userId, accountData.totalValue);

    return NextResponse.json({
      success: true,
      sync: syncResults,
      account: accountData,
      positions: mappedPositions,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Trading 212 sync error:', error);
    return apiError(500, 'T212_SYNC_FAILED', (error as Error).message || 'Failed to sync with Trading 212', undefined, true);
  }
}

// GET /api/trading212/sync — Get sync status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        t212Connected: true,
        t212LastSync: true,
        t212AccountId: true,
        t212Currency: true,
        t212Environment: true,
        t212Cash: true,
        t212Invested: true,
        t212UnrealisedPL: true,
        t212TotalValue: true,
      },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const t212PositionCount = await prisma.position.count({
      where: { userId, source: 'trading212', status: 'OPEN' },
    });

    return NextResponse.json({
      connected: user.t212Connected,
      lastSync: user.t212LastSync,
      accountId: user.t212AccountId,
      currency: user.t212Currency,
      environment: user.t212Environment,
      positionCount: t212PositionCount,
      account: {
        totalValue: user.t212TotalValue,
        cash: user.t212Cash,
        invested: user.t212Invested,
        unrealisedPL: user.t212UnrealisedPL,
      },
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return apiError(500, 'T212_SYNC_STATUS_FAILED', 'Failed to get sync status', (error as Error).message, true);
  }
}
