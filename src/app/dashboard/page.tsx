'use client';

import { useEffect, useCallback, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import MarketIndicesBar from '@/components/dashboard/MarketIndicesBar';
import QuickActions from '@/components/dashboard/QuickActions';
import FearGreedGauge from '@/components/dashboard/FearGreedGauge';
import WeeklyPhaseIndicator from '@/components/dashboard/WeeklyPhaseIndicator';
import HealthTrafficLight from '@/components/dashboard/HealthTrafficLight';
import HeartbeatMonitor from '@/components/dashboard/HeartbeatMonitor';
import ModuleStatusPanel from '@/components/dashboard/ModuleStatusPanel';
import ActionCardWidget from '@/components/dashboard/ActionCardWidget';
import DualRegimeWidget from '@/components/dashboard/DualRegimeWidget';
import RiskModulesWidget from '@/components/dashboard/RiskModulesWidget';
import PyramidAlertsWidget from '@/components/dashboard/PyramidAlertsWidget';
import HedgeCard from '@/components/dashboard/HedgeCard';
import RegimeBadge from '@/components/shared/RegimeBadge';
import { useStore } from '@/store/useStore';
import { formatDate } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import type { FearGreedData, MarketRegime } from '@/types';
import { Bell, Play, FileText } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

interface PublicationItem {
  date: string;
  title: string;
  type: 'summary' | 'scan' | 'alert' | 'trade';
}

interface MarketIndex {
  ticker: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

export default function DashboardPage() {
  const {
    marketRegime,
    healthStatus,
    healthOverlayDismissed,
    dismissHealthOverlay,
    setMarketIndices,
    setFearGreed,
    setMarketRegime,
  } = useStore();
  const [publications, setPublications] = useState<PublicationItem[]>([]);

  const fetchLiveMarketData = useCallback(async () => {
    try {
      const [indicesResult, fgResult, regimeResult] = await Promise.allSettled([
        apiRequest<{ indices?: MarketIndex[] }>('/api/market-data?action=indices'),
        apiRequest<FearGreedData>('/api/market-data?action=fear-greed'),
        apiRequest<{ regime?: MarketRegime }>('/api/market-data?action=regime'),
      ]);

      if (indicesResult.status === 'fulfilled') {
        const indicesData = indicesResult.value;
        if (indicesData.indices) setMarketIndices(indicesData.indices);
      }
      if (fgResult.status === 'fulfilled') {
        const fgData = fgResult.value;
        if (fgData.value !== undefined) setFearGreed(fgData);
      }
      if (regimeResult.status === 'fulfilled') {
        const regimeData = regimeResult.value;
        if (regimeData.regime) setMarketRegime(regimeData.regime);
      }
    } catch (err) {
      console.error('Failed to fetch live market data:', err);
    }
  }, [setMarketIndices, setFearGreed, setMarketRegime]);

  const fetchPublications = useCallback(async () => {
    try {
      const data = await apiRequest<{ publications?: PublicationItem[] }>(`/api/publications?userId=${DEFAULT_USER_ID}`);
      const items = (data.publications || []).map((item: PublicationItem) => ({
        ...item,
        date: formatDate(item.date),
      }));
      setPublications(items);
    } catch {
      // Silent fail
    }
  }, []);

  // Fetch market data + publications in parallel on mount (no auto-polling — manual refresh via MarketIndicesBar)
  useEffect(() => {
    fetchLiveMarketData();
    fetchPublications();
  }, [fetchLiveMarketData, fetchPublications]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* RED Health Warning Banner */}
      {healthStatus === 'RED' && !healthOverlayDismissed && (
        <div className="health-overlay">
          <div className="text-center max-w-lg mx-auto p-8">
            <div className="w-20 h-20 rounded-full bg-warning/20 mx-auto mb-6 flex items-center justify-center animate-pulse-red">
              <span className="text-4xl">⚠️</span>
            </div>
            <h1 className="text-3xl font-bold text-warning mb-4">SYSTEM WARNING</h1>
            <p className="text-lg text-muted-foreground mb-6">
              Health check has issues. Review the report — trading is allowed but proceed with caution.
            </p>
            <div className="flex items-center justify-center gap-3">
              <a href="/risk" className="btn-danger inline-flex items-center gap-2">
                View Health Report
              </a>
              <button
                type="button"
                onClick={dismissHealthOverlay}
                className="btn-secondary inline-flex items-center gap-2"
              >
                Continue to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Market Indices Row */}
        <MarketIndicesBar />

        {/* Weekly Phase Banner */}
        <WeeklyPhaseIndicator />

        {/* System Status Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <HealthTrafficLight />
          <div className="card-surface p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Market Regime</h3>
            <div className="flex items-center gap-3">
              <RegimeBadge regime={marketRegime} size="lg" />
              <div className="text-xs text-muted-foreground">
                {marketRegime === 'BULLISH'
                  ? 'New positions allowed'
                  : 'Caution advised — market is not bullish'}
              </div>
            </div>
          </div>
          <HeartbeatMonitor />
        </div>

        {/* Quick Actions */}
        <QuickActions />

        {/* Risk Signal Modules — Breadth, Momentum, Turnover, Whipsaw, Laggard, Climax */}
        <RiskModulesWidget />

        {/* Pyramid Add Alerts — Triggered and upcoming */}
        <PyramidAlertsWidget />

        {/* Module Status Panel — All 21 modules at a glance */}
        <ModuleStatusPanel />

        {/* Three Column Bottom */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Market Health / Fear & Greed */}
          <div>
            <FearGreedGauge />
          </div>

          {/* Center: Dual Benchmark Regime + Stability */}
          <div>
            <DualRegimeWidget />
          </div>

          {/* Right: Weekly Action Card */}
          <div>
            <ActionCardWidget />
          </div>
        </div>

        {/* Hedge Portfolio — Long-term holds with guidance */}
        <HedgeCard />

        {/* Publications/Alerts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
          <div className="card-surface p-4">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Bell className="w-4 h-4 text-warning" />
              Recent Alerts & Publications
            </h3>
            <div className="space-y-3">
              {publications.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  No recent publications yet.
                </div>
              )}
              {publications.map((pub, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-navy-600/30 transition-colors cursor-pointer group"
                >
                  <div className="flex-shrink-0">
                    {pub.type === 'summary' ? (
                      <FileText className="w-4 h-4 text-primary-400" />
                    ) : pub.type === 'scan' ? (
                      <Play className="w-4 h-4 text-profit" />
                    ) : pub.type === 'alert' ? (
                      <Bell className="w-4 h-4 text-warning" />
                    ) : (
                      <FileText className="w-4 h-4 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground group-hover:text-primary-400 transition-colors truncate">
                      {pub.title}
                    </div>
                    <div className="text-xs text-muted-foreground">{pub.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
