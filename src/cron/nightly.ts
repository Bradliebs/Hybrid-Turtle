/**
 * DEPENDENCIES
 * Consumed by: nightly-task.bat
 * Consumes: health-check.ts, stop-manager.ts, telegram.ts, market-data.ts, equity-snapshot.ts, snapshot-sync.ts, laggard-detector.ts, modules/*, risk-gates.ts, position-sizer.ts, prisma.ts, @/types
 * Risk-sensitive: YES
 * Last modified: 2026-02-24
 * Notes: Nightly automation should continue on partial failures.
 */
/**
 * HybridTurtle Nightly Cron Job — Standalone
 *
 * Runs the full nightly process directly (no running dashboard needed).
 *
 * 9-Step Nightly Process:
 * 1. Run 16-point health check
 * 2. Fetch live prices for all open positions
 * 3. Generate stop-loss recommendations + trailing ATR stops
 * 4. Detect laggards / dead money
 * 5. Run risk-signal modules (climax, swap, whipsaw, breadth, momentum)
 * 6. Record equity snapshot + check pyramid opportunities
 * 7. Sync snapshot data from Yahoo Finance + query READY candidates
 * 8. Send Telegram summary
 * 9. Write heartbeat
 *
 * Usage:
 *   npx tsx src/cron/nightly.ts --run-now
 */

import prisma from '@/lib/prisma';
import { runHealthCheck } from '@/lib/health-check';
import { generateStopRecommendations, generateTrailingStopRecommendations, updateStopLoss } from '@/lib/stop-manager';
import { sendNightlySummary } from '@/lib/telegram';
import type { NightlyPositionDetail, NightlyStopChange, NightlyReadyCandidate, NightlyTriggerMetCandidate, NightlyLaggardAlert, NightlyClimaxAlert, NightlySwapAlert, NightlyWhipsawAlert, NightlyBreadthAlert, NightlyMomentumAlert, NightlyPyramidAlert, NightlyGapRiskAlert } from '@/lib/telegram';
import { getBatchPrices, getBatchQuotes, normalizeBatchPricesToGBP, getDailyPrices, calculateADX, calculateATR, calculateMA, preCacheHistoricalData } from '@/lib/market-data';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { syncSnapshot } from '@/lib/snapshot-sync';
import { detectLaggards } from '@/lib/laggard-detector';
import { scanClimaxSignals } from '@/lib/modules/climax-detector';
import { findSwapSuggestions } from '@/lib/modules/heatmap-swap';
import { checkWhipsawBlocks } from '@/lib/modules/whipsaw-guard';
import { calculateBreadth, checkBreadthSafety } from '@/lib/modules/breadth-safety';
// Module 13 disabled — import preserved for reference
// import { checkMomentumExpansion } from '@/lib/modules/momentum-expansion';
import { computeCorrelationMatrix } from '@/lib/correlation-matrix';
import { refreshSectorMomentumCache } from '@/lib/sector-etf-cache';
import { getRiskBudget, canPyramid } from '@/lib/risk-gates';
import { calculateRMultiple } from '@/lib/position-sizer';
import { sendAlert } from '@/lib/alert-service';
import type { RiskProfileType, Sleeve } from '@/types';

