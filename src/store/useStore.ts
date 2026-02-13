import { create } from 'zustand';
import type {
  HealthStatus,
  MarketRegime,
  WeeklyPhase,
  RiskProfileType,
  MarketIndex,
  FearGreedData,
  NightlySummary,
  AllModulesResult,
} from '@/types';
import { getCurrentWeeklyPhase } from '@/types';

// ── Cache staleness window (ms) ──
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// ---- Store Types ----
interface Position {
  id: string;
  ticker: string;
  name: string;
  sleeve: string;
  status: 'OPEN' | 'CLOSED';
  entryPrice: number;
  entryDate: string;
  shares: number;
  stopLoss: number;
  initialRisk: number;
  currentStop: number;
  protectionLevel: string;
  exitPrice?: number;
  exitDate?: string;
  exitReason?: string;
  currentPrice?: number;
  rMultiple?: number;
  gainPercent?: number;
  gainDollars?: number;
  value?: number;
  sector?: string;
  cluster?: string;
}

interface AppState {
  // System State
  healthStatus: HealthStatus;
  marketRegime: MarketRegime;
  weeklyPhase: WeeklyPhase;
  lastHeartbeat: Date | null;
  heartbeatOk: boolean;

  // User State
  riskProfile: RiskProfileType;
  equity: number;
  userId: string | null;

  // Market Data
  marketIndices: MarketIndex[];
  fearGreed: FearGreedData | null;

  // Portfolio State
  positions: Position[];
  totalValue: number;
  totalGain: number;
  totalGainPercent: number;
  dailyGain: number;
  dailyGainPercent: number;
  cash: number;

  // UI State
  isLoading: boolean;
  error: string | null;
  healthOverlayDismissed: boolean;

  // Cached API Data
  modulesData: AllModulesResult | null;
  modulesFetchedAt: number; // timestamp ms
  modulesFetching: boolean;
  marketDataFetchedAt: number;

  // Actions
  setHealthStatus: (status: HealthStatus) => void;
  setMarketRegime: (regime: MarketRegime) => void;
  setWeeklyPhase: (phase: WeeklyPhase) => void;
  setHeartbeat: (timestamp: Date) => void;
  setRiskProfile: (profile: RiskProfileType) => void;
  setEquity: (equity: number) => void;
  setUserId: (id: string) => void;
  setMarketIndices: (indices: MarketIndex[]) => void;
  setFearGreed: (data: FearGreedData) => void;
  setPositions: (positions: Position[]) => void;
  updatePosition: (id: string, updates: Partial<Position>) => void;
  setPortfolioMetrics: (metrics: {
    totalValue: number;
    totalGain: number;
    totalGainPercent: number;
    dailyGain: number;
    dailyGainPercent: number;
    cash: number;
  }) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  dismissHealthOverlay: () => void;

  // Cache actions
  setModulesData: (data: AllModulesResult) => void;
  setModulesFetching: (fetching: boolean) => void;
  isModulesStale: () => boolean;
  setMarketDataFetchedAt: (ts: number) => void;
  isMarketDataStale: () => boolean;
}

export const useStore = create<AppState>((set) => ({
  // System State
  healthStatus: 'YELLOW',
  marketRegime: 'SIDEWAYS',
  weeklyPhase: getCurrentWeeklyPhase(),
  lastHeartbeat: null,
  heartbeatOk: false,

  // User State
  riskProfile: 'BALANCED',
  equity: 10000,
  userId: null,

  // Market Data
  marketIndices: [],
  fearGreed: null,

  // Portfolio State (demo data)
  positions: [],
  totalValue: 0,
  totalGain: 0,
  totalGainPercent: 0,
  dailyGain: 0,
  dailyGainPercent: 0,
  cash: 10000,

  // UI State
  isLoading: false,
  error: null,
  healthOverlayDismissed: false,

  // Cached API Data
  modulesData: null,
  modulesFetchedAt: 0,
  modulesFetching: false,
  marketDataFetchedAt: 0,

  // Actions
  setHealthStatus: (status) =>
    set((state) => ({
      healthStatus: status,
      healthOverlayDismissed:
        status === 'RED' && state.healthStatus !== 'RED'
          ? false
          : state.healthOverlayDismissed,
    })),
  setMarketRegime: (regime) => set({ marketRegime: regime }),
  setWeeklyPhase: (phase) => set({ weeklyPhase: phase }),
  setHeartbeat: (timestamp) =>
    set({
      lastHeartbeat: timestamp,
      heartbeatOk: Date.now() - timestamp.getTime() < 25 * 60 * 60 * 1000, // 25 hours
    }),
  setRiskProfile: (profile) => set({ riskProfile: profile }),
  setEquity: (equity) => set({ equity }),
  setUserId: (id) => set({ userId: id }),
  setMarketIndices: (indices) => set({ marketIndices: indices }),
  setFearGreed: (data) => set({ fearGreed: data }),
  setPositions: (positions) => set({ positions }),
  updatePosition: (id, updates) =>
    set((state) => ({
      positions: state.positions.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),
  setPortfolioMetrics: (metrics) => set(metrics),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  dismissHealthOverlay: () => set({ healthOverlayDismissed: true }),

  // Cache actions
  setModulesData: (data) => set({ modulesData: data, modulesFetchedAt: Date.now(), modulesFetching: false }),
  setModulesFetching: (fetching) => set({ modulesFetching: fetching }),
  isModulesStale: () => {
    const state = useStore.getState();
    return !state.modulesData || Date.now() - state.modulesFetchedAt > CACHE_TTL;
  },
  setMarketDataFetchedAt: (ts) => set({ marketDataFetchedAt: ts }),
  isMarketDataStale: () => {
    const state = useStore.getState();
    return Date.now() - state.marketDataFetchedAt > CACHE_TTL;
  },
}));
