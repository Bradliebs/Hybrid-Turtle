// ============================================================
// HybridTurtle Trading System v5.11 — Type Definitions
// ============================================================

// ---- Risk Profiles ----
export type RiskProfileType = 'CONSERVATIVE' | 'BALANCED' | 'SMALL_ACCOUNT' | 'AGGRESSIVE';

export interface RiskProfileConfig {
  name: string;
  riskPerTrade: number; // percentage
  maxPositions: number;
  maxOpenRisk: number; // percentage
  description: string;
}

export const RISK_PROFILES: Record<RiskProfileType, RiskProfileConfig> = {
  CONSERVATIVE: {
    name: 'Conservative',
    riskPerTrade: 0.75,
    maxPositions: 8,
    maxOpenRisk: 7.0,
    description: 'Lower risk per trade, more diversified positions',
  },
  BALANCED: {
    name: 'Balanced',
    riskPerTrade: 0.95,
    maxPositions: 5,
    maxOpenRisk: 5.5,
    description: 'Moderate risk with balanced position sizing',
  },
  SMALL_ACCOUNT: {
    name: 'Small Account',
    riskPerTrade: 1.5,
    maxPositions: 4,
    maxOpenRisk: 10.0,
    description: 'Higher risk per trade for smaller account growth',
  },
  AGGRESSIVE: {
    name: 'Aggressive',
    riskPerTrade: 1.0,
    maxPositions: 2,
    maxOpenRisk: 6.0,
    description: 'Building mode — 2 concentrated positions with expansion enabled',
  },
};

// ---- Sleeve Caps ----
export const SLEEVE_CAPS = {
  CORE: 0.80,
  ETF: 0.80,
  HIGH_RISK: 0.40,
  HEDGE: 1.00, // No cap — long-term holds outside normal rules
} as const;

export const POSITION_SIZE_CAPS = {
  CORE: 0.16,
  ETF: 0.16,
  HIGH_RISK: 0.12,
  HEDGE: 0.20, // Flexible sizing for long-term conviction
} as const;

export const CLUSTER_CAP = 0.20;
export const SECTOR_CAP = 0.25;
export const SUPER_CLUSTER_CAP = 0.50; // Module 12: Super-Cluster Risk Cap
export const ATR_VOLATILITY_CAP_ALL = 8; // ATR% cap for Sleep-Well filter
export const ATR_VOLATILITY_CAP_HIGH_RISK = 7; // Stricter cap for HIGH_RISK

// ---- Enums ----
export type Sleeve = 'CORE' | 'HIGH_RISK' | 'ETF' | 'HEDGE';
export type PositionStatus = 'OPEN' | 'CLOSED';
export type ProtectionLevel = 'INITIAL' | 'BREAKEVEN' | 'LOCK_08R' | 'LOCK_1R_TRAIL';
export type MarketRegime = 'BULLISH' | 'SIDEWAYS' | 'BEARISH';
export type CandidateStatus = 'READY' | 'WATCH' | 'FAR';
export type WeeklyPhase = 'PLANNING' | 'OBSERVATION' | 'EXECUTION' | 'MAINTENANCE';
export type HealthStatus = 'GREEN' | 'YELLOW' | 'RED';

// ---- Weekly Phase Helpers ----
export function getCurrentWeeklyPhase(): WeeklyPhase {
  const day = new Date().getDay();
  switch (day) {
    case 0: return 'PLANNING';      // Sunday
    case 1: return 'OBSERVATION';    // Monday
    case 2: return 'EXECUTION';      // Tuesday
    default: return 'MAINTENANCE';   // Wed-Fri (3-6)
  }
}

export const PHASE_CONFIG: Record<WeeklyPhase, {
  label: string;
  dayLabel: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
}> = {
  PLANNING: {
    label: 'Planning Phase',
    dayLabel: 'Sunday',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.15)',
    icon: '📋',
    description: 'Review health checks, run scans, prepare execution plan',
  },
  OBSERVATION: {
    label: 'Observation Phase',
    dayLabel: 'Monday',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.15)',
    icon: '👁️',
    description: 'DO NOT TRADE — Observe market, review nightly summary',
  },
  EXECUTION: {
    label: 'Execution Phase',
    dayLabel: 'Tuesday',
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.15)',
    icon: '⚡',
    description: 'Execute planned trades with pre-trade validation',
  },
  MAINTENANCE: {
    label: 'Maintenance Phase',
    dayLabel: 'Wed-Fri',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.15)',
    icon: '🔧',
    description: 'Monitor positions, update stops, review nightly summaries',
  },
};

