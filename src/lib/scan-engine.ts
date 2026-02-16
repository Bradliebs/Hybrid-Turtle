// ============================================================
// 7-Stage Scan Engine
// ============================================================

import type {
  ScanCandidate,
  CandidateStatus,
  MarketRegime,
  Sleeve,
  TechnicalData,
  RiskProfileType,
} from '@/types';
import { ATR_VOLATILITY_CAP_ALL, ATR_VOLATILITY_CAP_HIGH_RISK, ATR_STOP_MULTIPLIER } from '@/types';
import { getTechnicalData, getMarketRegime, getQuickPrice, getFXRate } from './market-data';
import { calculateAdaptiveBuffer } from './modules/adaptive-atr-buffer';
import { calculatePositionSize } from './position-sizer';
import { validateRiskGates } from './risk-gates';
import { checkAntiChasingGuard, checkPullbackContinuationEntry } from './scan-guards';
import prisma from './prisma';

// ---- Stage 1: Universe ----
export async function getUniverse(): Promise<
  { ticker: string; name: string; sleeve: Sleeve; sector: string; cluster: string; currency: string | null }[]
> {
  const stocks = await prisma.stock.findMany({
    where: { active: true },
    orderBy: { ticker: 'asc' },
  });
  return stocks.map((s) => ({
    ticker: s.ticker,
    name: s.name,
    sleeve: s.sleeve as Sleeve,
    sector: s.sector || 'Unknown',
    cluster: s.cluster || 'General',
    currency: s.currency,
  }));
}

// ---- Stage 2: Technical Filters ----
export function runTechnicalFilters(
  price: number,
  technicals: TechnicalData,
  sleeve: Sleeve
): {
  priceAboveMa200: boolean;
  adxAbove20: boolean;
  plusDIAboveMinusDI: boolean;
  atrPercentBelow8: boolean;
  efficiencyAbove30: boolean;
  dataQuality: boolean;
  passesAll: boolean;
} {
  const atrThreshold = sleeve === 'HIGH_RISK'
    ? ATR_VOLATILITY_CAP_HIGH_RISK
    : ATR_VOLATILITY_CAP_ALL;

  const filters = {
    priceAboveMa200: price > technicals.ma200,
    adxAbove20: technicals.adx >= 20,
    plusDIAboveMinusDI: technicals.plusDI > technicals.minusDI,
    atrPercentBelow8: technicals.atrPercent < atrThreshold,
    dataQuality: technicals.ma200 > 0 && technicals.adx > 0,
  };

  return {
    ...filters,
    efficiencyAbove30: technicals.efficiency >= 30,
    passesAll: Object.values(filters).every(Boolean),
  };
}

// ---- Stage 3: Status Classification ----
export function classifyCandidate(
  price: number,
  entryTrigger: number
): CandidateStatus {
  const distance = ((entryTrigger - price) / price) * 100;

  if (distance <= 2) return 'READY';
  if (distance <= 3) return 'WATCH';
  return 'FAR';
}

// ---- Stage 4: Ranking ----
export function rankCandidate(
  sleeve: Sleeve,
  technicals: TechnicalData,
  status: CandidateStatus
): number {
  let score = 0;

  // Sleeve priority (higher = better)
  const sleevePriority: Record<Sleeve, number> = {
    CORE: 40,
    ETF: 20,
    HIGH_RISK: 10,
    HEDGE: 5, // Lowest priority — long-term holds, guidance only
  };
  score += sleevePriority[sleeve];

  // Status bonus
  if (status === 'READY') score += 30;
  else if (status === 'WATCH') score += 10;

  // ADX tiebreaker
  score += Math.min(technicals.adx, 50) * 0.3;

  // Volume ratio
  score += Math.min(technicals.volumeRatio, 3) * 5;

  // Trend efficiency
  score += Math.min(technicals.efficiency, 100) * 0.2;

  // Relative strength
  score += Math.min(technicals.relativeStrength, 100) * 0.1;

  return Math.round(score * 100) / 100;
}

