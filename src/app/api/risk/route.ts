import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { getBatchPrices, normalizeBatchPricesToGBP } from '@/lib/market-data';
import { calculateRMultiple } from '@/lib/position-sizer';
import { getRiskBudget } from '@/lib/risk-gates';
import { getWeeklyEquityChangePercent, recordEquitySnapshot } from '@/lib/equity-snapshot';
import type { RiskProfileType, Sleeve } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { equity: true, riskProfile: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
      orderBy: { updatedAt: 'desc' },
    });

    const tickers = positions.map((p) => p.stock.ticker);
    const livePrices = tickers.length > 0 ? await getBatchPrices(tickers) : {};
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = tickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};

    const enriched = positions.map((p) => {
      const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
      const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
      const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
      const initialStop = p.entryPrice - p.initialRisk;
      const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
      const priceCurrency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
      const currentStopGbp = p.currentStop * fxRatio;

      return {
        id: p.id,
        ticker: p.stock.ticker,
        sleeve: p.stock.sleeve as Sleeve,
        sector: p.stock.sector || 'Unassigned',
        cluster: p.stock.cluster || 'Unassigned',
        entryPrice: p.entryPrice,
        currentPrice: rawPrice,
        currentStop: p.currentStop,
        initialStop,
        shares: p.shares,
        rMultiple,
        protectionLevel: p.protectionLevel,
        value: gbpPrice * p.shares,
        riskDollars: Math.max(0, (gbpPrice - currentStopGbp) * p.shares),
        priceCurrency,
      };
    });

    const budget = getRiskBudget(
      enriched,
      user.equity,
      user.riskProfile as RiskProfileType
    );

    await recordEquitySnapshot(userId, user.equity, budget.usedRiskPercent);
    const efficiencyData = await getWeeklyEquityChangePercent(userId);
    const maxOpenRiskUsedPercent = efficiencyData.maxOpenRiskUsedPercent ?? budget.usedRiskPercent;
    const riskEfficiency = efficiencyData.weeklyChangePercent != null && maxOpenRiskUsedPercent > 0
      ? efficiencyData.weeklyChangePercent / maxOpenRiskUsedPercent
      : null;

    return NextResponse.json({
      riskProfile: user.riskProfile,
      equity: user.equity,
      budget,
      riskEfficiency,
      weeklyEquityChangePercent: efficiencyData.weeklyChangePercent,
      maxOpenRiskUsedPercent,
      positions: enriched,
    });
  } catch (error) {
    console.error('Risk summary error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch risk summary' },
      { status: 500 }
    );
  }
}
