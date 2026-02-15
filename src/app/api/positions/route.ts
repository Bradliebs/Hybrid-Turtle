import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { calculateRMultiple, calculateGainPercent, calculateGainDollars } from '@/lib/position-sizer';
import { getBatchPrices, getMarketRegime, normalizeBatchPricesToGBP } from '@/lib/market-data';
import { apiError } from '@/lib/api-response';
import { getCurrentWeeklyPhase } from '@/types';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const createPositionSchema = z.object({
  userId: z.string().trim().min(1),
  stockId: z.string().trim().min(1),
  entryPrice: z.coerce.number().positive(),
  entryDate: z.string().optional(),
  shares: z.coerce.number().positive(),
  stopLoss: z.coerce.number().positive(),
  atrAtEntry: z.coerce.number().positive().optional(),
  adxAtEntry: z.coerce.number().positive().optional(),
  scanStatus: z.string().optional(),
  bqsScore: z.coerce.number().optional(),
  fwsScore: z.coerce.number().optional(),
  ncsScore: z.coerce.number().optional(),
  dualScoreAction: z.string().optional(),
  rankScore: z.coerce.number().optional(),
  entryType: z.string().optional(),
  plannedEntry: z.coerce.number().positive().optional(),
  antiChaseTriggered: z.coerce.boolean().optional(),
  breadthRestricted: z.coerce.boolean().optional(),
  whipsawBlocked: z.coerce.boolean().optional(),
  climaxDetected: z.coerce.boolean().optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // OPEN | CLOSED | all
    const source = searchParams.get('source'); // manual | trading212 | all

    if (!userId) {
      return apiError(400, 'INVALID_REQUEST', 'userId is required');
    }

    const where: { userId: string; status?: string; source?: string } = { userId };
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

    // Count pyramid adds per position from TradeLog
    const addCounts = await prisma.tradeLog.groupBy({
      by: ['positionId'],
      where: { userId, tradeType: 'ADD', positionId: { not: null } },
      _count: { id: true },
    });
    const addsMap = new Map<string, number>();
    for (const row of addCounts) {
      if (row.positionId) addsMap.set(row.positionId, row._count.id);
    }

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
      const riskGBP = Math.max(0, (entryPriceGBP - stopGBP) * p.shares);

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
        pyramidAdds: addsMap.get(p.id) ?? 0,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Positions error:', error);
    return apiError(500, 'POSITIONS_FETCH_FAILED', 'Failed to fetch positions', (error as Error).message, true);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, createPositionSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const {
      userId,
      stockId,
      entryPrice,
      entryDate,
      shares,
      stopLoss,
      atrAtEntry,
      adxAtEntry,
      scanStatus,
      bqsScore,
      fwsScore,
      ncsScore,
      dualScoreAction,
      rankScore,
      entryType,
      plannedEntry,
      antiChaseTriggered,
      breadthRestricted,
      whipsawBlocked,
      climaxDetected,
      notes,
    } = parsed.data;

    // Hard pre-trade gates
    const phase = getCurrentWeeklyPhase();
    if (phase === 'OBSERVATION') {
      return apiError(400, 'PHASE_BLOCKED', 'New entries are blocked on Monday (OBSERVATION phase)');
    }

    const regime = await getMarketRegime();
    if (regime !== 'BULLISH') {
      return apiError(400, 'REGIME_BLOCKED', `New entries require BULLISH regime. Current regime: ${regime}`);
    }

    const latestHealth = await prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    });
    if (latestHealth?.overall === 'RED') {
      return apiError(400, 'HEALTH_BLOCKED', 'New entries are blocked while health status is RED');
    }

    // SAFETY: Stop-loss must be set before confirming trade
    if (stopLoss >= entryPrice) {
      return apiError(400, 'INVALID_STOP_LOSS', 'Stop-loss must be below entry price');
    }

    const initialRisk = entryPrice - stopLoss;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { riskProfile: true },
    });

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
        entry_price: entryPrice,
        initial_stop: stopLoss,
        initial_R: initialRisk,
        atr_at_entry: atrAtEntry,
        profile_used: user?.riskProfile,
        entry_type: entryType || 'BREAKOUT',
        protectionLevel: 'INITIAL',
        source: 'manual',
        notes,
      },
      include: { stock: true },
    });

    // Best-effort trade logging (never blocks entry creation)
    try {
      const ticker = position.stock.ticker;
      const stockCurrencies: Record<string, string | null> = {
        [ticker]: position.stock.currency,
      };

      const gbpPrices = await normalizeBatchPricesToGBP({ [ticker]: entryPrice }, stockCurrencies);
      const entryPriceGbp = gbpPrices[ticker] ?? entryPrice;
      const fxToGbp = entryPrice > 0 ? entryPriceGbp / entryPrice : 1;
      const actualFill = position.entryPrice;
      const effectivePlannedEntry = plannedEntry ?? null;

      await prisma.tradeLog.create({
        data: {
          userId,
          positionId: position.id,
          ticker,
          tradeDate: new Date(),
          tradeType: 'ENTRY',
          decision: 'TAKEN',
          entryPrice: actualFill,
          initialStop: position.initial_stop ?? position.stopLoss,
          initialR: position.initial_R ?? (actualFill - position.stopLoss),
          shares: position.shares,
          positionSizeGbp: position.shares * actualFill * fxToGbp,
          atrAtEntry: position.atr_at_entry ?? atrAtEntry ?? null,
          adxAtEntry: adxAtEntry ?? null,
          scanStatus: scanStatus ?? null,
          bqsScore: bqsScore ?? null,
          fwsScore: fwsScore ?? null,
          ncsScore: ncsScore ?? null,
          dualScoreAction: dualScoreAction ?? null,
          rankScore: rankScore ?? null,
          regime,
          plannedEntry: effectivePlannedEntry,
          actualFill,
          slippagePct:
            effectivePlannedEntry && actualFill
              ? ((actualFill - effectivePlannedEntry) / effectivePlannedEntry) * 100
              : null,
          fillTime: new Date(),
          antiChaseTriggered: antiChaseTriggered ?? false,
          breadthRestricted: breadthRestricted ?? false,
          whipsawBlocked: whipsawBlocked ?? false,
          climaxDetected: climaxDetected ?? false,
        },
      });
    } catch (logError) {
      const prismaCode = (logError as { code?: string })?.code;
      if (prismaCode === 'P2002') {
        console.warn('TradeLog duplicate skipped for position entry', {
          userId,
          stockId,
        });
      } else {
        console.warn('TradeLog create failed (non-blocking)', logError);
      }
    }

    return NextResponse.json(position, { status: 201 });
  } catch (error) {
    console.error('Create position error:', error);
    return apiError(500, 'POSITION_CREATE_FAILED', 'Failed to create position', (error as Error).message, true);
  }
}

