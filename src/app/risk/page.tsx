'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import RiskProfileSelector from '@/components/risk/RiskProfileSelector';
import StopLossPanel from '@/components/risk/StopLossPanel';
import TrailingStopPanel from '@/components/risk/TrailingStopPanel';
import ProtectionProgress from '@/components/risk/ProtectionProgress';
import RiskBudgetMeter from '@/components/risk/RiskBudgetMeter';
import { apiRequest } from '@/lib/api-client';
import { useStore } from '@/store/useStore';
import { Shield, Lock, Loader2 } from 'lucide-react';
import type { RiskProfileType, Sleeve } from '@/types';

interface RiskPositionData {
  ticker: string;
  entryPrice: number;
  currentPrice: number;
  currentStop: number;
  initialStop: number;
  rMultiple: number;
  protectionLevel: string;
  shares: number;
  priceCurrency?: string;
  initialRiskGBP?: number;
  openRiskGBP?: number;
  // @deprecated Use initialRiskGBP instead.
  riskGBP?: number;
}

interface RiskBudget {
  usedRiskPercent: number;
  availableRiskPercent: number;
  maxRiskPercent: number;
  usedPositions: number;
  maxPositions: number;
  sleeveUtilization: Record<Sleeve, { used: number; max: number }>;
}

interface RiskSummaryResponse {
  riskProfile: RiskProfileType;
  equity: number;
  budget: RiskBudget;
  riskEfficiency: number | null;
  weeklyEquityChangePercent: number | null;
  maxOpenRiskUsedPercent: number;
  positions: RiskPositionData[];
}

const DEFAULT_USER_ID = 'default-user';

export default function RiskPage() {
  const { riskProfile, setRiskProfile, setEquity } = useStore();
  const [riskSummary, setRiskSummary] = useState<RiskSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRisk = async () => {
      try {
        const data = await apiRequest<RiskSummaryResponse>(`/api/risk?userId=${DEFAULT_USER_ID}`);
        setRiskSummary(data);
        if (data?.riskProfile) {
          setRiskProfile(data.riskProfile);
        }
        if (data?.equity) {
          setEquity(data.equity);
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    };

    fetchRisk();
  }, [setEquity, setRiskProfile]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <Shield className="w-6 h-6 text-primary-400" />
              Risk Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Position sizing, stop-loss enforcement & risk budgets
            </p>
          </div>
          <div className="flex items-center gap-2 bg-navy-700/50 px-3 py-1.5 rounded-lg">
            <Lock className="w-4 h-4 text-primary-400" />
            <span className="text-sm text-foreground font-mono">
              Profile: {riskProfile.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* NEVER rules banner */}
        <div className="bg-loss/10 border border-loss/30 rounded-lg p-4">
          <h3 className="text-sm font-bold text-loss mb-2">⚠️ Immutable Rules — Cannot Be Overridden</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="text-xs text-loss/80">• NEVER lower a stop-loss</div>
            <div className="text-xs text-loss/80">• NEVER buy without regime = BULLISH</div>
            <div className="text-xs text-loss/80">• NEVER skip the 16-point health check</div>
            <div className="text-xs text-loss/80">• NEVER chase Monday if gap &gt;0.75 ATR or &gt;3% above trigger</div>
            <div className="text-xs text-loss/80">• NEVER override sleeve/cluster caps</div>
            <div className="text-xs text-loss/80">• NEVER round position size UP</div>
            <div className="text-xs text-loss/80">• NEVER enter with $0 stop-loss</div>
            <div className="text-xs text-loss/80">• NEVER exceed max positions for profile</div>
          </div>
        </div>

        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading risk metrics...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              <RiskProfileSelector />
              <RiskBudgetMeter
                budget={riskSummary?.budget}
                equity={riskSummary?.equity}
                riskProfile={riskSummary?.riskProfile}
              />
            </div>

            {/* Middle Column */}
            <div className="space-y-6">
              <StopLossPanel positions={riskSummary?.positions} />
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <TrailingStopPanel />
              <ProtectionProgress positions={riskSummary?.positions} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
