import { NextRequest, NextResponse } from 'next/server';
import { runFullScan } from '@/lib/scan-engine';
import { getScanCache, setScanCache } from '@/lib/scan-cache';
import type { RiskProfileType } from '@/types';
import prisma from '@/lib/prisma';

// ── POST: Run a fresh scan, persist to DB + cache in memory ─────────
export async function POST(request: NextRequest) {
  try {
    const { userId, riskProfile, equity } = await request.json();

    if (!userId || !riskProfile || !equity) {
      return NextResponse.json(
        { error: 'userId, riskProfile, and equity are required' },
        { status: 400 }
      );
    }

    const result = await runFullScan(
      userId,
      riskProfile as RiskProfileType,
      equity
    );

    // ── Persist to database ──────────────────────────────────────────
    try {
      // Look up stockId for each candidate
      const allStocks = await prisma.stock.findMany({
        where: { active: true },
        select: { id: true, ticker: true },
      });
      const stockMap = new Map(allStocks.map((s) => [s.ticker, s.id]));

      const scan = await prisma.scan.create({
        data: {
          userId,
          regime: result.regime,
          results: {
            create: result.candidates
              .filter((c) => stockMap.has(c.ticker)) // only known tickers
              .map((c) => ({
                stockId: stockMap.get(c.ticker)!,
                price: c.price,
                ma200: c.technicals?.ma200 ?? 0,
                adx: c.technicals?.adx ?? 0,
                plusDI: c.technicals?.plusDI ?? 0,
                minusDI: c.technicals?.minusDI ?? 0,
                atrPercent: c.technicals?.atrPercent ?? 0,
                efficiency: c.technicals?.efficiency ?? 0,
                twentyDayHigh: c.technicals?.twentyDayHigh ?? 0,
                entryTrigger: c.entryTrigger,
                stopPrice: c.stopPrice,
                distancePercent: c.distancePercent,
                status: c.status,
                rankScore: c.rankScore,
                passesAllFilters: c.passesAllFilters,
                shares: c.shares ?? null,
                riskDollars: c.riskDollars ?? null,
              })),
          },
        },
      });
      console.log(`[Scan] Saved scan ${scan.id} with ${result.candidates.length} candidates to DB`);
    } catch (dbError) {
      console.warn('[Scan] Failed to persist scan to DB:', (dbError as Error).message);
      // Non-fatal — scan still returns results via cache
    }

    // Cache the result so GET can return it without re-scanning
    const cached = setScanCache({
      ...result,
      userId,
      riskProfile,
      equity,
    });

    return NextResponse.json({ ...result, cachedAt: cached.cachedAt });
  } catch (error) {
    console.error('Scan error:', error);
    return NextResponse.json(
      { error: 'Scan failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}

// ── GET: Return cached scan results, fallback to DB ─────────────────
export async function GET() {
  try {
    // Try in-memory cache first
    const cached = getScanCache();
    if (cached) {
      return NextResponse.json({ ...cached, hasCache: true, source: 'memory' });
    }

    // Fallback: load most recent scan from database
    const latestScan = await prisma.scan.findFirst({
      orderBy: { runDate: 'desc' },
      include: {
        results: {
          include: { stock: true },
          orderBy: { rankScore: 'desc' },
        },
      },
    });

    if (!latestScan || latestScan.results.length === 0) {
      return NextResponse.json(
        {
          error: 'No cached scan',
          message: 'Click "Run Full Scan" to generate results. They will be persisted across restarts.',
          hasCache: false,
        },
        { status: 404 }
      );
    }

    // Reconstruct the scan result shape from DB rows
    const candidates = latestScan.results.map((r) => ({
      id: r.stock.ticker,
      ticker: r.stock.ticker,
      name: r.stock.name,
      sleeve: r.stock.sleeve,
      sector: r.stock.sector || 'Unknown',
      cluster: r.stock.cluster || 'General',
      price: r.price,
      priceCurrency: r.stock.ticker.endsWith('.L') ? 'GBX' : (r.stock.currency || 'USD'),
      technicals: {
        ma200: r.ma200,
        adx: r.adx,
        plusDI: r.plusDI,
        minusDI: r.minusDI,
        atrPercent: r.atrPercent,
        efficiency: r.efficiency,
        twentyDayHigh: r.twentyDayHigh,
        atr: 0,
        volumeRatio: 1,
        relativeStrength: 0,
        atrSpiking: false,
      },
      entryTrigger: r.entryTrigger,
      stopPrice: r.stopPrice,
      distancePercent: r.distancePercent,
      status: r.status,
      rankScore: r.rankScore,
      passesAllFilters: r.passesAllFilters,
      passesRiskGates: true,
      passesAntiChase: true,
      shares: r.shares,
      riskDollars: r.riskDollars,
      filterResults: {
        priceAboveMa200: r.price > r.ma200,
        adxAbove20: r.adx >= 20,
        plusDIAboveMinusDI: r.plusDI > r.minusDI,
        atrPercentBelow8: r.atrPercent < 8,
        efficiencyAbove30: r.efficiency >= 30,
        dataQuality: r.ma200 > 0 && r.adx > 0,
        passesAll: r.passesAllFilters,
        atrSpiking: false,
        atrSpikeAction: 'NONE' as const,
      },
    }));

    const passedFilters = candidates.filter((c) => c.passesAllFilters);

    const dbResult = {
      regime: latestScan.regime,
      candidates,
      readyCount: passedFilters.filter((c) => c.status === 'READY').length,
      watchCount: passedFilters.filter((c) => c.status === 'WATCH').length,
      farCount: candidates.filter((c) => c.status === 'FAR').length,
      totalScanned: candidates.length,
      passedFilters: passedFilters.length,
      passedRiskGates: passedFilters.length,
      passedAntiChase: passedFilters.length,
      cachedAt: latestScan.runDate.toISOString(),
      userId: latestScan.userId,
      riskProfile: 'BALANCED',
      equity: 0,
      hasCache: true,
      source: 'database',
    };

    // Re-populate the in-memory cache so subsequent GETs are fast
    setScanCache(dbResult);

    return NextResponse.json(dbResult);
  } catch (error) {
    console.error('Scan cache error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve scan data', message: (error as Error).message },
      { status: 500 }
    );
  }
}
