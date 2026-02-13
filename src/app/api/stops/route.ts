import { NextRequest, NextResponse } from 'next/server';
import { updateStopLoss, generateStopRecommendations, StopLossError } from '@/lib/stop-manager';
import prisma from '@/lib/prisma';
import { getBatchPrices } from '@/lib/market-data';

export async function PUT(request: NextRequest) {
  try {
    const { positionId, newStop, reason } = await request.json();

    if (!positionId || newStop === undefined || !reason) {
      return NextResponse.json(
        { error: 'positionId, newStop, and reason are required' },
        { status: 400 }
      );
    }

    await updateStopLoss(positionId, newStop, reason);

    return NextResponse.json({ success: true, message: 'Stop updated successfully' });
  } catch (error) {
    if (error instanceof StopLossError) {
      return NextResponse.json(
        { error: error.message, code: 'STOP_MONOTONIC_VIOLATION' },
        { status: 400 }
      );
    }
    console.error('Stop update error:', error);
    return NextResponse.json(
      { error: 'Failed to update stop', message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
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
    return NextResponse.json(
      { error: 'Failed to generate stop recommendations' },
      { status: 500 }
    );
  }
}
