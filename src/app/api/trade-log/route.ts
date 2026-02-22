import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    let userId = searchParams.get('userId');
    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const ticker = searchParams.get('ticker')?.trim();
    const decision = searchParams.get('decision')?.trim();
    const tradeType = searchParams.get('tradeType')?.trim();
    const regime = searchParams.get('regime')?.trim();
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'));
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 200), 1), 500);

    const logs = await prisma.tradeLog.findMany({
      where: {
        userId,
        ...(ticker ? { ticker: { contains: ticker } } : {}),
        ...(decision ? { decision } : {}),
        ...(tradeType ? { tradeType } : {}),
        ...(regime ? { regime } : {}),
        ...(from || to
          ? {
              tradeDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { tradeDate: 'desc' },
      take: limit,
    });

    // Trade log is append-only — cache for 2 minutes, serve stale for 1 min while revalidating
    return NextResponse.json({
      logs,
      count: logs.length,
    }, {
      headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('Trade log list error:', error);
    return apiError(500, 'TRADE_LOG_FETCH_FAILED', 'Failed to fetch trade logs', (error as Error).message, true);
  }
}
