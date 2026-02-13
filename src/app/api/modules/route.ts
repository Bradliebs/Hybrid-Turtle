// ============================================================
// /api/modules — All 21 Python-Parity Module Checks
// ============================================================
// Runs all missing modules and returns a unified result object
// for the dashboard to consume.
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
import type { RiskProfileType, Sleeve, MarketRegime, ModuleStatus, AllModulesResult, FastFollowerSignal, ReEntrySignal, PyramidAlert } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');
    if (!userId) userId = await ensureDefaultUser();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { equity: true, riskProfile: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const riskProfile = user.riskProfile as RiskProfileType;
    const equity = user.equity;

    // ── Fetch positions ──
    const openPositions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });
    const closedPositions = await prisma.position.findMany({
      where: { userId, status: 'CLOSED' },
      include: { stock: true },
      orderBy: { exitDate: 'desc' },
      take: 50,
    });

    // ── Live prices ──
    const openTickers = openPositions.map(p => p.stock.ticker);
    const livePrices = openTickers.length > 0 ? await getBatchPrices(openTickers) : {};
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of openPositions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = openTickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};

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

    // ── Market regime ──
    const regime = await getMarketRegime();

    // ── Module 3: Laggard Purge ──
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

    // ── Module 5+14: Climax Signals ──
    const climaxSignals = await scanClimaxSignals(
      enrichedOpen.map(p => ({ id: p.id, ticker: p.ticker }))
    );

    // ── Module 7: Heat-Map Swap ──
    // Get scan candidates from DB (latest scan)
    const latestScan = await prisma.scan.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      include: { results: { include: { stock: true } } },
    });
    const scanCandidates = (latestScan?.results || [])
      .filter(r => r.status === 'READY')
      .map(r => ({
        ticker: r.stock.ticker,
        cluster: r.stock.cluster || 'General',
        rankScore: r.rankScore,
        status: r.status,
      }));

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
      totalPortfolioValue
    );

    // ── Module 8: Heat Check ──
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

    // ── Module 10: Breadth Safety ──
    let breadthPct = 100;
    try {
      const stocks = await prisma.stock.findMany({ where: { active: true }, select: { ticker: true } });
      const universeTickers = stocks.map(s => s.ticker);
      breadthPct = await calculateBreadth(universeTickers);
    } catch { /* default 100 */ }

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

    // ── Module 11: Whipsaw Kill Switch ──
    const whipsawBlocks = checkWhipsawBlocks(
      closedPositions.map(p => ({
        ticker: p.stock.ticker,
        exitDate: p.exitDate || new Date(),
        exitReason: p.exitReason,
        whipsawCount: (p as any).whipsawCount ?? 0,
      }))
    );

    // ── Module 12: Super-Cluster ──
    const superClusterResults = checkSuperClusterCaps(
      enrichedOpen.map(p => ({
        ticker: p.ticker,
        superCluster: p.superCluster,
        value: p.value,
        sleeve: p.sleeve,
      })),
      totalPortfolioValue
    );

    // ── Module 13: Momentum Expansion ──
    let spyAdx = 20;
    try {
      const spyBars = await getDailyPrices('SPY', 'compact');
      if (spyBars.length >= 28) {
        const adxResult = calculateADX(spyBars, 14);
        spyAdx = adxResult.adx;
      }
    } catch { /* default */ }
    const momentumExpansion = checkMomentumExpansion(spyAdx, riskProfile);

    // ── Module 9: Regime Stability ──
    let regimeHistoryRecords: { regime: string; date: Date }[] = [];
    try {
      const rh = await (prisma as any).regimeHistory?.findMany({
        orderBy: { date: 'desc' },
        take: 10,
      });
      if (rh) regimeHistoryRecords = rh.map((r: any) => ({ regime: r.regime, date: r.date }));
    } catch { /* table may not exist yet */ }
    const regimeStability = checkRegimeStability(regime, regimeHistoryRecords);

    // ── Module 19: Dual Benchmark ──
    let dualRegime;
    try {
      const spyBars = await getDailyPrices('SPY', 'full');
      const vwrlBars = await getDailyPrices('VWRL.L', 'full');
      if (spyBars.length >= 200 && vwrlBars.length >= 200) {
        const spyPrice = spyBars[0].close;
        const spyMa200 = calculateMA(spyBars.map(b => b.close), 200);
        const vwrlPrice = vwrlBars[0].close;
        const vwrlMa200 = calculateMA(vwrlBars.map(b => b.close), 200);
        dualRegime = detectDualRegime(spyPrice, spyMa200, vwrlPrice, vwrlMa200);
      }
    } catch { /* fallback */ }

    if (!dualRegime) {
      dualRegime = {
        spy: { regime: regime, price: 0, ma200: 0 },
        vwrl: { regime: 'SIDEWAYS' as MarketRegime, price: 0, ma200: 0 },
        combined: regime,
        chopDetected: false,
        consecutiveDays: 1,
      };
    }

    // ── Module 16: Turnover ──
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let tradeCount30d = 0;
    try {
      tradeCount30d = await (prisma as any).tradeLog?.count({
        where: { userId, createdAt: { gte: thirtyDaysAgo } },
      }) || 0;
    } catch { /* table may not exist yet */ }

    const turnover = calculateTurnover(
      [...openPositions, ...closedPositions].map(p => ({
        entryDate: p.entryDate,
        exitDate: p.exitDate,
        status: p.status,
      })),
      tradeCount30d
    );

    // ── Module 15: Recent Trades ──
    let recentTrades: any[] = [];
    try {
      recentTrades = await getTradeLog(userId, 10);
    } catch { /* table may not exist yet */ }

    // ── Module 9: Fast-Follower Re-Entry ──
    let fastFollowers: FastFollowerSignal[] = [];
    try {
      fastFollowers = await scanFastFollowers(
        closedPositions
          .filter(p => p.exitReason === 'STOP_HIT')
          .map(p => ({
            ticker: p.stock.ticker,
            exitDate: p.exitDate || new Date(),
            exitReason: p.exitReason,
          }))
      );
    } catch (e) {
      console.warn('[Modules] Fast-follower scan failed:', (e as Error).message);
    }

    // ── Module 20: Re-Entry Logic ──
    let reentrySignals: ReEntrySignal[] = [];
    try {
      reentrySignals = await scanReEntrySignals(
        closedPositions
          .filter(p => p.exitReason !== 'STOP_HIT' && p.exitProfitR && p.exitProfitR > 0.5)
          .map(p => ({
            ticker: p.stock.ticker,
            exitDate: p.exitDate || new Date(),
            exitProfitR: p.exitProfitR,
            exitReason: p.exitReason,
          }))
      );
    } catch (e) {
      console.warn('[Modules] Re-entry scan failed:', (e as Error).message);
    }

    // ── Stop recommendations for action card ──
    const stopRecs = await generateStopRecommendations(userId, new Map(
      Object.entries(livePrices)
    ));

    // ── Module 17: Weekly Action Card ──
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

    const actionCard = generateActionCard({
      regime,
      breadthPct,
      readyCandidates: scanCandidates.map(c => ({ ticker: c.ticker, status: c.status })),
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

    // ── Module 18: Data Validation (lightweight — just flag issues) ──
    const dataValidation = enrichedOpen
      .filter(p => p.currentPrice === p.entryPrice) // stale data indicator
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

    // ── Pyramid Add Alerts ──
    const pyramidAlerts: PyramidAlert[] = [];
    try {
      for (const p of enrichedOpen) {
        if (p.sleeve === 'HEDGE') continue;
        if (p.currentPrice <= p.entryPrice) continue;

        let atr: number | null = null;
        try {
          const bars = await getDailyPrices(p.ticker, 'compact');
          if (bars.length >= 15) {
            atr = calculateATR(bars, 14);
          }
        } catch { /* ATR unavailable */ }

        const isUK = p.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.ticker);
        const priceCurrency = isUK ? 'GBX' : 'USD';

        const pyramidCheck = canPyramid(
          p.currentPrice,
          p.entryPrice,
          p.initialRisk,
          atr ?? undefined,
          0
        );

        pyramidAlerts.push({
          ticker: p.ticker,
          positionId: p.id,
          entryPrice: p.entryPrice,
          currentPrice: p.currentPrice,
          initialRisk: p.initialRisk,
          atr,
          rMultiple: pyramidCheck.rMultiple,
          addsUsed: 0,
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

    return NextResponse.json(result);
  } catch (error) {
    console.error('Modules API error:', error);
    return NextResponse.json(
      { error: 'Failed to run module checks', message: (error as Error).message },
      { status: 500 }
    );
  }
}
