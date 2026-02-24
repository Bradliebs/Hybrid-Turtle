export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runFullScan } from '@/lib/scan-engine';
import {
  clearScanCache,
  getScanCache,
  isScanCacheFresh,
  SCAN_CACHE_TTL_MS,
  setScanCache,
} from '@/lib/scan-cache';
import {
  ATR_VOLATILITY_CAP_ALL,
  ATR_VOLATILITY_CAP_HIGH_RISK,
  type RiskProfileType,
} from '@/types';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { normalizePersistedPassFlag } from '@/lib/scan-pass-flags';

const scanRequestSchema = z.object({
  userId: z.string().trim().min(1),
  riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'SMALL_ACCOUNT', 'AGGRESSIVE']),
  equity: z.coerce.number().positive(),
});

// ── POST: Run a fresh scan, persist to DB + cache in memory ─────────
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, scanRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { userId, riskProfile, equity } = parsed.data;

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
                entryMode: c.pullbackSignal?.triggered ? 'PULLBACK_CONTINUATION' : 'BREAKOUT',
                stage6Reason: c.pullbackSignal?.reason ?? c.antiChaseResult?.reason ?? null,
                passesRiskGates: c.passesRiskGates ?? null,
                passesAntiChase: c.passesAntiChase ?? null,
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
    return apiError(
      500,
      'SCAN_FAILED',
      'Scan failed',
      (error as Error).message,
      true
    );
  }
}

// ── GET: Return cached scan results, fallback to DB ─────────────────
export async function GET() {
  try {
    // Try in-memory cache first
    const cached = getScanCache();
    if (cached && isScanCacheFresh(cached)) {
      return NextResponse.json({ ...cached, hasCache: true, source: 'memory' });
    }
    if (cached && !isScanCacheFresh(cached)) {
      clearScanCache();
    }

    if (!process.env.DATABASE_URL) {
      return apiError(
        404,
        'SCAN_CACHE_MISS',
        'No fresh scan cache available',
        'Run Full Scan to generate fresh results.'
      );
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
      return apiError(
        404,
        'SCAN_CACHE_MISS',
        'No cached scan',
        'Click "Run Full Scan" to generate results. They will be persisted across restarts.'
      );
    }

    const latestScanAgeMs = Date.now() - latestScan.runDate.getTime();
    if (latestScanAgeMs > SCAN_CACHE_TTL_MS) {
      return apiError(
        404,
        'SCAN_CACHE_STALE',
        'Latest scan cache is stale',
        'Run Full Scan to refresh candidates.'
      );
    }

    // Reconstruct the scan result shape from DB rows
    const candidates = latestScan.results.map((r) => {
      const atrCap = r.stock.sleeve === 'HIGH_RISK'
        ? ATR_VOLATILITY_CAP_HIGH_RISK
        : ATR_VOLATILITY_CAP_ALL;

      return {
        id: r.stock.ticker,
        ticker: r.stock.ticker,
        yahooTicker: r.stock.yahooTicker || undefined,
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
        antiChaseResult: r.stage6Reason
          ? {
              passed: !r.stage6Reason.includes('WAIT_PULLBACK') && !r.stage6Reason.includes('CHASE RISK'),
              reason: r.stage6Reason,
            }
          : undefined,
        pullbackSignal: r.entryMode === 'PULLBACK_CONTINUATION'
          ? {
              triggered: true,
              mode: 'PULLBACK_CONTINUATION' as const,
              anchor: r.entryTrigger,
              zoneLow: r.entryTrigger,
              zoneHigh: r.entryTrigger,
              entryPrice: r.entryTrigger,
              stopPrice: r.stopPrice,
              reason: r.stage6Reason || 'PULLBACK_CONTINUATION',
            }
          : undefined,
        rankScore: r.rankScore,
        passesAllFilters: r.passesAllFilters,
        passesRiskGates: normalizePersistedPassFlag(r.passesRiskGates),
        passesAntiChase: normalizePersistedPassFlag(r.passesAntiChase),
        shares: r.shares,
        riskDollars: r.riskDollars,
        filterResults: {
          priceAboveMa200: r.price > r.ma200,
          adxAbove20: r.adx >= 20,
          plusDIAboveMinusDI: r.plusDI > r.minusDI,
          atrPercentBelow8: r.atrPercent < atrCap,
          efficiencyAbove30: r.efficiency >= 30,
          dataQuality: r.ma200 > 0 && r.adx > 0,
          passesAll: r.passesAllFilters,
          atrSpiking: false,
          atrSpikeAction: 'NONE' as const,
        },
      };
    });

    const passedFilters = candidates.filter((c) => c.passesAllFilters);

    // Look up actual user profile/equity so DB fallback uses real values
    const scanUser = await prisma.user.findUnique({
      where: { id: latestScan.userId },
      select: { riskProfile: true, equity: true },
    });

    const dbResult = {
      regime: latestScan.regime,
      candidates,
      readyCount: passedFilters.filter((c) => c.status === 'READY').length,
      watchCount: passedFilters.filter((c) => c.status === 'WATCH' || c.status === 'WAIT_PULLBACK').length,
      farCount: candidates.filter((c) => c.status === 'FAR').length,
      totalScanned: candidates.length,
      passedFilters: passedFilters.length,
      passedRiskGates: passedFilters.filter((c) => c.passesRiskGates === true).length,
      passedAntiChase: passedFilters.filter((c) => c.passesAntiChase === true).length,
      cachedAt: latestScan.runDate.toISOString(),
      userId: latestScan.userId,
      riskProfile: scanUser?.riskProfile || 'BALANCED',
      equity: scanUser?.equity || 0,
      hasCache: true,
      source: 'database',
    };

    // Re-populate the in-memory cache so subsequent GETs are fast
    setScanCache(dbResult);

    return NextResponse.json(dbResult);
  } catch (error) {
    console.error('Scan cache error:', error);
    return apiError(
      500,
      'SCAN_CACHE_ERROR',
      'Failed to retrieve scan data',
      (error as Error).message,
      true
    );
  }
}
