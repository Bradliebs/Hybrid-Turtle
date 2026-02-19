'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/shared/Navbar';
import RegimeBadge from '@/components/shared/RegimeBadge';
import PhaseTimeline from '@/components/plan/PhaseTimeline';
import ReadyCandidates from '@/components/plan/ReadyCandidates';
import PreTradeChecklist from '@/components/plan/PreTradeChecklist';
import StopUpdateQueue from '@/components/plan/StopUpdateQueue';
import PositionSizerWidget from '@/components/plan/PositionSizerWidget';
import SwapSuggestionsWidget from '@/components/plan/SwapSuggestionsWidget';
import LaggardAlertsWidget from '@/components/plan/LaggardAlertsWidget';
import EarlyBirdWidget from '@/components/plan/EarlyBirdWidget';
import { useStore } from '@/store/useStore';
import { apiRequest } from '@/lib/api-client';
import { ClipboardList, Calendar, Loader2 } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

/** Shape of a position as returned by /api/positions */
interface PositionApiResponse {
  id: string;
  stock?: { ticker: string; name: string; sleeve: string };
  status: string;
  entryPrice: number;
  currentPrice?: number;
  currentStop?: number;
  stopLoss?: number;
  initialRisk?: number;
  protectionLevel?: string;
  rMultiple?: number;
  gainPercent?: number;
  shares: number;
  priceCurrency?: string;
}

/** Shape of a candidate for the ReadyCandidates widget */
interface ReadyCandidate {
  ticker: string;
  name: string;
  sleeve: string;
  status: string;
  price: number;
  entryTrigger: number;
  stopPrice: number;
  distancePercent: number;
  shares?: number;
  riskDollars?: number;
  matchType?: 'BOTH_RECOMMEND' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'CONFLICT';
  agreementScore?: number;
  dualNCS?: number;
  dualBQS?: number;
  dualFWS?: number;
  dualAction?: string;
  scanRankScore?: number;
  scanPassesFilters?: boolean;
}

/** Shape of a cross-ref ticker from /api/scan/cross-ref */
interface CrossRefTicker {
  ticker: string;
  name: string;
  sleeve: string;
  matchType: 'BOTH_RECOMMEND' | 'SCAN_ONLY' | 'DUAL_ONLY' | 'CONFLICT' | 'BOTH_REJECT';
  scanStatus?: string;
  scanPrice?: number;
  scanEntryTrigger?: number;
  scanStopPrice?: number;
  scanDistancePercent?: number;
  scanShares?: number;
  scanRiskDollars?: number;
  scanRankScore?: number;
  scanPassesFilters?: boolean;
  scanPassesRiskGates?: boolean;
  scanPassesAntiChase?: boolean;
  agreementScore?: number;
  dualNCS?: number;
  dualBQS?: number;
  dualFWS?: number;
  dualAction?: string;
  dualClose?: number;
  dualEntryTrigger?: number;
  dualStopLevel?: number;
  dualDistancePct?: number;
}

interface HealthReportData {
  overall: string;
  checks: Record<string, string>;
  results: { id: string; label: string; category: string; status: string; message: string }[];
}

interface RiskSummaryData {
  budget?: {
    maxRiskPercent: number;
    usedRiskPercent: number;
    maxPositions: number;
    usedPositions: number;
    sleeveUtilization: Record<string, { used: number; max: number }>;
  };
}

interface PositionData {
  ticker: string;
  name: string;
  sleeve: string;
  status: string;
  entryPrice: number;
  currentPrice: number;
  currentStop: number;
  initialRisk: number;
  protectionLevel: string;
  rMultiple: number;
  gainPercent: number;
  shares: number;
  priceCurrency?: string;
  stock?: { ticker: string; name: string; sleeve: string };
}

interface StopUpdate {
  ticker: string;
  currentStop: number;
  recommendedStop: number;
  protectionLevel: string;
  rMultiple: number;
  currentPrice: number;
  direction: 'up' | 'hold';
  reason: string;
  priceCurrency?: string;
}

function computeStopUpdates(positions: PositionData[]): StopUpdate[] {
  return positions.map((p) => {
    const r = p.rMultiple;
    let recommendedStop = p.currentStop;
    let protectionLevel = p.protectionLevel || 'INITIAL';
    let direction: 'up' | 'hold' = 'hold';
    let reason = '';

    if (r >= 3) {
      // Trail at 1R profit locked
      recommendedStop = p.entryPrice + p.initialRisk;
      protectionLevel = 'LOCK_1R_TRAIL';
      reason = `+${r.toFixed(1)}R → Trail to lock 1R profit`;
    } else if (r >= 1.5) {
      // Move to breakeven
      recommendedStop = p.entryPrice;
      protectionLevel = 'BREAKEVEN';
      reason = `+${r.toFixed(1)}R → Move to breakeven`;
    } else {
      reason = `Under 1.5R — keep current stop`;
    }

    if (recommendedStop > p.currentStop) {
      direction = 'up';
    }

    return {
      ticker: p.ticker,
      currentStop: p.currentStop,
      recommendedStop,
      protectionLevel,
      rMultiple: r,
      currentPrice: p.currentPrice,
      direction,
      reason,
      priceCurrency: p.priceCurrency,
    };
  });
}