// ---- Protection Level Config ----
export const PROTECTION_LEVELS: Record<ProtectionLevel, {
  label: string;
  threshold: number;
  stopFormula: string;
  color: string;
}> = {
  INITIAL: {
    label: 'Initial Stop',
    threshold: 0,
    stopFormula: 'Original stop price',
    color: '#ef4444',
  },
  BREAKEVEN: {
    label: 'Breakeven',
    threshold: 1.5,
    stopFormula: 'Entry price (break even)',
    color: '#f59e0b',
  },
  LOCK_08R: {
    label: 'Lock +0.5R',
    threshold: 2.5,
    stopFormula: 'Entry + 0.5 × Initial Risk',
    color: '#3b82f6',
  },
  LOCK_1R_TRAIL: {
    label: 'Lock +1R Trail',
    threshold: 3.0,
    stopFormula: 'Entry + 1.0 × Initial Risk',
    color: '#22c55e',
  },
};

// ---- Health Check Types ----
export interface HealthCheckResult {
  id: string;
  label: string;
  category: string;
  status: HealthStatus;
  message: string;
}

export const HEALTH_CHECK_ITEMS: { id: string; label: string; category: string }[] = [
  { id: 'A1', label: 'Data Freshness', category: 'Data' },
  { id: 'A2', label: 'Duplicate Tickers', category: 'Data' },
  { id: 'A3', label: 'Column Population', category: 'Data' },
  { id: 'C1', label: 'Equity > £0', category: 'Risk' },
  { id: 'C2', label: 'Open Risk Within Cap', category: 'Risk' },
  { id: 'C3', label: 'Valid Position Sizes', category: 'Risk' },
  { id: 'D', label: 'Stop Monotonicity', category: 'Logic' },
  { id: 'E', label: 'State File Currency', category: 'Logic' },
  { id: 'F', label: 'Config Coherence', category: 'Logic' },
  // Extended checks for robustness
  { id: 'G1', label: 'Sleeve Limits', category: 'Allocation' },
  { id: 'G2', label: 'Cluster Concentration', category: 'Allocation' },
  { id: 'G3', label: 'Sector Concentration', category: 'Allocation' },
  { id: 'H1', label: 'Heartbeat Recent', category: 'System' },
  { id: 'H2', label: 'API Connectivity', category: 'System' },
  { id: 'H3', label: 'Database Integrity', category: 'System' },
  { id: 'H4', label: 'Cron Job Active', category: 'System' },
];

// ---- Stock Data ----
export interface StockQuote {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  high: number;
  low: number;
  open: number;
}

export interface TechnicalData {
  ma200: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  atr: number;
  atr20DayAgo: number;
  atrSpiking: boolean;
  atrPercent: number;
  twentyDayHigh: number;
  efficiency: number;
  relativeStrength: number;
  volumeRatio: number;
}

// ---- Scan Candidate ----
export interface ScanCandidate {
  id: string;
  ticker: string;
  name: string;
  sleeve: Sleeve;
  sector: string;
  cluster: string;
  price: number;
  priceCurrency?: string;
  technicals: TechnicalData;
  entryTrigger: number;
  stopPrice: number;
  distancePercent: number;
  status: CandidateStatus;
  rankScore: number;
  passesAllFilters: boolean;
  // Risk gate results (Stage 5)
  riskGateResults?: { passed: boolean; gate: string; message: string; current: number; limit: number }[];
  passesRiskGates?: boolean;
  // Anti-chase result (Stage 6)
  antiChaseResult?: { passed: boolean; reason: string };
  passesAntiChase?: boolean;
  shares?: number;
  riskDollars?: number;
  riskPercent?: number;
  totalCost?: number;
  filterResults: {
    priceAboveMa200: boolean;
    adxAbove20: boolean;
    plusDIAboveMinusDI: boolean;
    atrPercentBelow8: boolean;
    efficiencyAbove30: boolean;
    dataQuality: boolean;
    atrSpiking?: boolean;
    atrSpikeAction?: 'NONE' | 'SOFT_CAP' | 'HARD_BLOCK';
  };
}

