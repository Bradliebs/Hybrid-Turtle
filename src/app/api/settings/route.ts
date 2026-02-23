import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';

const settingsPutSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'SMALL_ACCOUNT', 'AGGRESSIVE']).optional(),
  equity: z.number().positive('Equity must be positive').optional(),
  marketDataProvider: z.enum(['yahoo', 'eodhd']).optional(),
  eodhApiKey: z.string().nullable().optional(),
});

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
        // Trading 212 Invest
        t212ApiKey: true,
        t212ApiSecret: true,
        t212Environment: true,
        t212Connected: true,
        t212AccountId: true,
        t212Currency: true,
        t212LastSync: true,
        // Trading 212 ISA
        t212IsaApiKey: true,
        t212IsaApiSecret: true,
        t212IsaConnected: true,
        t212IsaAccountId: true,
        t212IsaCurrency: true,
        t212IsaLastSync: true,
      },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Mask EODHD API key (only show last 4 chars)
    const maskedKey = user.eodhApiKey
      ? '****' + user.eodhApiKey.slice(-4)
      : null;

    // Mask T212 keys — show last 4 chars only
    const maskKey = (k: string | null) => k ? '****' + k.slice(-4) : null;

    // Settings change rarely — cache for 5 minutes, serve stale for 1 min while revalidating
    return NextResponse.json({
      ...user,
      eodhApiKey: maskedKey,
      eodhApiKeySet: !!user.eodhApiKey,
      // Replace raw keys with masked versions
      t212ApiKey: maskKey(user.t212ApiKey),
      t212ApiSecret: maskKey(user.t212ApiSecret),
      t212IsaApiKey: maskKey(user.t212IsaApiKey),
      t212IsaApiSecret: maskKey(user.t212IsaApiSecret),
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
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    const parsed = settingsPutSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(
        400,
        'INVALID_REQUEST',
        'Invalid settings payload',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
      );
    }

    const { riskProfile, equity, marketDataProvider, eodhApiKey } = parsed.data;
    const id = parsed.data.userId || 'default-user';

    const data: Record<string, unknown> = {};
    if (riskProfile) data.riskProfile = riskProfile;
    if (equity !== undefined) data.equity = equity;
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