export default function PlanPage() {
  const { weeklyPhase, marketRegime } = useStore();
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [stopUpdates, setStopUpdates] = useState<StopUpdate[]>([]);
  const [scanCandidates, setScanCandidates] = useState<ReadyCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [healthReport, setHealthReport] = useState<HealthReportData | null>(null);
  const [riskSummary, setRiskSummary] = useState<RiskSummaryData | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const data = await apiRequest<PositionApiResponse[]>(
        `/api/positions?userId=${DEFAULT_USER_ID}&source=trading212&status=OPEN`
      );
      const mapped: PositionData[] = data.map((p) => ({
        ticker: p.stock?.ticker || 'N/A',
        name: p.stock?.name || '',
        sleeve: p.stock?.sleeve || 'CORE',
        status: p.status,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice || p.entryPrice,
        currentStop: p.currentStop || p.stopLoss || 0,
        initialRisk: p.initialRisk || 0,
        protectionLevel: p.protectionLevel || 'INITIAL',
        rMultiple: p.rMultiple || 0,
        gainPercent: p.gainPercent || 0,
        shares: p.shares,
        priceCurrency: p.priceCurrency || 'GBP',
      }));

      setPositions(mapped);
      setStopUpdates(computeStopUpdates(mapped));
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    const fetchHealthRiskAndScan = async () => {
      try {
        const [healthResult, riskResult, crossRefResult] = await Promise.allSettled([
          apiRequest<HealthReportData>(`/api/health-check?userId=${DEFAULT_USER_ID}`),
          apiRequest<RiskSummaryData>(`/api/risk?userId=${DEFAULT_USER_ID}`),
          apiRequest<{ tickers?: CrossRefTicker[] }>('/api/scan/cross-ref'),
        ]);

        if (healthResult.status === 'fulfilled') {
          setHealthReport(healthResult.value);
        }

        if (riskResult.status === 'fulfilled') {
          setRiskSummary(riskResult.value);
        }

        if (crossRefResult.status === 'fulfilled') {
          const crossRefData = crossRefResult.value;
          // Only show actionable candidates (not BOTH_REJECT)
          const actionable = (crossRefData.tickers || []).filter(
            (t) => t.matchType !== 'BOTH_REJECT'
          );
          // Map to ReadyCandidates shape with cross-ref enrichment
          const mapped = actionable
            .filter((t) => t.scanStatus === 'READY' || t.scanStatus === 'WATCH' || t.matchType === 'DUAL_ONLY')
            .map((t) => ({
              ticker: t.ticker,
              name: t.name,
              sleeve: t.sleeve,
              status: t.scanStatus || ((t.dualNCS ?? 0) >= 70 ? 'READY' : 'WATCH'),
              price: t.scanPrice || t.dualClose || 0,
              entryTrigger: t.scanEntryTrigger || t.dualEntryTrigger || 0,
              stopPrice: t.scanStopPrice || t.dualStopLevel || 0,
              distancePercent: t.scanDistancePercent ?? t.dualDistancePct ?? 0,
              shares: t.scanShares,
              riskDollars: t.scanRiskDollars ?? undefined,
              // Cross-ref enrichment
              matchType: t.matchType === 'BOTH_REJECT' ? undefined : t.matchType,
              agreementScore: t.agreementScore,
              dualNCS: t.dualNCS,
              dualBQS: t.dualBQS,
              dualFWS: t.dualFWS,
              dualAction: t.dualAction,
              scanRankScore: t.scanRankScore,
              scanPassesFilters: t.scanPassesFilters,
              scanPassesRiskGates: t.scanPassesRiskGates,
              scanPassesAntiChase: t.scanPassesAntiChase,
            }));
          setScanCandidates(mapped);
        }
      } catch {
        // Silent fail
      }
    };

    fetchHealthRiskAndScan();
  }, []);

  // Use cross-referenced scan candidates from 7-stage engine + dual scores
  const candidates = scanCandidates;

  const hasReadyCandidates = candidates.some((c) => c.status === 'READY');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <ClipboardList className="w-6 h-6 text-primary-400" />
              Execution Plan
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Think Sunday · Observe Monday · Act Tuesday · Manage Wed–Fri
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RegimeBadge regime={marketRegime} />
            <div className="flex items-center gap-2 bg-navy-700/50 px-3 py-1.5 rounded-lg">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-foreground font-mono">
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
              </span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading positions with live prices...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              <PhaseTimeline />
              <StopUpdateQueue updates={stopUpdates} />
            </div>

            {/* Middle Column */}
            <div className="space-y-6">
              <ReadyCandidates candidates={candidates} heldTickers={new Set(positions.map(p => p.ticker))} />
              <PositionSizerWidget />
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <PreTradeChecklist
                healthReport={healthReport}
                riskBudget={riskSummary?.budget}
                hasReadyCandidates={hasReadyCandidates}
              />
              <EarlyBirdWidget />
              <SwapSuggestionsWidget />
              <LaggardAlertsWidget />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