// ---- Position Sizing ----
export interface PositionSizingResult {
  shares: number;
  totalCost: number;
  riskDollars: number;
  riskPercent: number;
  entryPrice: number;
  stopPrice: number;
  rPerShare: number;
}

// ---- Market Index ----
export interface MarketIndex {
  name: string;
  ticker: string;
  value: number;
  change: number;
  changePercent: number;
}

// ---- Fear & Greed ----
export interface FearGreedData {
  value: number;
  label: string;
  previousClose: number;
  oneWeekAgo: number;
  oneMonthAgo: number;
}

// ---- Nightly Summary ----
export interface NightlySummary {
  id: string;
  date: Date;
  healthStatus: HealthStatus;
  regime: MarketRegime;
  positionsCount: number;
  stopsUpdated: number;
  alertsTriggered: string[];
  candidatesFound: number;
  heartbeatOk: boolean;
}

// ---- Navigation ----
export interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Portfolio', href: '/portfolio/positions' },
  { label: 'Scan', href: '/scan' },
  { label: 'Plan', href: '/plan' },
  { label: 'Risk', href: '/risk' },
  { label: 'Settings', href: '/settings' },
];

export const PORTFOLIO_SUB_NAV: NavItem[] = [
  { label: 'Positions', href: '/portfolio/positions' },
  { label: 'Distribution', href: '/portfolio/distribution' },
];

// ============================================================
// Module Types — Python Parity
// ============================================================

// Module 2: Early Bird Entry
export interface EarlyBirdSignal {
  ticker: string;
  name: string;
  price: number;
  fiftyFiveDayHigh: number;
  rangePctile: number; // percentile in 55d range
  volumeRatio: number;
  regime: MarketRegime;
  eligible: boolean;
  reason: string;
}

// Module 3: Laggard Purge
export interface LaggardFlag {
  ticker: string;
  positionId: string;
  daysHeld: number;
  gainPercent: number;
  rMultiple: number;
  action: 'TRIM_LAGGARD' | 'TRIM' | 'WATCH';
  reason: string;
}

// Module 5 + 14: Climax Top Exit / Trim/Tighten
export interface ClimaxSignal {
  ticker: string;
  positionId: string;
  price: number;
  ma20: number;
  priceAboveMa20Pct: number;
  volumeRatio: number;
  isClimax: boolean;
  action: 'TRIM' | 'TIGHTEN' | 'NONE';
  reason: string;
}

// Module 7: Heat-Map Swap Logic
export interface SwapSuggestion {
  cluster: string;
  weakTicker: string;
  weakRMultiple: number;
  strongTicker: string;
  strongRankScore: number;
  reason: string;
}

// Module 8: Heat Check
export interface HeatCheckResult {
  cluster: string;
  positionsInCluster: number;
  avgMomentum: number;
  candidateTicker?: string;
  candidateMomentum?: number;
  blocked: boolean;
  reason: string;
}

// Module 9: Fast-Follower Re-Entry
export interface FastFollowerSignal {
  ticker: string;
  exitDate: string;
  daysSinceExit: number;
  reclaimedTwentyDayHigh: boolean;
  volumeRatio: number;
  eligible: boolean;
  reason: string;
}

// Module 10: Market Breadth Safety Valve
export interface BreadthSafetyResult {
  breadthPct: number; // % of universe above 50DMA
  threshold: number;  // 40%
  maxPositionsOverride: number | null; // null = no override
  isRestricted: boolean;
  reason: string;
}

// Module 11: Whipsaw Kill Switch
export interface WhipsawBlock {
  ticker: string;
  stopsInLast30Days: number;
  blocked: boolean;
  reason: string;
}

// Module 13: Momentum Expansion
export interface MomentumExpansionResult {
  adx: number;
  threshold: number; // 25
  expandedMaxRisk: number | null; // 8.5% or null
  isExpanded: boolean;
  reason: string;
}

// Module 15: Trades Log / Slippage
export interface TradeLogEntry {
  id: string;
  ticker: string;
  action: 'BUY' | 'SELL' | 'TRIM';
  expectedPrice: number;
  actualPrice: number | null;
  slippagePercent: number | null;
  shares: number;
  reason: string;
  createdAt: string;
}

