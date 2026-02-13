// ============================================================
// Stop-Loss Manager — Monotonic Enforcement + Trailing ATR
// ============================================================
// CRITICAL SAFETY RULE: Stops NEVER go down.
// if (newStop < currentStop) throw Error

import type { ProtectionLevel } from '@/types';
import { PROTECTION_LEVELS } from '@/types';
import prisma from './prisma';
import { getDailyPrices, calculateATR } from './market-data';

export class StopLossError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StopLossError';
  }
}

/**
 * Determines the appropriate protection level based on R-multiple
 */
export function getProtectionLevel(rMultiple: number): ProtectionLevel {
  if (rMultiple >= 3.0) return 'LOCK_1R_TRAIL';
  if (rMultiple >= 2.5) return 'LOCK_08R';
  if (rMultiple >= 1.5) return 'BREAKEVEN';
  return 'INITIAL';
}

/**
 * Calculate the recommended stop price for a given protection level
 * For LOCK_1R_TRAIL: max(Entry + 1R, Close − 2×ATR)
 */
export function calculateProtectionStop(
  entryPrice: number,
  initialRisk: number,
  level: ProtectionLevel,
  currentPrice?: number,
  currentATR?: number
): number {
  switch (level) {
    case 'INITIAL':
      return entryPrice - initialRisk;
    case 'BREAKEVEN':
      return entryPrice; // Break even
    case 'LOCK_08R':
      return entryPrice + 0.5 * initialRisk; // Lock +0.5R above entry
    case 'LOCK_1R_TRAIL': {
      const lockFloor = entryPrice + 1.0 * initialRisk; // Lock +1R above entry
      if (currentPrice != null && currentATR != null && currentATR > 0) {
        const trailingStop = currentPrice - 2 * currentATR;
        return Math.max(lockFloor, trailingStop);
      }
      return lockFloor;
    }
    default:
      return entryPrice - initialRisk;
  }
}

/**
 * Calculate recommended stop adjustment for a position
 * Returns null if no adjustment needed
 * For LOCK_1R_TRAIL: uses max(Entry + 1R, Close − 2×ATR)
 */
export function calculateStopRecommendation(
  currentPrice: number,
  entryPrice: number,
  initialRisk: number,
  currentStop: number,
  currentLevel: ProtectionLevel,
  currentATR?: number
): {
  newStop: number;
  newLevel: ProtectionLevel;
  reason: string;
} | null {
  if (initialRisk <= 0) return null;

  const rMultiple = (currentPrice - entryPrice) / initialRisk;
  const recommendedLevel = getProtectionLevel(rMultiple);

  // Only upgrade protection, never downgrade
  const levelOrder: ProtectionLevel[] = ['INITIAL', 'BREAKEVEN', 'LOCK_08R', 'LOCK_1R_TRAIL'];
  const currentIdx = levelOrder.indexOf(currentLevel);
  const recommendedIdx = levelOrder.indexOf(recommendedLevel);

  if (recommendedIdx <= currentIdx) return null;

  const newStop = calculateProtectionStop(entryPrice, initialRisk, recommendedLevel, currentPrice, currentATR);

  // MONOTONIC ENFORCEMENT: Never lower a stop
  if (newStop <= currentStop) return null;

  const levelConfig = PROTECTION_LEVELS[recommendedLevel];
  const reason = `R-multiple reached ${rMultiple.toFixed(1)}R → ${levelConfig.label} (${levelConfig.stopFormula})`;

  return {
    newStop,
    newLevel: recommendedLevel,
    reason,
  };
}

/**
 * Update stop-loss for a position — ENFORCES MONOTONIC RULE
 * @throws StopLossError if newStop < currentStop
 */
export async function updateStopLoss(
  positionId: string,
  newStop: number,
  reason: string
): Promise<void> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
  });

  if (!position) {
    throw new StopLossError(`Position ${positionId} not found`);
  }

  if (position.status === 'CLOSED') {
    throw new StopLossError('Cannot update stop on a closed position');
  }

  // ❌ CRITICAL: MONOTONIC ENFORCEMENT
  if (newStop < position.currentStop) {
    throw new StopLossError(
      `Stop-loss can only be moved UP. Current: $${position.currentStop.toFixed(2)}, Attempted: $${newStop.toFixed(2)}`
    );
  }

  // No-op if same
  if (newStop === position.currentStop) return;

  const rMultiple = position.initialRisk > 0
    ? (newStop - position.entryPrice + position.initialRisk) / position.initialRisk
    : 0;
  const newLevel = getProtectionLevel(rMultiple);

  // Record stop history
  await prisma.stopHistory.create({
    data: {
      positionId,
      oldStop: position.currentStop,
      newStop,
      level: newLevel,
      reason,
    },
  });

  // Update position
  await prisma.position.update({
    where: { id: positionId },
    data: {
      currentStop: newStop,
      stopLoss: newStop,
      protectionLevel: newLevel,
    },
  });
}

/**
 * Batch update all positions' stops based on current prices
 * Returns array of recommended changes (does NOT auto-apply)
 */
export async function generateStopRecommendations(
  userId: string,
  currentPrices: Map<string, number>,
  currentATRs?: Map<string, number>
): Promise<
  {
    positionId: string;
    ticker: string;
    currentStop: number;
    newStop: number;
    newLevel: ProtectionLevel;
    reason: string;
  }[]