// ---- Stage 5: Risk Cap Gates ----
// Handled by validateRiskGates from risk-gates.ts, called inside runFullScan.

// ---- Stage 6: Anti-Chase / Execution Guard ----
// Handled by checkAntiChasingGuard from scan-guards.ts, called inside runFullScan.

// ---- Stage 7: Position Sizing (uses position-sizer.ts) ----

// ---- Full Scan Pipeline ----
export async function runFullScan(
  userId: string,
  riskProfile: RiskProfileType,
  equity: number
): Promise<{
  regime: MarketRegime;
  candidates: ScanCandidate[];
  readyCount: number;
  watchCount: number;
  farCount: number;
  totalScanned: number;
  passedFilters: number;
  passedRiskGates: number;
  passedAntiChase: number;
}> {
  const universe = await getUniverse();
  const candidates: ScanCandidate[] = [];

  // Determine market regime from SPY vs 200 MA (live data)
  const regime = await getMarketRegime();

  // ── Fetch existing positions for risk gate checks (Stage 5) ──
  const existingPositions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: true },
  });

  const positionsForGates = await Promise.all(existingPositions.map(async (p) => {
    const currency = (p.stock.currency || 'USD').toUpperCase();
    const isUk = p.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(p.stock.ticker);
    const fxToGbp = isUk || currency === 'GBX' || currency === 'GBP' || currency === 'GBp'
      ? (currency === 'GBP' ? 1 : 0.01)
      : await getFXRate(currency, 'GBP');

    const currentPriceNative = await getQuickPrice(p.stock.ticker) ?? p.entryPrice;
    const entryPriceGbp = p.entryPrice * fxToGbp;
    const currentStopGbp = p.currentStop * fxToGbp;
    const currentPriceGbp = currentPriceNative * fxToGbp;

    return {
      id: p.id,
      ticker: p.stock.ticker,
      sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
      sector: p.stock.sector || 'Unknown',
      cluster: p.stock.cluster || 'General',
      value: entryPriceGbp * p.shares,
      riskDollars: Math.max(0, (currentPriceGbp - currentStopGbp) * p.shares),
      shares: p.shares,
      entryPrice: entryPriceGbp,
      currentStop: currentStopGbp,
      currentPrice: currentPriceGbp,
    };
  }));

  const fxCache = new Map<string, number>();
  async function getFxToGbp(currency: string | null, ticker: string): Promise<number> {
    const curr = (currency || 'USD').toUpperCase();
    const isUk = ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(ticker);
    if (isUk || curr === 'GBX' || curr === 'GBp') return 0.01;
    if (curr === 'GBP') return 1;
    const cached = fxCache.get(curr);
    if (cached != null) return cached;
    const rate = await getFXRate(curr, 'GBP');
    fxCache.set(curr, rate);
    return rate;
  }

  // Process in smaller batches to avoid overwhelming Yahoo Finance
  const BATCH_SIZE = 10;
  for (let batch = 0; batch < universe.length; batch += BATCH_SIZE) {
    const stockBatch = universe.slice(batch, batch + BATCH_SIZE);

    const batchPromises = stockBatch.map(async (stock) => {
      try {
        // Fetch live technical data from Yahoo Finance (includes current price)
        const technicals = await getTechnicalData(stock.ticker);
        if (!technicals) {
          console.warn(`[Scan] Skipping ${stock.ticker} — insufficient data`);
          return null;
        }

        // Use price from chart data — avoids a separate quote() call per ticker
        const price = technicals.currentPrice;
        if (!price) return null;

        const filterResults = runTechnicalFilters(price, technicals, stock.sleeve);
        const adaptiveBuffer = calculateAdaptiveBuffer(
          stock.ticker,
          technicals.twentyDayHigh,
          technicals.atr,
          technicals.atrPercent,
          technicals.priorTwentyDayHigh
        );
        let entryTrigger = adaptiveBuffer.adjustedEntryTrigger;
        let stopPrice = entryTrigger - technicals.atr * ATR_STOP_MULTIPLIER;
        let distancePercent = ((entryTrigger - price) / price) * 100;
        let status = classifyCandidate(price, entryTrigger);
        let passesAllFilters = filterResults.passesAll;

        const atrSpiking = technicals.atrSpiking;
        const bullishDI = technicals.plusDI > technicals.minusDI;
        let atrSpikeAction: 'NONE' | 'SOFT_CAP' | 'HARD_BLOCK' = 'NONE';

        if (atrSpiking) {
          if (bullishDI) {
            atrSpikeAction = 'SOFT_CAP';
            if (status === 'READY') status = 'WATCH';
          } else {
            atrSpikeAction = 'HARD_BLOCK';
            passesAllFilters = false;
            status = 'FAR';
          }
        }

        if (!filterResults.efficiencyAbove30 && status === 'READY') {
          status = 'WATCH';
        }

        const rankScore = rankCandidate(stock.sleeve, technicals, status);

        let shares: number | undefined;
        let riskDollars: number | undefined;
        let riskPercent: number | undefined;
        let totalCost: number | undefined;
        let riskGateResults: ScanCandidate['riskGateResults'];
        let passesRiskGates = true;
        let antiChaseResult: ScanCandidate['antiChaseResult'];
        let pullbackSignal: ScanCandidate['pullbackSignal'];
        let passesAntiChase = true;

        if (passesAllFilters && status !== 'FAR') {
          const fxToGbp = await getFxToGbp(stock.currency, stock.ticker);

          // ── Stage 7: Position Sizing (with position size cap) ──
          try {
            const sizing = calculatePositionSize({
              equity,
              riskProfile,
              entryPrice: entryTrigger,
              stopPrice,
              sleeve: stock.sleeve,
              fxToGbp,
            });
            shares = sizing.shares;
            riskDollars = sizing.riskDollars;
            riskPercent = sizing.riskPercent;
            totalCost = sizing.totalCost;
          } catch {
            // Skip if sizing fails
          }

          // ── Stage 5: Risk Gates ──
          const gateValue = totalCost ?? 0;
          const gateRisk = riskDollars ?? 0;
          riskGateResults = validateRiskGates(
            {
              sleeve: stock.sleeve,
              sector: stock.sector,
              cluster: stock.cluster,
              value: gateValue,
              riskDollars: gateRisk,
            },
            positionsForGates,
            equity,
            riskProfile
          );
          passesRiskGates = riskGateResults.every((g) => g.passed);

          // ── Stage 6: Anti-Chase / Execution Guard ──
          const extATR = technicals.atr > 0 ? (price - entryTrigger) / technicals.atr : 0;
          // Volatility expansion anti-chase override (all days):
          // If price stretches too far above trigger in ATR terms (extATR > 0.8),
          // force WAIT_PULLBACK regardless of earlier READY/WATCH classification.
          // This is separate from the Monday-only gap guard in scan-guards.ts.
          if (extATR > 0.8) {
            antiChaseResult = {
              passed: false,
              reason: `WAIT_PULLBACK — ext_atr ${extATR.toFixed(2)} > 0.80`,
            };
            status = 'WAIT_PULLBACK';
          } else {
            antiChaseResult = checkAntiChasingGuard(
              price,
              entryTrigger,
              technicals.atr,
              new Date().getDay()
            );
          }

          if (status === 'WAIT_PULLBACK') {
            pullbackSignal = checkPullbackContinuationEntry({
              status,
              hh20: technicals.twentyDayHigh,
              ema20: technicals.ema20 ?? technicals.twentyDayHigh,
              atr: technicals.atr,
              close: price,
              low: technicals.dayLow ?? price,
            });

            if (pullbackSignal.triggered) {
              entryTrigger = pullbackSignal.entryPrice ?? price;
              stopPrice = pullbackSignal.stopPrice ?? stopPrice;
              distancePercent = ((entryTrigger - price) / price) * 100;
              status = 'READY';
              antiChaseResult = {
                passed: true,
                reason: `PULLBACK_CONTINUATION — ${pullbackSignal.reason}`,
              };

              try {
                const sizing = calculatePositionSize({
                  equity,
                  riskProfile,
                  entryPrice: entryTrigger,
                  stopPrice,
                  sleeve: stock.sleeve,
                  fxToGbp,
                });
                shares = sizing.shares;
                riskDollars = sizing.riskDollars;
                riskPercent = sizing.riskPercent;
                totalCost = sizing.totalCost;
              } catch {
                // Skip if sizing fails
              }

              const gateValueAfterPullback = totalCost ?? 0;
              const gateRiskAfterPullback = riskDollars ?? 0;
              riskGateResults = validateRiskGates(
                {
                  sleeve: stock.sleeve,
                  sector: stock.sector,
                  cluster: stock.cluster,
                  value: gateValueAfterPullback,
                  riskDollars: gateRiskAfterPullback,
                },
                positionsForGates,
                equity,
                riskProfile
              );
              passesRiskGates = riskGateResults.every((g) => g.passed);
            }
          }

          passesAntiChase = antiChaseResult.passed;
        }

        // Determine native price currency (matches what T212/Yahoo shows)
        const isUK = stock.ticker.endsWith('.L');
        const priceCurrency = isUK ? 'GBX' : (stock.currency || 'USD').toUpperCase();

        return {
          id: stock.ticker,
          ticker: stock.ticker,
          name: stock.name,
          sleeve: stock.sleeve,
          sector: stock.sector,
          cluster: stock.cluster,
          price,
          priceCurrency,
          technicals,
          entryTrigger,
          stopPrice,
          distancePercent,
          status,
          rankScore,
          passesAllFilters,
          riskGateResults,
          passesRiskGates,
          antiChaseResult,
          pullbackSignal,
          passesAntiChase,
          shares,
          riskDollars,
          riskPercent,
          totalCost,
          filterResults: {
            ...filterResults,
            atrSpiking,
            atrSpikeAction,
          },
        } as ScanCandidate;
      } catch (error) {
        console.error(`[Scan] Failed for ${stock.ticker}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const result of batchResults) {
      if (result) candidates.push(result);
    }

    // Brief pause between batches to be respectful to Yahoo
    if (batch + BATCH_SIZE < universe.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Sort: triggered first → READY → WATCH → FAR/failed, then by rank score
  const statusOrder: Record<string, number> = { READY: 0, WATCH: 1, WAIT_PULLBACK: 1, FAR: 2 };
  candidates.sort((a, b) => {
    // Trigger-met candidates float to the very top (price ≥ entry trigger + passes filters)
    const aTriggered = a.passesAllFilters && a.price >= a.entryTrigger ? 1 : 0;
    const bTriggered = b.passesAllFilters && b.price >= b.entryTrigger ? 1 : 0;
    if (aTriggered !== bTriggered) return bTriggered - aTriggered;
    // Then by status: READY → WATCH → FAR
    const aStatus = statusOrder[a.status] ?? 3;
    const bStatus = statusOrder[b.status] ?? 3;
    if (aStatus !== bStatus) return aStatus - bStatus;
    // Then by rank score within same group
    return b.rankScore - a.rankScore;
  });

  const passesAll = candidates.filter((c) => c.passesAllFilters);

  return {
    regime,
    candidates,
    readyCount: passesAll.filter((c) => c.status === 'READY').length,
    watchCount: passesAll.filter((c) => c.status === 'WATCH' || c.status === 'WAIT_PULLBACK').length,
    farCount: candidates.filter((c) => c.status === 'FAR').length,
    totalScanned: universe.length,
    passedFilters: passesAll.length,
    passedRiskGates: passesAll.filter((c) => c.passesRiskGates).length,
    passedAntiChase: passesAll.filter((c) => c.passesAntiChase).length,
  };
}
