import type { ScanCandidate } from '@/types';
import { ATR_VOLATILITY_CAP_ALL, ATR_VOLATILITY_CAP_HIGH_RISK } from '@/types';
import { countTruthyPassFlags, normalizePersistedPassFlag } from '@/lib/scan-pass-flags';

export interface ScanResultRowForReconstruction {
  stock: {
    ticker: string;
    yahooTicker?: string | null;
    name: string;
    sleeve: string;
    sector: string | null;
    cluster: string | null;
    currency: string | null;
  };
  price: number;
  ma200: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  atrPercent: number;
  efficiency: number;
  twentyDayHigh: number;
  entryTrigger: number;
  stopPrice: number;
  distancePercent: number;
  status: string;
  rankScore: number;
  passesAllFilters: boolean;
  passesRiskGates?: boolean | null;
  passesAntiChase?: boolean | null;
  shares: number | null;
  riskDollars: number | null;
}

export function reconstructCandidateFromDbRow(
  r: ScanResultRowForReconstruction
): ScanCandidate {
  const atrCap = r.stock.sleeve === 'HIGH_RISK'
    ? ATR_VOLATILITY_CAP_HIGH_RISK
    : ATR_VOLATILITY_CAP_ALL;

  return {
    id: r.stock.ticker,
    ticker: r.stock.ticker,
    yahooTicker: r.stock.yahooTicker || undefined,
    name: r.stock.name,
    sleeve: r.stock.sleeve as ScanCandidate['sleeve'],
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
      currentPrice: r.price,
      atr20DayAgo: r.atrPercent,
    },
    entryTrigger: r.entryTrigger,
    stopPrice: r.stopPrice,
    distancePercent: r.distancePercent,
    status: r.status as ScanCandidate['status'],
    rankScore: r.rankScore,
    passesAllFilters: r.passesAllFilters,
    passesRiskGates: normalizePersistedPassFlag(r.passesRiskGates),
    passesAntiChase: normalizePersistedPassFlag(r.passesAntiChase),
    shares: r.shares ?? undefined,
    riskDollars: r.riskDollars ?? undefined,
    filterResults: {
      priceAboveMa200: r.price > r.ma200,
      adxAbove20: r.adx >= 20,
      plusDIAboveMinusDI: r.plusDI > r.minusDI,
      atrPercentBelow8: r.atrPercent < atrCap,
      efficiencyAbove30: r.efficiency >= 30,
      dataQuality: r.ma200 > 0 && r.adx > 0,
      atrSpiking: false,
      atrSpikeAction: 'NONE',
    },
  };
}

export function reconstructCandidatesFromDbRows(
  rows: ScanResultRowForReconstruction[]
): ScanCandidate[] {
  return rows.map(reconstructCandidateFromDbRow);
}

export function getPassedGateCounts(candidates: ScanCandidate[]): {
  passedRiskGates: number;
  passedAntiChase: number;
} {
  const passedFilters = candidates.filter((candidate) => candidate.passesAllFilters);
  return {
    passedRiskGates: countTruthyPassFlags(passedFilters.map((candidate) => candidate.passesRiskGates)),
    passedAntiChase: countTruthyPassFlags(passedFilters.map((candidate) => candidate.passesAntiChase)),
  };
}