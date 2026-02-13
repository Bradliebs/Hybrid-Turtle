import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBatchPrices, normalizeBatchPricesToGBP } from '@/lib/market-data';
import { calculateStopRecommendation } from '@/lib/stop-manager';
import type { ProtectionLevel } from '@/types';

/**
 * GET /api/positions/hedge
 * Returns all HEDGE sleeve positions with live prices, P&L, and stop guidance.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const positions = await prisma.position.findMany({
      where: {
        userId,
        status: 'OPEN',
        stock: { sleeve: 'HEDGE' },
      },
      include: {
        stock: true,
        stopHistory: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (positions.length === 0) {
      return NextResponse.json({ positions: [], totalValue: 0, totalPnl: 0 });
    }

    // Fetch live prices
    const tickers = positions.map((p) => p.stock.ticker);
    const livePrices = await getBatchPrices(tickers);

    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = await normalizeBatchPricesToGBP(livePrices, stockCurrencies);

    let totalValue = 0;
    let totalPnl = 0;

    const enriched = positions.map((p) => {
      const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const currentPriceGBP = gbpPrices[p.stock.ticker] ?? rawPrice;
      const shares = p.shares;

      // Determine native currency for display
      const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
      const priceCurrency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();

      // GBP values for portfolio aggregates
      let entryPriceGBP = p.entryPrice;
      if (isUK) {
        entryPriceGBP = p.entryPrice / 100;
      } else if (priceCurrency !== 'GBP') {
        const fxRatio = rawPrice > 0 ? currentPriceGBP / rawPrice : 1;
        entryPriceGBP = p.entryPrice * fxRatio;
      }

      const value = currentPriceGBP * shares;
      const pnl = (currentPriceGBP - entryPriceGBP) * shares;
      const pnlPercent = p.entryPrice > 0 ? ((rawPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
      // R-multiple uses raw native prices (currency-independent)
      const initialRisk = p.entryPrice - p.stopLoss;
      const rMultiple = initialRisk > 0 ? (rawPrice - p.entryPrice) / initialRisk : 0;
      const currentLevel = (p.protectionLevel || 'INITIAL') as ProtectionLevel;

      // Calculate stop guidance using native prices (currency-independent)
      const stopRec = initialRisk > 0
        ? calculateStopRecommendation(
            rawPrice,
            p.entryPrice,
            initialRisk,
            p.stopLoss,
            currentLevel
          )
        : null;

      totalValue += value;
      totalPnl += pnl;

      return {
        id: p.id,
        ticker: p.stock.ticker,
        name: p.stock.name || p.stock.ticker,
        entryPrice: p.entryPrice,
        currentPrice: rawPrice,
        stopLoss: p.stopLoss,
        priceCurrency,
        shares,
        value,
        pnl,
        pnlPercent,
        rMultiple,
        entryDate: p.entryDate,
        currency: p.stock.currency || 'GBP',
        protectionLevel: currentLevel,
        stopGuidance: stopRec
          ? {
              recommendedStop: stopRec.newStop,
              recommendedLevel: stopRec.newLevel,
              reason: stopRec.reason,
            }
          : null,
      };
    });

    return NextResponse.json({
      positions: enriched,
      totalValue,
      totalPnl,
      totalPnlPercent: totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0,
      count: enriched.length,
    });
  } catch (error) {
    console.error('[Hedge API]', error);
    return NextResponse.json(
      { error: 'Failed to fetch hedge positions' },
      { status: 500 }
    );
  }
}