> {
  const positions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: true },
  });

  const recommendations: {
    positionId: string;
    ticker: string;
    currentStop: number;
    newStop: number;
    newLevel: ProtectionLevel;
    reason: string;
  }[] = [];

  for (const position of positions) {
    const currentPrice = currentPrices.get(position.stock.ticker);
    if (!currentPrice) continue;

    const rec = calculateStopRecommendation(
      currentPrice,
      position.entryPrice,
      position.initialRisk,
      position.currentStop,
      position.protectionLevel as ProtectionLevel,
      currentATRs?.get(position.stock.ticker)
    );

    if (rec) {
      recommendations.push({
        positionId: position.id,
        ticker: position.stock.ticker,
        currentStop: position.currentStop,
        ...rec,
      });
    }
  }

  return recommendations;
}

// ============================================================
// Trailing ATR Stop — Dynamic stop that ratchets up with price
// ============================================================
// Uses 2× ATR(14) below the highest close since entry.
// The stop only ever moves UP (monotonic enforcement).
// This matches the external Python system's trailing stop logic.
// ============================================================

/**
 * Calculate trailing ATR stop for a given ticker.
 * Returns the highest trailing stop value seen across the price history since entry.
 */
export async function calculateTrailingATRStop(
  ticker: string,
  entryPrice: number,
  entryDate: Date,
  currentStop: number,
  atrMultiplier: number = 2.0
): Promise<{
  trailingStop: number;
  highestClose: number;
  currentATR: number;
  shouldUpdate: boolean;
} | null> {
  try {
    const bars = await getDailyPrices(ticker, 'full');
    if (bars.length < 20) return null;

    // bars are sorted newest-first; reverse for chronological processing
    const chronological = [...bars].reverse();

    // Find bars since entry date
    const entryDateStr = entryDate.toISOString().split('T')[0];
    const entryIdx = chronological.findIndex(b => b.date >= entryDateStr);
    if (entryIdx < 0) return null;

    // Need at least 14 bars before entry for ATR calc
    const startIdx = Math.max(0, entryIdx - 14);
    const relevantBars = chronological.slice(startIdx);

    let highestClose = entryPrice;
    let trailingStop = currentStop;

    // Walk forward from entry, calculating ATR and trailing stop at each bar
    for (let i = 14; i < relevantBars.length; i++) {
      const bar = relevantBars[i];
      if (bar.date < entryDateStr) continue;

      // Calculate rolling 14-period ATR
      const atrSlice = relevantBars.slice(i - 14, i + 1);
      const trs: number[] = [];
      for (let j = 1; j < atrSlice.length; j++) {
        const tr = Math.max(
          atrSlice[j].high - atrSlice[j].low,
          Math.abs(atrSlice[j].high - atrSlice[j - 1].close),
          Math.abs(atrSlice[j].low - atrSlice[j - 1].close)
        );
        trs.push(tr);
      }
      const atr = trs.reduce((s, v) => s + v, 0) / trs.length;

      // Track highest close since entry
      if (bar.close > highestClose) {
        highestClose = bar.close;
      }

      // Trailing stop = highestClose - (multiplier × ATR)
      const candidateStop = highestClose - atrMultiplier * atr;

      // Monotonic: only ratchet up
      if (candidateStop > trailingStop) {
        trailingStop = candidateStop;
      }
    }

    // Current ATR (most recent 14 bars)
    const currentATR = calculateATR(bars, 14);

    const shouldUpdate = trailingStop > currentStop;

    return {
      trailingStop: Math.round(trailingStop * 100) / 100,
      highestClose,
      currentATR,
      shouldUpdate,
    };
  } catch (error) {
    console.error(`[TrailingATR] Failed for ${ticker}:`, (error as Error).message);
    return null;
  }
}

/**
 * Generate trailing ATR stop recommendations for all open positions.
 * Compares the dynamically calculated trailing stop with the current DB stop.
 * Returns recommendations where the trailing stop is higher (tighter).
 */
export async function generateTrailingStopRecommendations(
  userId: string
): Promise<{
  positionId: string;
  ticker: string;
  currentStop: number;
  trailingStop: number;
  highestClose: number;
  currentATR: number;
  reason: string;
  priceCurrency: string;
}[]> {
  const positions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: true },
  });

  const recommendations: {
    positionId: string;
    ticker: string;
    currentStop: number;
    trailingStop: number;
    highestClose: number;
    currentATR: number;
    reason: string;
    priceCurrency: string;
  }[] = [];

  for (const position of positions) {
    const result = await calculateTrailingATRStop(
      position.stock.ticker,
      position.entryPrice,
      position.entryDate,
      position.currentStop
    );

    const isUK = position.stock.ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(position.stock.ticker);
    const priceCurrency = isUK ? 'GBX' : (position.stock.currency || 'USD').toUpperCase();

    if (result && result.shouldUpdate) {
      recommendations.push({
        positionId: position.id,
        ticker: position.stock.ticker,
        currentStop: position.currentStop,
        trailingStop: result.trailingStop,
        highestClose: result.highestClose,
        currentATR: result.currentATR,
        reason: `Trailing ATR stop: High ${result.highestClose.toFixed(2)} − 2×ATR(${result.currentATR.toFixed(2)}) = ${result.trailingStop.toFixed(2)}`,
        priceCurrency,
      });
    }
  }

  return recommendations;
}