// Module 16: Turnover Monitor
export interface TurnoverMetrics {
  tradesLast30Days: number;
  avgHoldingPeriod: number; // days
  oldestPositionAge: number; // days
  closedPositionsLast30: number;
}

// Module 17: Weekly Action Card
export interface WeeklyActionCard {
  weekOf: string;
  regime: MarketRegime;
  breadthPct: number;
  readyCandidates: { ticker: string; status: string }[];
  stopUpdates: { ticker: string; from: number; to: number }[];
  riskBudgetPct: number;
  // Rich detail objects for drill-down
  laggardDetails: LaggardFlag[];
  climaxDetails: ClimaxSignal[];
  whipsawDetails: WhipsawBlock[];
  swapDetails: SwapSuggestion[];
  fastFollowerDetails: FastFollowerSignal[];
  reentryDetails: ReEntrySignal[];
  maxPositions: number;
  notes: string[];
  // Backward-compat string arrays (used by markdown renderer)
  laggardFlags: string[];
  climaxFlags: string[];
  whipsawBlocks: string[];
  swapSuggestions: string[];
  reentrySignals: string[];
}

// Module 18: Stale Data Protection
export interface DataValidationResult {
  ticker: string;
  isValid: boolean;
  issues: string[];
  lastPriceDate?: string;
  daysSinceUpdate?: number;
  hasSpikeAnomaly?: boolean;
}

// Module 19: Dual Benchmark
export type BenchmarkTicker = 'SPY' | 'VWRL';

export interface DualRegimeResult {
  spy: { regime: MarketRegime; price: number; ma200: number };
  vwrl: { regime: MarketRegime; price: number; ma200: number };
  combined: MarketRegime;
  chopDetected: boolean;
  consecutiveDays: number;
}

// Module 20: Re-Entry Logic
export interface ReEntrySignal {
  ticker: string;
  exitDate: string;
  exitProfitR: number;
  daysSinceExit: number;
  cooldownComplete: boolean;
  reclaimedTwentyDayHigh: boolean;
  eligible: boolean;
  reason: string;
}

// Module 9 Regime Stability
export interface RegimeStabilityResult {
  currentRegime: MarketRegime | 'CHOP';
  consecutiveDays: number;
  isStable: boolean; // 3+ days
  band: { upper: number; lower: number; inBand: boolean };
  reason: string;
}

// Pyramid Add Alert
export interface PyramidAlert {
  ticker: string;
  positionId: string;
  entryPrice: number;
  currentPrice: number;
  initialRisk: number;
  atr: number | null;
  rMultiple: number;
  addsUsed: number;
  maxAdds: number;
  nextAddNumber: number;
  triggerPrice: number | null;
  allowed: boolean;
  message: string;
  priceCurrency: string;
}

// Adaptive ATR Buffer (Module 11)
export interface AdaptiveBufferResult {
  ticker: string;
  atrPercent: number;
  bufferPercent: number; // 5-20% scaled
  adjustedEntryTrigger: number;
}

// Combined Module Dashboard Status
export interface ModuleStatus {
  id: number;
  name: string;
  status: 'GREEN' | 'YELLOW' | 'RED' | 'INACTIVE';
  summary: string;
  details?: unknown;
}

export interface AllModulesResult {
  timestamp: string;
  earlyBirds: EarlyBirdSignal[];
  laggards: LaggardFlag[];
  climaxSignals: ClimaxSignal[];
  swapSuggestions: SwapSuggestion[];
  heatChecks: HeatCheckResult[];
  fastFollowers: FastFollowerSignal[];
  breadthSafety: BreadthSafetyResult;
  whipsawBlocks: WhipsawBlock[];
  regimeStability: RegimeStabilityResult;
  momentumExpansion: MomentumExpansionResult;
  dualRegime: DualRegimeResult;
  turnover: TurnoverMetrics;
  dataValidation: DataValidationResult[];
  reentrySignals: ReEntrySignal[];
  pyramidAlerts: PyramidAlert[];
  actionCard: WeeklyActionCard;
  moduleStatuses: ModuleStatus[];
}
