import { NextRequest, NextResponse } from 'next/server';
import { updateStopLoss, generateStopRecommendations, StopLossError } from '@/lib/stop-manager';
import prisma from '@/lib/prisma';
import { getBatchPrices } from '@/lib/market-data';
import { apiError } from '@/lib/api-response';

export async function PUT(request: NextRequest) {
  try {
    const { positionId, newStop, reason } = await request.json();

    if (!positionId || newStop === undefined || !reason) {
      return apiError(400, 'INVALID_REQUEST', 'positionId, newStop, and reason are required');
    }

    await updateStopLoss(positionId, newStop, reason);

    return NextResponse.json({ success: true, message: 'Stop updated successfully' });
  } catch (error) {
    if (error instanceof StopLossError) {
      return apiError(400, 'STOP_MONOTONIC_VIOLATION', error.message);
    }
    console.error('Stop update error:', error);
    return apiError(500, 'STOP_UPDATE_FAILED', 'Failed to update stop', (error as Error).message, true);
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return apiError(400, 'INVALID_REQUEST', 'userId is required');
    }

    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    const tickers = positions.map((p) => p.stock.ticker);
    const livePrices = tickers.length > 0 ? await getBatchPrices(tickers) : {};
    const priceMap = new Map<string, number>(
      tickers.map((ticker) => [ticker, livePrices[ticker] || 0])
    );

    const recommendations = await generateStopRecommendations(userId, priceMap);

    return NextResponse.json(recommendations);
  } catch (error) {
    console.error('Stop recommendations error:', error);
    return apiError(500, 'STOP_RECOMMENDATIONS_FAILED', 'Failed to generate stop recommendations', (error as Error).message, true);
  }
}