async function runNightlyProcess() {
  const userId = 'default-user';
  let hadFailure = false;

  console.log('========================================');
  console.log(`[HybridTurtle] Nightly process started at ${new Date().toISOString()}`);
  console.log('========================================');

  try {
    // Write RUNNING heartbeat so the dashboard knows we're active
    await prisma.heartbeat.create({
      data: { status: 'RUNNING', details: JSON.stringify({ startedAt: new Date().toISOString() }) },
    });
    console.log('  [---] RUNNING heartbeat written');

    // Step 0: Pre-cache historical data for all active tickers
    console.log('  [0/9] Pre-caching historical data for all active tickers...');
    try {
      const preCacheResult = await preCacheHistoricalData();
      console.log(`        ${preCacheResult.success}/${preCacheResult.total} tickers cached in ${(preCacheResult.durationMs / 1000).toFixed(1)}s`);
      if (preCacheResult.failed.length > 0) {
        console.warn(`        Failed: ${preCacheResult.failed.join(', ')}`);
      }
    } catch (error) {
      hadFailure = true;
      console.error('  [0] Pre-cache failed:', (error as Error).message);
    }

    // Step 1: Run health check (isolated — failure doesn't block other steps)
    console.log('  [1/9] Running health check...');
    let healthReport: { overall: string; checks: Record<string, string>; results: unknown[]; timestamp: Date } = {
      overall: 'YELLOW', checks: {}, results: [], timestamp: new Date(),
    };
    try {
      healthReport = await runHealthCheck(userId);
      console.log(`        Health: ${healthReport.overall}`);
    } catch (error) {
      hadFailure = true;
      console.error('  [1] Health check failed:', (error as Error).message);
    }

    // Step 2: Get open positions + fetch live prices
    console.log('  [2/9] Fetching positions and live prices...');
    let positions: Awaited<ReturnType<typeof prisma.position.findMany<{ include: { stock: true } }>>> = [];
    try {
      positions = await prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: true },
      });
    } catch (error) {
      hadFailure = true;
      console.error('  [2] Position fetch failed:', (error as Error).message);
    }

    const openTickers = positions.map((p) => p.stock.ticker);
    let livePrices: Record<string, number> = {};
    try {
      livePrices = openTickers.length > 0 ? await getBatchPrices(openTickers) : {};
    } catch (error) {
      hadFailure = true;
      console.error('  [2] Live price fetch failed:', (error as Error).message);
    }
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    let gbpPrices: Record<string, number> = {};
    try {
      gbpPrices = openTickers.length > 0
        ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
        : {};
    } catch (error) {
      hadFailure = true;
      // Fall back to raw prices so downstream steps can still run
      gbpPrices = { ...livePrices };
      console.error('  [2] FX normalisation failed, using raw prices as fallback:', (error as Error).message);
    }
    console.log(`        ${positions.length} positions, ${Object.keys(livePrices).length} prices fetched`);

    // Step 3: Generate stop recommendations (isolated)
    console.log('  [3/9] Generating stop recommendations...');
    const livePriceMap = new Map(Object.entries(livePrices));
    const stopChanges: NightlyStopChange[] = [];
    const atrMap = new Map<string, number>();
    let stopRecs: Awaited<ReturnType<typeof generateStopRecommendations>> = [];
    try {
      // Fetch daily bars in parallel batches — use 'full' so trailing stop (step 3b) gets cache hits
      const PRICE_BATCH = 10;
      for (let i = 0; i < openTickers.length; i += PRICE_BATCH) {
        const batch = openTickers.slice(i, i + PRICE_BATCH);
        await Promise.allSettled(
          batch.map(async (ticker) => {
            const bars = await getDailyPrices(ticker, 'full');
            if (bars.length >= 15) {
              atrMap.set(ticker, calculateATR(bars, 14));
            }
          })
        );
        if (i + PRICE_BATCH < openTickers.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      stopRecs = await generateStopRecommendations(userId, livePriceMap, atrMap);

      for (const rec of stopRecs) {
        const pos = positions.find((p) => p.id === rec.positionId);
        const isUK = rec.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(rec.ticker);
        const cur = isUK ? 'GBX' : (pos?.stock.currency || 'USD').toUpperCase();
        try {
          await updateStopLoss(rec.positionId, rec.newStop, rec.reason, rec.newLevel);
          stopChanges.push({
            ticker: rec.ticker,
            oldStop: rec.currentStop,
            newStop: rec.newStop,
            level: rec.newLevel,
            reason: rec.reason,
            currency: cur,
          });
        } catch {
          // Monotonic violation or other error — skip silently
        }
      }
    } catch (error) {
      hadFailure = true;
      console.error('  [3] R-based stop recommendations failed:', (error as Error).message);
    }

    // Step 3b: Trailing ATR stops
    const trailingStopChanges: NightlyStopChange[] = [];
    try {
      const trailingRecs = await generateTrailingStopRecommendations(userId);
      for (const rec of trailingRecs) {
        try {
          await updateStopLoss(rec.positionId, rec.trailingStop, rec.reason);
          trailingStopChanges.push({
            ticker: rec.ticker,
            oldStop: rec.currentStop,
            newStop: rec.trailingStop,
            level: 'TRAILING_ATR',
            reason: rec.reason,
            currency: rec.priceCurrency,
          });
        } catch {
          // Stop might violate monotonic rule — skip silently
        }
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [3b] Trailing stop calculation failed:', (error as Error).message);
    }
    console.log(`        ${stopRecs.length} R-based, ${trailingStopChanges.length} trailing ATR`);

    // Step 3c: Gap Risk detection for HIGH_RISK positions (advisory only)
    const gapRiskAlerts: NightlyGapRiskAlert[] = [];
    try {
      const highRiskPositions = positions.filter((p) => p.stock.sleeve === 'HIGH_RISK');
      if (highRiskPositions.length > 0) {
        const hrTickers = highRiskPositions.map((p) => p.stock.ticker);
        // getBatchQuotes hits cache populated by step 2's getBatchPrices
        const quotes = await getBatchQuotes(hrTickers);
        for (const pos of highRiskPositions) {
          const quote = quotes.get(pos.stock.ticker);
          const atr = atrMap.get(pos.stock.ticker);
          if (!quote || !atr || quote.previousClose <= 0) continue;
          const gapPercent = ((quote.open - quote.previousClose) / quote.previousClose) * 100;
          const atrPercent = (atr / quote.previousClose) * 100;
          const threshold = atrPercent * 2;
          // Flag if absolute gap exceeds 2× ATR%
          if (Math.abs(gapPercent) > threshold) {
            const isUK = pos.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(pos.stock.ticker);
            const currency = isUK ? 'GBX' : (pos.stock.currency || 'USD').toUpperCase();
            gapRiskAlerts.push({ ticker: pos.stock.ticker, gapPercent, atrPercent, threshold, currency });
          }
        }
      }
    } catch (error) {
      console.warn('  [3c] Gap risk detection failed:', (error as Error).message);
    }
    console.log(`        Gap risk: ${gapRiskAlerts.length} flagged`);

    // Step 3d: Stop-hit detection — alert if any position price <= currentStop
    const stopHitPositions: Array<{ ticker: string; name: string; currentStop: number; currentPrice: number; currency: string }> = [];
    try {
      for (const p of positions) {
        const currentPrice = livePrices[p.stock.ticker];
        if (!currentPrice || currentPrice <= 0) continue;
        if (currentPrice <= p.currentStop) {
          const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
          const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
          stopHitPositions.push({
            ticker: p.stock.ticker,
            name: p.stock.name || p.stock.ticker,
            currentStop: p.currentStop,
            currentPrice,
            currency,
          });
        }
      }
      // Send stop-hit alerts (any day of the week)
      for (const hit of stopHitPositions) {
        const currSymbol = hit.currency === 'GBP' || hit.currency === 'GBX' ? '£' : hit.currency === 'EUR' ? '€' : '$';
        await sendAlert({
          type: 'STOP_HIT',
          title: `⚠ Action needed — ${hit.ticker} may have hit its stop`,
          message: `${hit.name} (${hit.ticker}) has fallen to or below your stop-loss level.\n\nStop price: ${currSymbol}${hit.currentStop.toFixed(2)}\nCurrent price: ${currSymbol}${hit.currentPrice.toFixed(2)}\n\nCheck Trading 212 and confirm whether the position has been closed. If not, close it manually now.`,
          data: { ticker: hit.ticker, currentStop: hit.currentStop, currentPrice: hit.currentPrice },
          priority: 'WARNING',
        });
      }
      if (stopHitPositions.length > 0) {
        alerts.push(`🔴 ${stopHitPositions.length} position(s) hit stop-loss — check Trading 212`);
      }
    } catch (error) {
      console.warn('  [3d] Stop-hit detection failed:', (error as Error).message);
    }
    console.log(`        Stop hits: ${stopHitPositions.length} detected`);

    // Step 4: Detect laggards + collect alerts
    console.log('  [4/9] Detecting laggards...');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const equity = user?.equity || 0;

    const alerts: string[] = [];
    if (healthReport.overall === 'RED') alerts.push('Health check is RED — review issues before trading');
    if (healthReport.overall === 'YELLOW') alerts.push('Health check has warnings');
    if (stopChanges.length > 0) alerts.push(`${stopChanges.length} R-based stop-loss updates auto-applied`);
    if (trailingStopChanges.length > 0) alerts.push(`${trailingStopChanges.length} trailing ATR stops auto-applied`);
    if (gapRiskAlerts.length > 0) alerts.push(`${gapRiskAlerts.length} HIGH_RISK position(s) with overnight gap > 2× ATR%`);

    let laggardAlerts: NightlyLaggardAlert[] = [];
    try {
      // Pre-compute MA20 + ADX (today vs yesterday) from cached daily bars
      // getDailyPrices hits cache here — bars were fetched in Step 3
      const laggardExtras = new Map<string, { ma20: number; adxToday: number; adxYesterday: number }>();
      for (const p of positions) {
        try {
          const bars = await getDailyPrices(p.stock.ticker, 'full');
          if (bars.length >= 29) {
            // MA20 from newest-first close prices
            const closes = bars.map(b => b.close);
            const ma20 = calculateMA(closes, 20);
            // ADX today (full bars) vs yesterday (exclude today's bar)
            const adxToday = calculateADX(bars, 14).adx;
            const adxYesterday = calculateADX(bars.slice(1), 14).adx;
            laggardExtras.set(p.stock.ticker, { ma20, adxToday, adxYesterday });
          }
        } catch {
          // Non-critical — recovery exemption just won't activate for this ticker
        }
      }

      const laggardInput = positions.map((p) => {
        const currentPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
        const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
        const extras = laggardExtras.get(p.stock.ticker);
        return {
          id: p.id,
          ticker: p.stock.ticker,
          entryPrice: p.entryPrice,
          entryDate: p.entryDate,
          currentStop: p.currentStop,
          shares: p.shares,
          initialRisk: p.initialRisk,
          currentPrice,
          currency,
          sleeve: p.stock.sleeve,
          // Recovery exemption fields — computed from cached daily bars
          ...(extras ? { ma20: extras.ma20, adxToday: extras.adxToday, adxYesterday: extras.adxYesterday } : {}),
        };
      });
      const laggards = detectLaggards(laggardInput);
      laggardAlerts = laggards.map((l) => ({
        ticker: l.ticker,
        daysHeld: l.daysHeld,
        rMultiple: l.rMultiple,
        lossPct: l.lossPct,
        flag: l.flag,
        reason: l.reason,
        currency: l.currency,
      }));
      if (laggardAlerts.length > 0) {
        const trimCount = laggardAlerts.filter((l) => l.flag === 'TRIM_LAGGARD').length;
        const deadCount = laggardAlerts.filter((l) => l.flag === 'DEAD_MONEY').length;
        const parts: string[] = [];
        if (trimCount > 0) parts.push(`${trimCount} laggard(s)`);
        if (deadCount > 0) parts.push(`${deadCount} dead-money`);
        alerts.push(`${parts.join(' + ')} flagged for review`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [4] Laggard detection failed:', (error as Error).message);
    }
    console.log(`        ${laggardAlerts.length} laggards flagged`);

    // Step 5: Risk-signal modules
    console.log('  [5/9] Running risk-signal modules...');
    let climaxAlerts: NightlyClimaxAlert[] = [];
    let swapAlerts: NightlySwapAlert[] = [];
    let whipsawAlerts: NightlyWhipsawAlert[] = [];
    let breadthAlert: NightlyBreadthAlert | undefined;
    let momentumAlert: NightlyMomentumAlert | undefined;

    try {
      const climaxSignals = await scanClimaxSignals(
        positions.map((p) => ({ id: p.id, ticker: p.stock.ticker }))
      );
      climaxAlerts = climaxSignals.map((c) => ({
        ticker: c.ticker,
        priceAboveMa20Pct: c.priceAboveMa20Pct,
        volumeRatio: c.volumeRatio,
        action: c.action,
        reason: c.reason,
      }));
      if (climaxAlerts.length > 0) {
        alerts.push(`${climaxAlerts.length} climax top signal(s) — consider trimming`);
      }
    } catch (error) {
      console.warn('  [5] Climax detection failed:', (error as Error).message);
    }

    // Shared data for risk modules — computed once, used by swap/whipsaw/breadth/momentum
    const riskProfile = (user?.riskProfile || 'BALANCED') as RiskProfileType;
    const enrichedForSwap = positions.map((p) => {
      const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
      const rMultiple = calculateRMultiple(rawPrice, p.entryPrice, p.initialRisk);
      return {
        id: p.id,
        ticker: p.stock.ticker,
        cluster: p.stock.cluster || 'General',
        sleeve: p.stock.sleeve as Sleeve,
        value: gbpPrice * p.shares,
        rMultiple,
      };
    });
    const totalPortfolioValue = enrichedForSwap.reduce((s, p) => s + p.value, 0);

    // Swap suggestions (isolated)
    try {
      const latestScan = await prisma.scan.findFirst({
        where: { userId },
        orderBy: { runDate: 'desc' },
        include: { results: { include: { stock: true } } },
      });
      const scanCandidates = (latestScan?.results || [])
        .filter((r) => r.status === 'READY')
        .map((r) => ({
          ticker: r.stock.ticker,
          cluster: r.stock.cluster || 'General',
          rankScore: r.rankScore,
          status: r.status,
        }));

      const swaps = findSwapSuggestions(enrichedForSwap, scanCandidates, totalPortfolioValue, riskProfile);
      swapAlerts = swaps.map((s) => ({
        cluster: s.cluster,
        weakTicker: s.weakTicker,
        weakRMultiple: s.weakRMultiple,
        strongTicker: s.strongTicker,
        reason: s.reason,
      }));
      if (swapAlerts.length > 0) {
        alerts.push(`${swapAlerts.length} swap suggestion(s) — stronger candidates available`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [5] Swap suggestions failed:', (error as Error).message);
    }

    // Whipsaw kill switch (isolated)
    try {
      const closedPositions = await prisma.position.findMany({
        where: { userId, status: 'CLOSED' },
        include: { stock: true },
        orderBy: { exitDate: 'desc' },
        take: 50,
      });
      const blocks = checkWhipsawBlocks(
        closedPositions.map((p) => ({
          ticker: p.stock.ticker,
          exitDate: p.exitDate || new Date(),
          exitReason: p.exitReason,
          whipsawCount: p.whipsawCount ?? 0,
        }))
      );
      whipsawAlerts = blocks.map((w) => ({
        ticker: w.ticker,
        stopsInLast30Days: w.stopsInLast30Days,
        reason: w.reason,
      }));
      if (whipsawAlerts.length > 0) {
        alerts.push(`${whipsawAlerts.length} ticker(s) blocked by whipsaw kill switch`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [5] Whipsaw check failed:', (error as Error).message);
    }

    // Breadth safety (isolated)
    try {
      const stocks = await prisma.stock.findMany({ where: { active: true }, select: { ticker: true } });
      const universeTickers = stocks.map((s) => s.ticker);
      // Sample up to 30 tickers for breadth — avoids 266 sequential Yahoo calls
      const sampleSize = Math.min(30, universeTickers.length);
      const shuffled = [...universeTickers].sort(() => Math.random() - 0.5);
      const breadthSample = shuffled.slice(0, sampleSize);
      console.log(`        Breadth sample: ${breadthSample.length} of ${universeTickers.length} tickers`);
      const breadthPct = breadthSample.length > 0 ? await calculateBreadth(breadthSample) : 100;

      const { maxPositions } = getRiskBudget(
        enrichedForSwap.map((p) => ({
          id: p.id,
          ticker: p.ticker,
          sleeve: p.sleeve,
          sector: 'Unknown',
          cluster: p.cluster,
          value: p.value,
          riskDollars: 0,
          shares: 0,
          entryPrice: 0,
          currentStop: 0,
          currentPrice: 0,
        })),
        equity,
        riskProfile
      );
      const breadthResult = checkBreadthSafety(breadthPct, maxPositions);
      breadthAlert = {
        breadthPct: breadthResult.breadthPct,
        isRestricted: breadthResult.isRestricted,
        maxPositionsOverride: breadthResult.maxPositionsOverride,
        reason: breadthResult.reason,
      };
      if (breadthResult.isRestricted) {
        alerts.push(`Breadth ${breadthPct.toFixed(0)}% < 40% — max positions reduced to ${breadthResult.maxPositionsOverride}`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [5] Breadth safety failed:', (error as Error).message);
    }

    // Momentum expansion — DISABLED: procyclical risk expansion, adds risk near end of moves not middle
    // Module 13 permanently disabled. Code preserved but skipped.
    console.log('  [5] Module 13 (Momentum Expansion) — DISABLED, skipping');

    // Correlation matrix (isolated — advisory only, no hard blocks)
    let correlationPairCount = 0;
    try {
      const corrResult = await computeCorrelationMatrix();
      correlationPairCount = corrResult.pairs.length;
      if (corrResult.pairs.length > 0) {
        alerts.push(`${corrResult.pairs.length} HIGH_CORR pair(s) detected (r > 0.75)`);
      }
      if (corrResult.tickersFailed.length > 0) {
        console.warn(`        Correlation: ${corrResult.tickersFailed.length} tickers failed data fetch`);
      }
    } catch (error) {
      // Non-critical — log and continue
      console.warn('  [5] Correlation matrix failed:', (error as Error).message);
    }
    console.log(`        Climax: ${climaxAlerts.length}, Swap: ${swapAlerts.length}, Whipsaw: ${whipsawAlerts.length}, Corr pairs: ${correlationPairCount}`);

    // Sector ETF momentum cache refresh (non-blocking — BPS factor 4 data)
    try {
      const sectorResult = await refreshSectorMomentumCache();
      console.log(`        Sector ETF cache: ${sectorResult.cached} sectors cached, ${sectorResult.failed.length} failed`);
    } catch (error) {
      // Non-critical — BPS sector factor returns 0 on cache miss
      console.warn('  [5] Sector ETF cache refresh failed:', (error as Error).message);
    }

    // Step 6: Record equity snapshot + check pyramids
    console.log('  [6/9] Recording equity snapshot...');
    let openRiskPercent = 0;
    try {
      const openRisk = positions
        .filter((p) => p.stock.sleeve !== 'HEDGE')
        .reduce((sum, p) => {
          const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
          const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
          const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
          const currentStopGbp = p.currentStop * fxRatio;
          const risk = Math.max(0, (gbpPrice - currentStopGbp) * p.shares);
          return sum + risk;
        }, 0);
      openRiskPercent = equity > 0 ? (openRisk / equity) * 100 : 0;
      await recordEquitySnapshot(userId, equity, openRiskPercent);
    } catch {
      hadFailure = true;
      await recordEquitySnapshot(userId, equity);
    }

    let pyramidAlerts: NightlyPyramidAlert[] = [];
    try {
      // Count existing pyramid adds per position from TradeLog
      const addCounts = await prisma.tradeLog.groupBy({
        by: ['positionId'],
        where: { userId, tradeType: 'ADD', positionId: { not: null } },
        _count: { id: true },
      });
      const addsMap = new Map<string, number>();
      for (const row of addCounts) {
        if (row.positionId) addsMap.set(row.positionId, row._count.id);
      }

      for (const p of positions) {
        if (p.stock.sleeve === 'HEDGE') continue;
        const currentPrice = livePrices[p.stock.ticker] || p.entryPrice;
        if (currentPrice <= p.entryPrice) continue;

        let atr: number | null = null;
        try {
          const bars = await getDailyPrices(p.stock.ticker, 'compact');
          if (bars.length >= 15) {
            atr = calculateATR(bars, 14);
          }
        } catch { /* ATR unavailable */ }

        const pyramidCheck = canPyramid(
          currentPrice,
          p.entryPrice,
          p.initialRisk,
          atr ?? undefined,
          addsMap.get(p.id) ?? 0
        );

        if (pyramidCheck.allowed) {
          const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
          const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
          pyramidAlerts.push({
            ticker: p.stock.ticker,
            entryPrice: p.entryPrice,
            currentPrice,
            rMultiple: pyramidCheck.rMultiple,
            addNumber: pyramidCheck.addNumber,
            triggerPrice: pyramidCheck.triggerPrice,
            message: pyramidCheck.message,
            currency,
          });
        }
      }
      if (pyramidAlerts.length > 0) {
        alerts.push(`${pyramidAlerts.length} position(s) eligible for pyramid add`);
      }

      // Send pyramid add alerts via notification centre (Tuesday only)
      const dayOfWeekPyramid = new Date().getDay(); // 0=Sun, 2=Tue
      if (dayOfWeekPyramid === 2 && pyramidAlerts.length > 0) {
        for (const pa of pyramidAlerts) {
          const currSymbol = pa.currency === 'GBP' || pa.currency === 'GBX' ? '£' : pa.currency === 'EUR' ? '€' : '$';
          await sendAlert({
            type: 'PYRAMID_ADD',
            title: `${pa.ticker} is ready for a pyramid add`,
            message: `Your position in ${pa.ticker} has moved up enough to add more shares.\n\nR-multiple: ${pa.rMultiple.toFixed(1)}R\nAdd number: #${pa.addNumber}\n${pa.triggerPrice ? `Trigger price: ${currSymbol}${pa.triggerPrice.toFixed(2)}` : ''}\n${pa.message}\n\nOpen the Portfolio page on Tuesday to review.`,
            data: { ticker: pa.ticker, rMultiple: pa.rMultiple, addNumber: pa.addNumber },
            priority: 'INFO',
          });
        }
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [6] Pyramid check failed:', (error as Error).message);
    }
    console.log(`        Equity: ${equity.toFixed(2)}, Risk: ${openRiskPercent.toFixed(1)}%, Pyramids: ${pyramidAlerts.length}`);

    // Step 7: Sync snapshot + query READY candidates
    console.log('  [7/9] Syncing snapshot data...');
    const positionDetails: NightlyPositionDetail[] = positions.map((p) => {
      const currentPrice = livePrices[p.stock.ticker] || p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? currentPrice;
      const fxRatio = currentPrice > 0 ? gbpPrice / currentPrice : 1;
      // Use GBP-normalised prices for cross-currency PnL aggregation
      const pnlValue = (gbpPrice - p.entryPrice * fxRatio) * p.shares;
      const pnlPercent = p.entryPrice > 0 ? ((currentPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
      const rMultiple = p.initialRisk > 0 ? (currentPrice - p.entryPrice) / p.initialRisk : 0;
      const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
      const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
      return {
        ticker: p.stock.ticker,
        sleeve: p.stock.sleeve,
        shares: p.shares,
        entryPrice: p.entryPrice,
        currentPrice,
        currentStop: p.currentStop,
        protectionLevel: p.protectionLevel,
        rMultiple,
        pnl: pnlValue,
        pnlPercent,
        currency,
      };
    });

    let snapshotSync = { synced: false, rowCount: 0, failed: [] as string[], snapshotId: '' };
    try {
      const result = await syncSnapshot();
      snapshotSync = { synced: true, rowCount: result.rowCount, failed: result.failed, snapshotId: result.snapshotId };
      if (result.failed.length > 0) {
        alerts.push(`Snapshot sync: ${result.rowCount} tickers synced, ${result.failed.length} failed`);
      }
    } catch (error) {
      hadFailure = true;
      console.warn('  [7] Snapshot sync failed:', (error as Error).message);
      alerts.push('Snapshot sync failed — scores may be stale');
    }
    console.log(`        Snapshot: ${snapshotSync.rowCount} synced, ${snapshotSync.failed.length} failed`);

    let readyToBuy: NightlyReadyCandidate[] = [];
    let triggerMetCandidates: NightlyTriggerMetCandidate[] = [];
    if (snapshotSync.snapshotId) {
      try {
        const heldTickers = new Set(positions.map((p) => p.stock.ticker));
        const readyRows = await prisma.snapshotTicker.findMany({
          where: { snapshotId: snapshotSync.snapshotId, status: 'READY' },
          orderBy: { distanceTo20dHighPct: 'asc' },
          take: 15,
        });
        readyToBuy = readyRows
          .filter((r) => !heldTickers.has(r.ticker) && r.adx14 >= 20)
          .map((r) => ({
            ticker: r.ticker,
            name: r.name || r.ticker,
            sleeve: r.sleeve || 'CORE',
            close: r.close,
            entryTrigger: r.entryTrigger,
            stopLevel: r.stopLevel,
            // Distance to entry trigger (not raw 20d high) — matches classifyCandidate
            distancePct: r.close > 0 && r.entryTrigger > 0
              ? ((r.entryTrigger - r.close) / r.close) * 100
              : r.distanceTo20dHighPct,
            atr14: r.atr14,
            adx14: r.adx14,
            currency: r.currency || 'USD',
          }));

        // Detect trigger-met candidates: close >= entryTrigger and not already held
        const allTriggeredRows = await prisma.snapshotTicker.findMany({
          where: {
            snapshotId: snapshotSync.snapshotId,
            status: { in: ['READY', 'WATCH'] },
          },
          orderBy: { distanceTo20dHighPct: 'asc' },
        });
        triggerMetCandidates = allTriggeredRows
          .filter((r) => !heldTickers.has(r.ticker) && r.close >= r.entryTrigger && r.entryTrigger > 0 && r.adx14 >= 20)
          .map((r) => ({
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
        if (triggerMetCandidates.length > 0) {
          alerts.push(`🚨 ${triggerMetCandidates.length} trigger(s) met — review for immediate entry`);
        }
      } catch (error) {
        hadFailure = true;
        console.warn('  [7b] Failed to query READY tickers:', (error as Error).message);
      }
    }

    // ── Alert Generation — In-app notifications via alert-service ────
    const dayOfWeek = new Date().getDay(); // 0=Sunday, 2=Tuesday

    // ALERT 1: Trade triggers (Tuesday only, max 3)
    if (dayOfWeek === 2 && triggerMetCandidates.length > 0) {
      try {
        // Take top 3 by closest distance (already sorted by distanceTo20dHighPct asc)
        const topTriggers = triggerMetCandidates.slice(0, 3);
        const extraCount = triggerMetCandidates.length - topTriggers.length;

        for (const t of topTriggers) {
          const currSymbol = t.currency === 'GBP' || t.currency === 'GBX' ? '£' : t.currency === 'EUR' ? '€' : '$';
          const riskPerShare = t.entryTrigger > 0 && t.stopLevel > 0 ? t.entryTrigger - t.stopLevel : 0;
          await sendAlert({
            type: 'TRADE_TRIGGER',
            title: `${t.ticker} is ready to buy`,
            message: `The system found a trade for Tuesday.\n${t.name} (${t.ticker})\nBuy price: ${currSymbol}${t.entryTrigger.toFixed(2)}\nStop-loss: ${currSymbol}${t.stopLevel.toFixed(2)}${riskPerShare > 0 ? `\nRisk per share: ${currSymbol}${riskPerShare.toFixed(2)}` : ''}\n\nOpen the Plan page to review.${extraCount > 0 ? `\n\nand ${extraCount} more in the app.` : ''}`,
            data: { ticker: t.ticker, entryTrigger: t.entryTrigger, stopLevel: t.stopLevel, close: t.close },
            priority: 'INFO',
          });
        }
        console.log(`        Trade trigger alerts: ${topTriggers.length} sent${extraCount > 0 ? ` (+${extraCount} more in app)` : ''}`);
      } catch (error) {
        console.warn('  [7c] Trade trigger alerts failed:', (error as Error).message);
      }
    }

    // ALERT 2: Weekly summary (Sunday only)
    if (dayOfWeek === 0) {
      try {
        // Determine market mood from regime
        const latestRegime = await prisma.regimeHistory.findFirst({ orderBy: { date: 'desc' } });
        const mood = latestRegime?.regime === 'BULLISH' ? 'Positive ✓'
          : latestRegime?.regime === 'BEARISH' ? 'Negative ✗'
          : 'Neutral —';

        // Position tickers as comma-separated
        const positionTickers = positions.map((p) => p.stock.ticker).join(', ') || 'None';

        // Portfolio value in GBP
        const portfolioValue = positions.reduce((sum, p) => {
          const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
          const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
          return sum + gbpPrice * p.shares;
        }, 0);

        // Closest to triggering (top 3 from readyToBuy)
        const closest = readyToBuy.slice(0, 3);
        const closestLines = closest.length > 0
          ? closest.map((c) => `· ${c.ticker} — ${c.distancePct.toFixed(2)}% away`).join('\n')
          : 'None close to triggering';

        const watchCount = readyToBuy.length;

        await sendAlert({
          type: 'WEEKLY_SUMMARY',
          title: 'Weekly Summary',
          message: `Market mood: ${mood}\nOpen positions: ${positions.length} (${positionTickers})\nPortfolio value: £${portfolioValue.toFixed(0)}\nCandidates watching: ${watchCount}\n\nClosest to triggering:\n${closestLines}\n\nYour trading window is Tuesday.`,
          data: { mood, positionCount: positions.length, portfolioValue, watchCount },
          priority: 'INFO',
        });
        console.log('        Weekly summary alert sent');
      } catch (error) {
        console.warn('  [7d] Weekly summary alert failed:', (error as Error).message);
      }
    }

    // Step 8: Send Telegram summary (isolated — failure doesn't block heartbeat)
    console.log('  [8/9] Sending Telegram summary...');
    let telegramSent = false;
    try {
      telegramSent = await sendNightlySummary({
      date: new Date().toISOString().split('T')[0],
      healthStatus: healthReport.overall,
      regime: snapshotSync.synced ? 'SYNCED' : 'UNKNOWN',
      openPositions: positions.length,
      stopsUpdated: stopRecs.length,
      readyCandidates: readyToBuy.length,
      alerts,
      // Portfolio value in GBP for multi-currency consistency
      portfolioValue: positions.reduce((sum, p) => {
        const rawPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
        return sum + gbpPrice * p.shares;
      }, 0),
      dailyChange: 0,
      dailyChangePercent: 0,
      equity,
      openRiskPercent,
      positions: positionDetails,
      stopChanges,
      trailingStopChanges,
      snapshotSynced: snapshotSync.rowCount,
      snapshotFailed: snapshotSync.failed.length,
      readyToBuy,
      triggerMet: triggerMetCandidates,
      pyramidAlerts,
      laggards: laggardAlerts,
      climaxAlerts,
      swapAlerts,
      whipsawAlerts,
      breadthAlert,
      momentumAlert,
      gapRiskAlerts,
    });
    } catch (error) {
      // Telegram is optional infrastructure — failure must not degrade heartbeat
      console.error('  [8] Telegram send failed:', (error as Error).message);
    }
    console.log(`        Telegram: ${telegramSent ? 'SENT' : 'NOT SENT (check credentials)'}`);

    // Step 9: Write heartbeat
    console.log('  [9/9] Writing heartbeat...');
    await prisma.heartbeat.create({
      data: {
        status: hadFailure ? 'FAILED' : 'SUCCESS',
        details: JSON.stringify({
          healthStatus: healthReport.overall,
          positionsChecked: positions.length,
          stopsRecommended: stopRecs.length,
          trailingStopsApplied: trailingStopChanges.length,
          alertsCount: alerts.length,
          telegramSent,
          hadFailure,
          snapshotSync,
        }),
      },
    });

    console.log('========================================');
    console.log('[HybridTurtle] Nightly process completed successfully');
    console.log(`  Health: ${healthReport.overall}`);
    console.log(`  Positions: ${positions.length}`);
    console.log(`  Alerts: ${alerts.length}`);
    console.log(`  Telegram: ${telegramSent ? 'Sent' : 'Not sent'}`);
    console.log('========================================');
  } catch (error) {
    console.error('[HybridTurtle] Nightly process error:', error);

    // Still write heartbeat on failure
    try {
      await prisma.heartbeat.create({
        data: {
          status: 'FAILED',
          details: JSON.stringify({ error: (error as Error).message }),
        },
      });
    } catch { /* ignore */ }
  } finally {
    // Safety net: if latest heartbeat is still RUNNING, mark as FAILED
    try {
      const latest = await prisma.heartbeat.findFirst({ orderBy: { timestamp: 'desc' } });
      if (latest?.status === 'RUNNING') {
        await prisma.heartbeat.create({
          data: {
            status: 'FAILED',
            details: JSON.stringify({ error: 'Pipeline exited with RUNNING status — forced to FAILED' }),
          },
        });
        console.warn('  [!!!] RUNNING heartbeat found in finally — forced to FAILED');
      }
    } catch { /* best-effort */ }
    await prisma.$disconnect();
  }
}

// If running directly via tsx / node
const args = process.argv.slice(2);

if (args.includes('--run-now')) {
  console.log('[HybridTurtle] Running nightly process immediately (--run-now)');
  runNightlyProcess().then(() => process.exit(0));
}
