import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { apiError } from '@/lib/api-response';

// GET /api/settings?userId=default-user
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'default-user';

    await ensureDefaultUser();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        riskProfile: true,
        equity: true,
        marketDataProvider: true,
        eodhApiKey: true,
      },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Mask EODHD API key (only show last 4 chars)
    const maskedKey = user.eodhApiKey
      ? '****' + user.eodhApiKey.slice(-4)
      : null;

    // Settings change rarely — cache for 5 minutes, serve stale for 1 min while revalidating
    return NextResponse.json({
      ...user,
      eodhApiKey: maskedKey,
      eodhApiKeySet: !!user.eodhApiKey,
    }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return apiError(500, 'SETTINGS_FETCH_FAILED', 'Failed to fetch settings', (error as Error).message, true);
  }
}

// PUT /api/settings — save risk profile and equity
export async function PUT(request: NextRequest) {
  try {
    const { userId, riskProfile, equity, marketDataProvider, eodhApiKey } = await request.json();
    const id = userId || 'default-user';

    const validProfiles = ['CONSERVATIVE', 'BALANCED', 'SMALL_ACCOUNT', 'AGGRESSIVE'];
    if (riskProfile && !validProfiles.includes(riskProfile)) {
      return apiError(400, 'INVALID_RISK_PROFILE', 'Invalid risk profile');
    }

    // Validate market data provider
    const validProviders = ['yahoo', 'eodhd'];
    if (marketDataProvider && !validProviders.includes(marketDataProvider)) {
      return apiError(400, 'INVALID_PROVIDER', 'Invalid market data provider. Must be yahoo or eodhd.');
    }

    const data: Record<string, unknown> = {};
    if (riskProfile) data.riskProfile = riskProfile;
    if (equity !== undefined && equity > 0) data.equity = equity;
    if (marketDataProvider) data.marketDataProvider = marketDataProvider;
    // Only update eodhApiKey if explicitly provided (not the masked version)
    if (eodhApiKey !== undefined && eodhApiKey !== null && !eodhApiKey.startsWith('****')) {
      data.eodhApiKey = eodhApiKey || null;
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        riskProfile: true,
        equity: true,
        marketDataProvider: true,
      },
    });

    await recordEquitySnapshot(id, user.equity);

    return NextResponse.json(user);
  } catch (error) {
    console.error('PUT /api/settings error:', error);
    return apiError(500, 'SETTINGS_SAVE_FAILED', 'Failed to save settings', (error as Error).message, true);
  }
}
