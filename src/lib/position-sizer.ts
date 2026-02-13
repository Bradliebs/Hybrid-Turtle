// ============================================================
// Position Sizing Calculator
// ============================================================
// Formula: Shares = (Equity × Risk%) / (Entry Price - Stop Price)
// Always rounds DOWN to whole shares.

import type { PositionSizingResult, RiskProfileType } from '@/types';
import { RISK_PROFILES, POSITION_SIZE_CAPS, type Sleeve } from '@/types';

export interface PositionSizeInput {
  equity: number;
  riskProfile: RiskProfileType;
  entryPrice: number;
  stopPrice: number;
  sleeve?: Sleeve; // For position size cap enforcement
  customRiskPercent?: number; // Override for manual adjustment
  fxToGbp?: number; // FX conversion rate to GBP (default 1.0)
}

export function calculatePositionSize(input: PositionSizeInput): PositionSizingResult {
  const { equity, riskProfile, entryPrice, stopPrice, sleeve, customRiskPercent, fxToGbp = 1.0 } = input;

  // Validate inputs
  if (equity <= 0) {
    throw new Error('Equity must be positive');
  }
  if (entryPrice <= 0) {
    throw new Error('Entry price must be positive');
  }
  if (stopPrice <= 0) {
    throw new Error('Stop price must be positive');
  }
  if (stopPrice >= entryPrice) {
    throw new Error('Stop price must be below entry price for long positions');
  }

  const profile = RISK_PROFILES[riskProfile];
  const riskPercent = customRiskPercent ?? profile.riskPerTrade;
  const riskPerShare = (entryPrice - stopPrice) * fxToGbp; // Convert to GBP
  const riskAmount = equity * (riskPercent / 100);

  // Calculate shares — fractional to 0.001
  let shares = Math.floor((riskAmount / riskPerShare) * 1000) / 1000;

  // Enforce position size cap: totalCost ≤ cap% × equity
  if (shares > 0 && sleeve) {
    const cap = POSITION_SIZE_CAPS[sleeve];
    const maxCost = equity * cap;
    const totalCostInGbp = shares * entryPrice * fxToGbp;
    if (totalCostInGbp > maxCost) {
      shares = Math.floor((maxCost / (entryPrice * fxToGbp)) * 1000) / 1000;
    }
  }

  if (shares <= 0) {
    return {
      shares: 0,
      totalCost: 0,
      riskDollars: 0,
      riskPercent: 0,
      entryPrice,
      stopPrice,
      rPerShare: riskPerShare,
    };
  }

  const totalCost = shares * entryPrice * fxToGbp;
  const actualRiskDollars = shares * riskPerShare;
  const actualRiskPercent = (actualRiskDollars / equity) * 100;

  return {
    shares,
    totalCost,
    riskDollars: actualRiskDollars,
    riskPercent: actualRiskPercent,
    entryPrice,
    stopPrice,
    rPerShare: riskPerShare,
  };
}

/**
 * Calculate entry trigger price from 20-day high + ATR buffer
 */
export function calculateEntryTrigger(twentyDayHigh: number, atr: number): number {
  return twentyDayHigh + 0.1 * atr;
}

/**
 * Calculate R-multiple for a position
 */
export function calculateRMultiple(
  currentPrice: number,
  entryPrice: number,
  initialRisk: number
): number {
  if (initialRisk === 0) return 0;
  return (currentPrice - entryPrice) / initialRisk;
}

/**
 * Calculate gain/loss percentage
 */
export function calculateGainPercent(currentPrice: number, entryPrice: number): number {
  if (entryPrice === 0) return 0;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Calculate gain/loss in dollars
 */
export function calculateGainDollars(
  currentPrice: number,
  entryPrice: number,
  shares: number
): number {
  return (currentPrice - entryPrice) * shares;
}
