export const dynamic = 'force-dynamic';

/**
 * DEPENDENCIES
 * Consumed by: T212SyncPanel.tsx (portfolio page)
 * Consumes: trading212-dual.ts, prisma, default-user.ts, api-response.ts
 * Risk-sensitive: NO — only updates accountType metadata, not stops or sizing
 * Last modified: 2026-02-27
 * Notes: Fetches positions from BOTH T212 ISA and Invest accounts, matches to DB,
 *        and corrects accountType where T212 reality differs from DB.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { DualT212Client } from '@/lib/trading212-dual';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';

/**
 * POST — Sync account types for all open positions
 * 1. Fetches positions from both Invest + ISA accounts via DualT212Client
 * 2. Matches each T212 position to a DB record by t212Ticker or ticker
 * 3. Updates accountType where it doesn't match T212 reality
 * 4. Returns a summary of changes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let userId = body.userId;
    if (!userId) userId = await ensureDefaultUser();

    // Load user credentials
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
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Build dual client from credentials
    const investCreds = (user.t212Connected && user.t212ApiKey && user.t212ApiSecret)
      ? { apiKey: user.t212ApiKey, apiSecret: user.t212ApiSecret, environment: user.t212Environment as 'demo' | 'live' }
      : null;
    const isaCreds = (user.t212IsaConnected && user.t212IsaApiKey && user.t212IsaApiSecret)
      ? { apiKey: user.t212IsaApiKey, apiSecret: user.t212IsaApiSecret, environment: user.t212Environment as 'demo' | 'live' }
      : null;

    if (!investCreds && !isaCreds) {
      return apiError(400, 'NO_T212_ACCOUNTS', 'No Trading 212 accounts connected. Go to Settings to add your credentials.');
    }

    const dualClient = new DualT212Client(investCreds, isaCreds);
    const dualResult = await dualClient.fetchBothAccounts();

    // Get combined positions tagged with account type
    const t212Positions = dualClient.getCombinedPositions(dualResult);

    // Load all open DB positions
    const dbPositions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    // Match T212 positions to DB records and check accountType
    let updated = 0;
    let alreadyCorrect = 0;
    let notFound = 0;
    const details: Array<{
      ticker: string;
      t212Ticker: string;
      action: string;
      from?: string;
      to?: string;
    }> = [];

    for (const t212Pos of t212Positions) {
      // Match by t212Ticker first (most reliable), then fall back to mapped ticker
      const dbMatch = dbPositions.find((db) => {
        const dbT212 = db.t212Ticker || db.stock.t212Ticker;
        return dbT212 === t212Pos.fullTicker || db.stock.ticker === t212Pos.ticker;
      });

      if (!dbMatch) {
        notFound++;
        details.push({
          ticker: t212Pos.ticker,
          t212Ticker: t212Pos.fullTicker,
          action: 'NOT_IN_DB',
        });
        continue;
      }

      const currentAcctType = dbMatch.accountType || 'invest';
      if (currentAcctType === t212Pos.accountType) {
        alreadyCorrect++;
        details.push({
          ticker: t212Pos.ticker,
          t212Ticker: t212Pos.fullTicker,
          action: 'CORRECT',
        });
      } else {
        // Mismatch — update DB to match T212 reality
        await prisma.position.update({
          where: { id: dbMatch.id },
          data: { accountType: t212Pos.accountType },
        });
        updated++;
        details.push({
          ticker: t212Pos.ticker,
          t212Ticker: t212Pos.fullTicker,
          action: 'UPDATED',
          from: currentAcctType,
          to: t212Pos.accountType,
        });
        console.warn(
          `[Sync Account Types] ${t212Pos.ticker}: accountType corrected from '${currentAcctType}' to '${t212Pos.accountType}'`
        );
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        updated,
        alreadyCorrect,
        notFound,
        totalChecked: t212Positions.length,
      },
      details,
      errors: {
        ...(dualResult.errors.invest ? { invest: dualResult.errors.invest } : {}),
        ...(dualResult.errors.isa ? { isa: dualResult.errors.isa } : {}),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(500, 'SYNC_ACCOUNT_TYPES_FAILED', (error as Error).message, undefined, true);
  }
}
