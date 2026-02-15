// ============================================================
// /api/modules — All 21 Python-Parity Module Checks
// ============================================================
// Runs all missing modules and returns a unified result object
// for the dashboard to consume.
//
// PERF: Heavy external-API checks (breadth, climax, dual regime,
// fast followers, re-entry, SPY ADX, pyramid ATR) are parallelised
// via Promise.allSettled.  SPY 'full' data is fetched once and
// shared between ADX + dual-regime.  A 60 s server-side cache
// prevents duplicate work across rapid refreshes.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { getBatchPrices, getDailyPrices, calculateMA, calculateADX, calculateATR, getMarketRegime, normalizeBatchPricesToGBP } from '@/lib/market-data';
import { calculateRMultiple } from '@/lib/position-sizer';
import { getRiskBudget, canPyramid } from '@/lib/risk-gates';
import { generateStopRecommendations } from '@/lib/stop-manager';
import { detectDualRegime, checkRegimeStability } from '@/lib/regime-detector';
import {
  detectLaggards,
  scanClimaxSignals,
  findSwapSuggestions,
  runHeatCheck,
  checkWhipsawBlocks,
  calculateBreadth,
  checkBreadthSafety,
  checkSuperClusterCaps,
  checkMomentumExpansion,
  calculateTurnover,
  generateActionCard,
  getTradeLog,
  scanFastFollowers,
  scanReEntrySignals,
} from '@/lib/modules';
import type { RiskProfileType, Sleeve, MarketRegime, ModuleStatus, AllModulesResult, FastFollowerSignal, ReEntrySignal, PyramidAlert, TradeLogEntry } from '@/types';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// ── Server-side response cache (60 s TTL) ──
// Prevents duplicate heavy computation when multiple browser
// components trigger overlapping requests.
let _modulesCache: { json: AllModulesResult; expiry: number; userId: string } | null = null;
const MODULES_CACHE_TTL = 60_000; // 60 seconds

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');
    if (!userId) userId = await ensureDefaultUser();

    // Return cached response if fresh
    if (_modulesCache && _modulesCache.userId === userId && _modulesCache.expiry > Date.now()) {
      console.log(`[Modules] Cache hit — returning cached result (${Date.now() - t0}ms)`);
      return NextResponse.json(_modulesCache.json);
    }

    // ── Phase 1: DB lookups (parallelised) ──
    const t1 = Date.now();

    const [user, openPositions, closedPositions, latestScan, activeStocks] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { equity: true, riskProfile: true },
        }),
        prisma.position.findMany({
          where: { userId, status: 'OPEN' },
          include: { stock: true },
        }),
        prisma.position.findMany({
          where: { userId, status: 'CLOSED' },
          include: { stock: true },
          orderBy: { exitDate: 'desc' },
          take: 50,
        }),
        prisma.scan.findFirst({
          where: { userId },
          orderBy: { runDate: 'desc' },
          include: { results: { include: { stock: true } } },
        }),
        prisma.stock.findMany({ where: { active: true }, select: { ticker: true } }),
      ]);
    console.log(`[Modules] Phase 1 (DB lookups): ${Date.now() - t1}ms`);

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const riskProfile = user.riskProfile as RiskProfileType;
    const equity = user.equity;

    // ── Live prices ──
    const t2 = Date.now();
    const openTickers = openPositions.map(p => p.stock.ticker);
    const livePrices = openTickers.length > 0 ? await getBatchPrices(openTickers) : {};
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of openPositions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = openTickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};
    console.log(`[Modules] Phase 2 (live prices): ${Date.now() - t2}ms`);

    // ── Enrich positions ──
    const enrichedOpen = openPositions.map(p => {
      const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
      const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
      const currentStopGbp = p.currentStop * fxRatio;
      const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
      return {
        id: p.id,
        ticker: p.stock.ticker,
        name: p.stock.name,
        sleeve: p.stock.sleeve as Sleeve,
        sector: p.stock.sector || 'Unknown',
        cluster: p.stock.cluster || 'General',
        superCluster: p.stock.superCluster || null,
        entryPrice: p.entryPrice,
        entryDate: p.entryDate,
        currentPrice: rawPrice,
        currentStop: p.currentStop,
        shares: p.shares,
        initialRisk: p.initialRisk,
        rMultiple,
        value: gbpPrice * p.shares,
        riskDollars: Math.max(0, (gbpPrice - currentStopGbp) * p.shares),
        protectionLevel: p.protectionLevel,
      };
    });

    const totalPortfolioValue = enrichedOpen.reduce((s, p) => s + p.value, 0);

    // ── Sync CPU-only modules (no network) ──
    const laggards = detectLaggards(
      enrichedOpen.map(p => ({
        id: p.id,
        ticker: p.ticker,
        entryPrice: p.entryPrice,
        entryDate: p.entryDate,
        currentPrice: p.currentPrice,
        initialRisk: p.initialRisk,
        shares: p.shares,
      }))
    );

    const scanCandidates = (latestScan?.results || [])
      .filter(r => r.status === 'READY')
      .map(r => ({
        ticker: r.stock.ticker,
        cluster: r.stock.cluster || 'General',
        rankScore: r.rankScore,
        status: r.status,
      }));

    const heatChecks = runHeatCheck(
      enrichedOpen.map(p => ({
        ticker: p.ticker,
        cluster: p.cluster,
        rMultiple: p.rMultiple,
      })),
      scanCandidates.map(c => ({
        ticker: c.ticker,
        cluster: c.cluster,
        rankScore: c.rankScore,
      }))
    );

    const whipsawBlocks = checkWhipsawBlocks(
      closedPositions.map(p => ({
        ticker: p.stock.ticker,
        exitDate: p.exitDate || new Date(),
        exitReason: p.exitReason,
        whipsawCount: p.whipsawCount ?? 0,
      }))
    );

    const superClusterResults = checkSuperClusterCaps(
      enrichedOpen.map(p => ({
        ticker: p.ticker,
        superCluster: p.superCluster,
        value: p.value,
        sleeve: p.sleeve,
      })),
      totalPortfolioValue
    );

    // ── Phase 3: Heavy external-API checks — ALL IN PARALLEL ──
    // This is where the big speed win comes from: everything that
    // hits Yahoo Finance or does multi-ticker scans runs concurrently.
    const t3 = Date.now();

    const universeTickers = activeStocks.map(s => s.ticker);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      regimeResult,
      climaxResult,
      breadthResult,
      spyFullResult,
      vwrlResult,
      fastFollowerResult,
      reentryResult,
      stopRecsResult,
      regimeHistoryResult,
      tradeCount30dResult,
      recentTradesResult,
      pyramidAddsResult,
      triggerMetResult,
    ] = await Promise.allSettled([
      // 0: Market regime
      getMarketRegime(),
      // 1: Climax signals
      scanClimaxSignals(enrichedOpen.map(p => ({ id: p.id, ticker: p.ticker }))),
      // 2: Breadth
      calculateBreadth(universeTickers),
      // 3: SPY full (shared for ADX + dual regime)
      getDailyPrices('SPY', 'full'),
      // 4: VWRL full (for dual regime)
      getDailyPrices('VWRL.L', 'full'),
      // 5: Fast followers
      scanFastFollowers(
        closedPositions
          .filter(p => p.exitReason === 'STOP_HIT')
          .map(p => ({
            ticker: p.stock.ticker,
            exitDate: p.exitDate || new Date(),
            exitReason: p.exitReason,
          }))
      ),
      // 6: Re-entry signals
      scanReEntrySignals(
        closedPositions
          .filter(p => p.exitReason !== 'STOP_HIT' && p.exitProfitR && p.exitProfitR > 0.5)
          .map(p => ({
            ticker: p.stock.ticker,
            exitDate: p.exitDate || new Date(),
            exitProfitR: p.exitProfitR,
            exitReason: p.exitReason,
          }))
      ),
      // 7: Stop recommendations
      generateStopRecommendations(userId, new Map(Object.entries(livePrices))),
      // 8: Regime history
      (async () => {
        try {
          const rh: { regime: string; date: Date }[] | undefined = await (prisma as unknown as Record<string, { findMany: (opts: unknown) => Promise<{ regime: string; date: Date }[]> }>).regimeHistory?.findMany({
            orderBy: { date: 'desc' },
            take: 10,
          });
          return rh ? rh.map((r) => ({ regime: r.regime, date: r.date })) : [];
        } catch { return []; }
      })(),
      // 9: Trade count 30d
      (async () => {
        try {
          return await (prisma as unknown as Record<string, { count: (opts: unknown) => Promise<number> }>).tradeLog?.count({
            where: { userId, createdAt: { gte: thirtyDaysAgo } },
          }) || 0;
        } catch { return 0; }
      })(),
      // 10: Recent trades
      (async () => {
        try { return await getTradeLog(userId, 10); }
        catch { return [] as TradeLogEntry[]; }
      })(),
      // 11: Pyramid add counts
      (async () => {
        try {
          const rows = await prisma.tradeLog.groupBy({
            by: ['positionId'],
            where: { userId, tradeType: 'ADD', positionId: { not: null } },
            _count: { id: true },
          });
          const m = new Map<string, number>();
          for (const row of rows) { if (row.positionId) m.set(row.positionId, row._count.id); }
          return m;
        } catch { return new Map<string, number>(); }
      })(),
      // 12: Trigger-met candidates
      (async () => {
        try {
          const latestSnapshot = await prisma.snapshot.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          if (!latestSnapshot) return [];
          const heldTickers = new Set(enrichedOpen.map(p => p.ticker));
          const triggeredRows = await prisma.snapshotTicker.findMany({
            where: {
              snapshotId: latestSnapshot.id,
              status: { in: ['READY', 'WATCH'] },
            },
            orderBy: { distanceTo20dHighPct: 'asc' },
          });
          return triggeredRows
            .filter(r => !heldTickers.has(r.ticker) && r.close >= r.entryTrigger && r.entryTrigger > 0)
            .map(r => ({
              ticker: r.ticker,
              name: r.name || r.ticker,
              sleeve: r.sleeve || 'CORE',
              close: r.close,
              entryTrigger: r.entryTrigger,
              stopLevel: r.stopLevel,
              distancePct: ((r.close - r.entryTrigger) / r.entryTrigger) * 100,
              atr14: r.atr14,
              adx14: r.adx14,
              currency: r.currency || 'USD',
            }));
        } catch (error) {
          console.warn('[Modules] Trigger-met query failed:', (error as Error).message);
          return [];
        }
      })(),
    ]);

    console.log(`[Modules] Phase 3 (parallel heavy checks): ${Date.now() - t3}ms`);

    // ── Unpack results with safe defaults ──
    const regime = regimeResult.status === 'fulfilled' ? regimeResult.value : 'SIDEWAYS' as MarketRegime;
    const climaxSignals = climaxResult.status === 'fulfilled' ? climaxResult.value : [];
    const breadthPct = breadthResult.status === 'fulfilled' ? breadthResult.value : 100;
    const spyBars = spyFullResult.status === 'fulfilled' ? spyFullResult.value : [];
    const vwrlBars = vwrlResult.status === 'fulfilled' ? vwrlResult.value : [];
    const fastFollowers: FastFollowerSignal[] = fastFollowerResult.status === 'fulfilled' ? fastFollowerResult.value : [];
    const reentrySignals: ReEntrySignal[] = reentryResult.status === 'fulfilled' ? reentryResult.value : [];
    const stopRecs = stopRecsResult.status === 'fulfilled' ? stopRecsResult.value : [];
    const regimeHistoryRecords = regimeHistoryResult.status === 'fulfilled' ? regimeHistoryResult.value : [];
    const tradeCount30d = tradeCount30dResult.status === 'fulfilled' ? tradeCount30dResult.value : 0;
    const recentTrades: TradeLogEntry[] = recentTradesResult.status === 'fulfilled' ? recentTradesResult.value : [];
    const addsMap = pyramidAddsResult.status === 'fulfilled' ? pyramidAddsResult.value : new Map<string, number>();
    const triggerMetCandidates = triggerMetResult.status === 'fulfilled' ? triggerMetResult.value : [];

    if (fastFollowerResult.status === 'rejected') {
      console.warn('[Modules] Fast-follower scan failed:', fastFollowerResult.reason);
    }
    if (reentryResult.status === 'rejected') {
      console.warn('[Modules] Re-entry scan failed:', reentryResult.reason);
    }

    // ── SPY ADX (reuse spyBars fetched for dual regime) ──
    let spyAdx = 20;
    if (spyBars.length >= 28) {
      const adxResult = calculateADX(spyBars, 14);
      spyAdx = adxResult.adx;
    }
    const momentumExpansion = checkMomentumExpansion(spyAdx, riskProfile);

    // ── Regime Stability ──
    const regimeStability = checkRegimeStability(regime, regimeHistoryRecords);

    // ── Dual Benchmark (reuse spyBars) ──
    let dualRegime;
    if (spyBars.length >= 200 && vwrlBars.length >= 200) {
      const spyPrice = spyBars[0].close;
      const spyMa200 = calculateMA(spyBars.map(b => b.close), 200);
      const vwrlPrice = vwrlBars[0].close;
      const vwrlMa200 = calculateMA(vwrlBars.map(b => b.close), 200);
      dualRegime = detectDualRegime(spyPrice, spyMa200, vwrlPrice, vwrlMa200);
    }
    if (!dualRegime) {
      dualRegime = {
        spy: { regime: regime, price: 0, ma200: 0 },
        vwrl: { regime: 'SIDEWAYS' as MarketRegime, price: 0, ma200: 0 },
        combined: regime,
        chopDetected: false,
        consecutiveDays: 1,
      };
    }

    // ── Swap suggestions (needs regime) ──
    const swapSuggestions = findSwapSuggestions(
      enrichedOpen.map(p => ({
        id: p.id,
        ticker: p.ticker,
        cluster: p.cluster,
        sleeve: p.sleeve,
        value: p.value,
        rMultiple: p.rMultiple,
      })),
      scanCandidates,
      totalPortfolioValue,
      riskProfile
    );

    // ── Breadth Safety ──
    const { maxPositions } = getRiskBudget(
      enrichedOpen.map(p => ({
        id: p.id,
        ticker: p.ticker,
        sleeve: p.sleeve,
        sector: p.sector,
        cluster: p.cluster,
        value: p.value,
        riskDollars: p.riskDollars,
        shares: p.shares,
        entryPrice: p.entryPrice,
        currentStop: p.currentStop,
        currentPrice: p.currentPrice,
      })),
      equity,
      riskProfile
    );
    const breadthSafety = checkBreadthSafety(breadthPct, maxPositions);

    // ── Turnover ──
    const turnover = calculateTurnover(
      [...openPositions, ...closedPositions].map(p => ({
        entryDate: p.entryDate,
        exitDate: p.exitDate,
        status: p.status,
      })),
      tradeCount30d
    );

    // ── Risk budget for action card ──
    const budget = getRiskBudget(
      enrichedOpen.map(p => ({
        id: p.id,
        ticker: p.ticker,
        sleeve: p.sleeve,
        sector: p.sector,
        cluster: p.cluster,
        value: p.value,
        riskDollars: p.riskDollars,
        shares: p.shares,
        entryPrice: p.entryPrice,
        currentStop: p.currentStop,
        currentPrice: p.currentPrice,
      })),
      equity,
      riskProfile
    );
    const riskBudgetPct = budget.maxRiskPercent > 0
      ? (budget.usedRiskPercent / budget.maxRiskPercent) * 100
      : 0;
    const effectiveMaxPositions = breadthSafety.maxPositionsOverride || maxPositions;

    // ── Pyramid Alerts — parallelise ATR fetches ──
    const t4 = Date.now();
    const pyramidAlerts: PyramidAlert[] = [];
    try {
      const pyramidCandidates = enrichedOpen.filter(
        p => p.sleeve !== 'HEDGE' && p.currentPrice > p.entryPrice
      );

      // Fetch all ATRs in parallel
      const atrResults = await Promise.allSettled(
        pyramidCandidates.map(async (p) => {
          const bars = await getDailyPrices(p.ticker, 'compact');
          return bars.length >= 15 ? calculateATR(bars, 14) : null;
        })
      );

      for (let i = 0; i < pyramidCandidates.length; i++) {
        const p = pyramidCandidates[i];
        const atrResult = atrResults[i];
        const atr = atrResult.status === 'fulfilled' ? atrResult.value : null;
        const isUK = p.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.ticker);
        const priceCurrency = isUK ? 'GBX' : 'USD';
        const currentAdds = addsMap.get(p.id) ?? 0;
        const pyramidCheck = canPyramid(
          p.currentPrice,
          p.entryPrice,
          p.initialRisk,
          atr ?? undefined,
          currentAdds
        );

        pyramidAlerts.push({
          ticker: p.ticker,
          positionId: p.id,
          entryPrice: p.entryPrice,
          currentPrice: p.currentPrice,
          initialRisk: p.initialRisk,
          atr,
          rMultiple: pyramidCheck.rMultiple,
          addsUsed: currentAdds,
          maxAdds: 2,
          nextAddNumber: pyramidCheck.addNumber,
          triggerPrice: pyramidCheck.triggerPrice,
          allowed: pyramidCheck.allowed,
          message: pyramidCheck.message,
          priceCurrency,
        });
      }
    } catch (error) {
      console.warn('[Modules] Pyramid check failed:', (error as Error).message);
    }
    console.log(`[Modules] Phase 4 (pyramid ATRs): ${Date.now() - t4}ms`);

    // ── Action Card ──
    const actionCard = generateActionCard({
      regime,
      breadthPct,
      readyCandidates: scanCandidates.map(c => ({ ticker: c.ticker, status: c.status })),
      triggerMet: triggerMetCandidates,
      stopUpdates: stopRecs.map(r => ({ ticker: r.ticker, from: r.currentStop, to: r.newStop })),
      riskBudgetPct,
      laggards,
      climaxSignals,
      whipsawBlocks,
      swapSuggestions,
      fastFollowers,
      reentrySignals,
      maxPositions: effectiveMaxPositions,
    });

    // ── Data Validation ──
    const dataValidation = enrichedOpen
      .filter(p => p.currentPrice === p.entryPrice)
      .map(p => ({
        ticker: p.ticker,
        isValid: false,
        issues: ['Live price unavailable — using entry price as fallback'],
      }));

    // ── Module Statuses ──
    const moduleStatuses: ModuleStatus[] = [
      { id: 2, name: 'Early Bird Entry', status: regime === 'BULLISH' ? 'GREEN' : 'INACTIVE', summary: regime === 'BULLISH' ? 'Active — bullish regime' : 'Inactive — not bullish' },
      { id: 3, name: 'Laggard Purge', status: laggards.length > 0 ? 'YELLOW' : 'GREEN', summary: laggards.length > 0 ? `${laggards.length} laggard(s) flagged` : 'No laggards' },
      { id: 5, name: 'Climax Top Exit', status: climaxSignals.length > 0 ? 'RED' : 'GREEN', summary: climaxSignals.length > 0 ? `${climaxSignals.length} climax signal(s)` : 'No climax detected' },
      { id: 7, name: 'Heat-Map Swap', status: swapSuggestions.length > 0 ? 'YELLOW' : 'GREEN', summary: swapSuggestions.length > 0 ? `${swapSuggestions.length} swap(s) suggested` : 'No swaps needed' },
      { id: 8, name: 'Heat Check', status: heatChecks.some(h => h.blocked) ? 'RED' : 'GREEN', summary: heatChecks.some(h => h.blocked) ? 'Some entries blocked' : 'No concentration issues' },
      { id: 9, name: 'Fast-Follower Re-Entry', status: 'GREEN', summary: 'Monitoring recent exits' },
      { id: 10, name: 'Breadth Safety Valve', status: breadthSafety.isRestricted ? 'RED' : 'GREEN', summary: breadthSafety.reason },
      { id: 11, name: 'Whipsaw Kill Switch', status: whipsawBlocks.length > 0 ? 'RED' : 'GREEN', summary: whipsawBlocks.length > 0 ? `${whipsawBlocks.length} ticker(s) blocked` : 'No blocks active' },
      { id: 12, name: 'Super-Cluster Cap', status: superClusterResults.some(s => s.breached) ? 'RED' : 'GREEN', summary: superClusterResults.some(s => s.breached) ? 'Breach detected' : 'Within limits' },
      { id: 13, name: 'Momentum Expansion', status: momentumExpansion.isExpanded ? 'GREEN' : 'INACTIVE', summary: momentumExpansion.reason },
      { id: 14, name: 'Climax Trim/Tighten', status: climaxSignals.length > 0 ? 'YELLOW' : 'GREEN', summary: climaxSignals.length > 0 ? 'Action needed' : 'No action' },
      { id: 15, name: 'Trades Log', status: 'GREEN', summary: `${recentTrades.length} recent trades` },
      { id: 16, name: 'Turnover Monitor', status: turnover.avgHoldingPeriod < 5 ? 'YELLOW' : 'GREEN', summary: `Avg hold: ${turnover.avgHoldingPeriod}d, ${turnover.tradesLast30Days} trades/30d` },
      { id: 17, name: 'Weekly Action Card', status: 'GREEN', summary: 'Generated' },
      { id: 18, name: 'Data Validation', status: dataValidation.length > 0 ? 'YELLOW' : 'GREEN', summary: dataValidation.length > 0 ? `${dataValidation.length} ticker(s) with issues` : 'All data valid' },
      { id: 19, name: 'Dual Benchmark', status: dualRegime.chopDetected ? 'YELLOW' : 'GREEN', summary: `SPY: ${dualRegime.spy.regime} | VWRL: ${dualRegime.vwrl.regime}` },
      { id: 20, name: 'Re-Entry Logic', status: 'GREEN', summary: 'Monitoring exits' },
      { id: 21, name: 'Position Tracking', status: 'GREEN', summary: `${enrichedOpen.length} open, ${closedPositions.length} closed` },
      { id: 9.1, name: 'Regime Stability', status: regimeStability.isStable ? 'GREEN' : 'YELLOW', summary: regimeStability.reason },
    ];

    const result: AllModulesResult = {
      timestamp: new Date().toISOString(),
      earlyBirds: [], // These cost network calls — run on demand via scan
      laggards,
      climaxSignals,
      swapSuggestions,
      heatChecks: heatChecks.filter(h => h.blocked),
      fastFollowers,
      breadthSafety,
      whipsawBlocks,
      regimeStability,
      momentumExpansion,
      dualRegime,
      turnover,
      dataValidation,
      reentrySignals,
      pyramidAlerts,
      actionCard,
      moduleStatuses,
    };

    // Cache the result
    _modulesCache = { json: result, expiry: Date.now() + MODULES_CACHE_TTL, userId };

    console.log(`[Modules] Total request time: ${Date.now() - t0}ms`);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Modules API error:', error);
    return apiError(500, 'MODULES_RUN_FAILED', 'Failed to run module checks', (error as Error).message, true);
  }
}