/**
 * PATCH — Close / exit a position
 * Body: { positionId, exitPrice }
 */
export async function PATCH(request: NextRequest) {
  try {
    const { positionId, exitPrice, exitReason } = await request.json();

    if (!positionId || exitPrice === undefined) {
      return apiError(400, 'INVALID_REQUEST', 'positionId and exitPrice are required');
    }

    const position = await prisma.position.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      return apiError(404, 'POSITION_NOT_FOUND', 'Position not found');
    }

    if (position.status === 'CLOSED') {
      return apiError(400, 'POSITION_ALREADY_CLOSED', 'Position is already closed');
    }

    const resolvedExitReason =
      exitReason === 'STOP_HIT' || (typeof position.currentStop === 'number' && exitPrice <= position.currentStop)
        ? 'STOP_HIT'
        : (exitReason || 'MANUAL');

    const updated = await prisma.position.update({
      where: { id: positionId },
      data: {
        status: 'CLOSED',
        exitPrice,
        exitReason: resolvedExitReason,
        exitDate: new Date(),
      },
      include: { stock: true },
    });

    // Best-effort trade logging (never blocks close)
    try {
      const ticker = updated.stock.ticker;
      const stockCurrencies: Record<string, string | null> = {
        [ticker]: updated.stock.currency,
      };
      const gbpPrices = await normalizeBatchPricesToGBP({ [ticker]: exitPrice }, stockCurrencies);
      const exitPriceGbp = gbpPrices[ticker] ?? exitPrice;
      const fxToGbp = exitPrice > 0 ? exitPriceGbp / exitPrice : 1;
      const daysHeld = Math.floor((updated.exitDate!.getTime() - updated.entryDate.getTime()) / 86400000);
      const initialR = updated.initial_R ?? updated.initialRisk ?? null;
      const finalRMultiple = initialR ? (exitPrice - updated.entryPrice) / initialR : null;
      const tradeType = resolvedExitReason === 'STOP_HIT' ? 'STOP_HIT' : 'EXIT';

      await prisma.tradeLog.create({
        data: {
          userId: updated.userId,
          positionId: updated.id,
          ticker,
          tradeDate: new Date(),
          tradeType,
          decision: 'TAKEN',
          entryPrice: updated.entry_price ?? updated.entryPrice,
          initialStop: updated.initial_stop ?? updated.stopLoss,
          initialR,
          shares: updated.shares,
          exitPrice,
          exitReason: resolvedExitReason,
          finalRMultiple,
          gainLossGbp: (exitPrice - updated.entryPrice) * updated.shares * fxToGbp,
          daysHeld,
          atrAtEntry: updated.atr_at_entry,
        },
      });
    } catch (logError) {
      const prismaCode = (logError as { code?: string })?.code;
      if (prismaCode === 'P2002') {
        console.warn('TradeLog duplicate skipped for position close', { positionId });
      } else {
        console.warn('TradeLog create failed on close (non-blocking)', logError);
      }
    }

    return NextResponse.json({ success: true, position: updated });
  } catch (error) {
    console.error('Close position error:', error);
    return apiError(500, 'POSITION_CLOSE_FAILED', 'Failed to close position', (error as Error).message, true);
  }
}
