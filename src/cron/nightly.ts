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
import type { NightlyPositionDetail, NightlyStopChange, NightlyReadyCandidate, NightlyTriggerMetCandidate, NightlyLaggardAlert, NightlyClimaxAlert, NightlySwapAlert, NightlyWhipsawAlert, NightlyBreadthAlert, NightlyMomentumAlert, NightlyPyramidAlert } from '@/lib/telegram';
import { getBatchPrices, normalizeBatchPricesToGBP, getDailyPrices, calculateADX, calculateATR, preCacheHistoricalData } from '@/lib/market-data';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { syncSnapshot } from '@/lib/snapshot-sync';
import { detectLaggards } from '@/lib/laggard-detector';
import { scanClimaxSignals } from '@/lib/modules/climax-detector';
import { findSwapSuggestions } from '@/lib/modules/heatmap-swap';
import { checkWhipsawBlocks } from '@/lib/modules/whipsaw-guard';
import { calculateBreadth, checkBreadthSafety } from '@/lib/modules/breadth-safety';
import { checkMomentumExpansion } from '@/lib/modules/momentum-expansion';
import { getRiskBudget, canPyramid } from '@/lib/risk-gates';
import { calculateRMultiple } from '@/lib/position-sizer';
import type { RiskProfileType, Sleeve } from '@/types';

async function runNightlyProcess() {
  const userId = 'default-user';

  console.log('========================================');
  console.log(`[HybridTurtle] Nightly process started at ${new Date().toISOString()}`);
  console.log('========================================');

  try {
    // Step 0: Pre-cache historical data for all active tickers
    console.log('  [0/9] Pre-caching historical data for all active tickers...');
    try {
      const preCacheResult = await preCacheHistoricalData();
      console.log(`        ${preCacheResult.success}/${preCacheResult.total} tickers cached in ${(preCacheResult.durationMs / 1000).toFixed(1)}s`);
      if (preCacheResult.failed.length > 0) {
        console.warn(`        Failed: ${preCacheResult.failed.join(', ')}`);
      }
    } catch (error) {
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
      console.error('  [1] Health check failed:', (error as Error).message);
    }

    // Step 2: Get open positions + fetch live prices
    console.log('  [2/9] Fetching positions and live prices...');
    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    const openTickers = positions.map((p) => p.stock.ticker);
    const livePrices = openTickers.length > 0 ? await getBatchPrices(openTickers) : {};
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) {
      stockCurrencies[p.stock.ticker] = p.stock.currency;
    }
    const gbpPrices = openTickers.length > 0
      ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
      : {};
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
      console.warn('  [3b] Trailing stop calculation failed:', (error as Error).message);
    }
    console.log(`        ${stopRecs.length} R-based, ${trailingStopChanges.length} trailing ATR`);

    // Step 4: Detect laggards + collect alerts
    console.log('  [4/9] Detecting laggards...');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const equity = user?.equity || 0;

    const alerts: string[] = [];
    if (healthReport.overall === 'RED') alerts.push('Health check is RED — review issues before trading');
    if (healthReport.overall === 'YELLOW') alerts.push('Health check has warnings');
    if (stopChanges.length > 0) alerts.push(`${stopChanges.length} R-based stop-loss updates auto-applied`);
    if (trailingStopChanges.length > 0) alerts.push(`${trailingStopChanges.length} trailing ATR stops auto-applied`);

    let laggardAlerts: NightlyLaggardAlert[] = [];
    try {
      const laggardInput = positions.map((p) => {
        const currentPrice = livePrices[p.stock.ticker] || p.entryPrice;
        const isUK = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
        const currency = isUK ? 'GBX' : (p.stock.currency || 'USD').toUpperCase();
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

    try {
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

      let spyAdx = 20;
      try {
        const spyBars = await getDailyPrices('SPY', 'compact');
        if (spyBars.length >= 28) {
          const adxResult = calculateADX(spyBars, 14);
          spyAdx = adxResult.adx;
        }
      } catch { /* default */ }
      const momentumResult = checkMomentumExpansion(spyAdx, riskProfile);
      momentumAlert = {
        adx: momentumResult.adx,
        isExpanded: momentumResult.isExpanded,
        expandedMaxRisk: momentumResult.expandedMaxRisk,
        reason: momentumResult.reason,
      };
      if (momentumResult.isExpanded) {
        alerts.push(`Momentum expansion active — ADX ${spyAdx.toFixed(1)}, risk cap raised`);
      }
    } catch (error) {
      console.warn('  [5] Module checks failed:', (error as Error).message);
    }
    console.log(`        Climax: ${climaxAlerts.length}, Swap: ${swapAlerts.length}, Whipsaw: ${whipsawAlerts.length}`);

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
    } catch (error) {
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
          .filter((r) => !heldTickers.has(r.ticker))
          .map((r) => ({
            ticker: r.ticker,
            name: r.name || r.ticker,
            sleeve: r.sleeve || 'CORE',
            close: r.close,
            entryTrigger: r.entryTrigger,
            stopLevel: r.stopLevel,
            distancePct: r.distanceTo20dHighPct,
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
          .filter((r) => !heldTickers.has(r.ticker) && r.close >= r.entryTrigger && r.entryTrigger > 0)
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
        console.warn('  [7b] Failed to query READY tickers:', (error as Error).message);
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
    });
    } catch (error) {
      console.error('  [8] Telegram send failed:', (error as Error).message);
    }
    console.log(`        Telegram: ${telegramSent ? 'SENT' : 'NOT SENT (check credentials)'}`);

    // Step 9: Write heartbeat
    console.log('  [9/9] Writing heartbeat...');
    await prisma.heartbeat.create({
      data: {
        status: 'SUCCESS',
        details: JSON.stringify({
          healthStatus: healthReport.overall,
          positionsChecked: positions.length,
          stopsRecommended: stopRecs.length,
          trailingStopsApplied: trailingStopChanges.length,
          alertsCount: alerts.length,
          telegramSent,
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
    await prisma.$disconnect();
  }
}

// If running directly via tsx / node
const args = process.argv.slice(2);

if (args.includes('--run-now')) {
  console.log('[HybridTurtle] Running nightly process immediately (--run-now)');
  runNightlyProcess().then(() => process.exit(0));
}
