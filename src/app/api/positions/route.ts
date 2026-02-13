import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { calculateRMultiple, calculateGainPercent, calculateGainDollars } from '@/lib/position-sizer';
import { getBatchPrices, normalizeBatchPricesToGBP } from '@/lib/market-data';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // OPEN | CLOSED | all
    const source = searchParams.get('source'); // manual | trading212 | all

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const where: any = { userId };
    if (status && status !== 'all') {
      where.status = status;
    }
    if (source && source !== 'all') {
      where.source = source;
    }

    const positions = await prisma.position.findMany({
      where,
      include: {
        stock: true,
        stopHistory: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Fetch live prices from Yahoo Finance for all open positions
    const openTickers = positions
      .filter((p) => p.status === 'OPEN')
      .map((p) => p.stock.ticker);
    const livePrices = openTickers.length > 0
      ? await getBatchPrices(openTickers)
      : {};

    // Build currency map and normalize to GBP
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = openTickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};

    // Enrich with calculated fields using GBP-normalised prices
    const enriched = positions.map((p) => {
      const rawPrice = p.status === 'OPEN'
        ? (livePrices[p.stock.ticker] || p.entryPrice)
        : (p.exitPrice || p.entryPrice);

      // Determine the price currency this ticker trades in
      const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
      const priceCurrency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();

      // Current price in native currency (same as T212 / Yahoo raw)
      const currentPriceNative = p.status === 'OPEN' ? rawPrice : (p.exitPrice || p.entryPrice);

      // GBP-normalised prices for portfolio-level calculations only
      let currentPriceGBP: number;
      let entryPriceGBP = p.entryPrice;

      if (p.status === 'OPEN' && gbpPrices[p.stock.ticker] !== undefined) {
        currentPriceGBP = gbpPrices[p.stock.ticker];
        if (isUK) {
          entryPriceGBP = p.entryPrice / 100;
        } else if (priceCurrency !== 'GBP') {
          const fxRatio = rawPrice > 0 ? currentPriceGBP / rawPrice : 1;
          entryPriceGBP = p.entryPrice * fxRatio;
        }
      } else {
        currentPriceGBP = isUK ? rawPrice / 100 : rawPrice;
        if (isUK) entryPriceGBP = p.entryPrice / 100;
      }

      // Gain % uses raw prices (currency-independent)
      const gainPercent = calculateGainPercent(rawPrice, p.entryPrice);
      const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
      const gainDollars = currentPriceGBP * p.shares - entryPriceGBP * p.shares;
      const value = currentPriceGBP * p.shares;

      // Risk at stop in GBP (portfolio-level)
      const stopGBP = isUK ? (p.currentStop || 0) / 100
        : priceCurrency !== 'GBP'
          ? (p.currentStop || 0) * (rawPrice > 0 ? currentPriceGBP / rawPrice : 1)
          : (p.currentStop || 0);
      const riskGBP = (entryPriceGBP - stopGBP) * p.shares;

      return {
        ...p,
        // Per-ticker prices in NATIVE currency (matches T212 display)
        entryPrice: p.entryPrice,
        currentPrice: currentPriceNative,
        currentStop: p.currentStop || 0,
        stopLoss: p.stopLoss || 0,
        initialRisk: p.initialRisk || 0,
        priceCurrency,
        // Portfolio-level aggregates in GBP
        rMultiple,
        gainPercent,
        gainDollars,
        value,
        riskGBP,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Positions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch positions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userId,
      stockId,
      entryPrice,
      entryDate,
      shares,
      stopLoss,
      notes,
    } = body;

    if (!userId || !stockId || !entryPrice || !shares || !stopLoss) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, stockId, entryPrice, shares, stopLoss' },
        { status: 400 }
      );
    }

    // SAFETY: Stop-loss must be set before confirming trade
    if (stopLoss >= entryPrice) {
      return NextResponse.json(
        { error: 'Stop-loss must be below entry price' },
        { status: 400 }
      );
    }

    const initialRisk = entryPrice - stopLoss;

    const position = await prisma.position.create({
      data: {
        userId,
        stockId,
        entryPrice,
        entryDate: entryDate ? new Date(entryDate) : new Date(),
        shares,
        stopLoss,
        initialRisk,
        currentStop: stopLoss,
        protectionLevel: 'INITIAL',
        source: 'manual',
        notes,
      },
      include: { stock: true },
    });

    return NextResponse.json(position, { status: 201 });
  } catch (error) {
    console.error('Create position error:', error);
    return NextResponse.json(
      { error: 'Failed to create position', message: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * PATCH — Close / exit a position
 * Body: { positionId, exitPrice }
 */
export async function PATCH(request: NextRequest) {
  try {
    const { positionId, exitPrice } = await request.json();

    if (!positionId || exitPrice === undefined) {
      return NextResponse.json(
        { error: 'positionId and exitPrice are required' },
        { status: 400 }
      );
    }

    const position = await prisma.position.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    if (position.status === 'CLOSED') {
      return NextResponse.json({ error: 'Position is already closed' }, { status: 400 });
    }

    const updated = await prisma.position.update({
      where: { id: positionId },
      data: {
        status: 'CLOSED',
        exitPrice,
        exitDate: new Date(),
      },
      include: { stock: true },
    });

    return NextResponse.json({ success: true, position: updated });
  } catch (error) {
    console.error('Close position error:', error);
    return NextResponse.json(
      { error: 'Failed to close position', message: (error as Error).message },
      { status: 500 }
    );
  }
}
