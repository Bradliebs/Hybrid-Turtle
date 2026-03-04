'use client';

/**
 * DEPENDENCIES
 * Consumed by: /portfolio/positions page (Distribution tab)
 * Consumes: /api/portfolio/summary
 * Risk-sensitive: NO (display only)
 * Last modified: 2026-03-03
 * Notes: Lifted from src/app/portfolio/distribution/page.tsx — identical
 *        functionality rendered inside a tab.
 */

import { useEffect, useMemo, useState } from 'react';
import KPIBanner from '@/components/portfolio/KPIBanner';
import dynamic from 'next/dynamic';

const DistributionDonut = dynamic(() => import('@/components/portfolio/DistributionDonut'), { ssr: false });
const PerformanceChart = dynamic(() => import('@/components/portfolio/PerformanceChart'), { ssr: false });
import SleeveAllocation from '@/components/portfolio/SleeveAllocation';
import { apiRequest } from '@/lib/api-client';
import { formatCurrency } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';
const palette = ['#7c3aed', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#475569'];

interface DistributionItem { name: string; value: number; }
interface PortfolioPositionSummary { ticker: string; sleeve: string; protectionLevel: string; sector?: string; cluster?: string; }
interface PortfolioSummary {
  kpis?: { totalValue: number; unrealisedPL: number; cash?: number; equity: number; openPositions: number; currency?: string };
  distributions?: { protectionLevels: DistributionItem[]; sleeves: DistributionItem[]; clusters: DistributionItem[] };
  positions?: PortfolioPositionSummary[];
  performance?: { date: string; value: number }[];
}

export default function DistributionTab() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<PortfolioSummary>(`/api/portfolio/summary?userId=${DEFAULT_USER_ID}`)
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const distributions = useMemo(() => {
    const protectionLevels = summary?.distributions?.protectionLevels || [];
    const sleeves = summary?.distributions?.sleeves || [];
    const clusters = summary?.distributions?.clusters || [];
    return {
      protection: protectionLevels.map((item, idx) => ({ name: item.name, value: item.value, color: palette[idx % palette.length] })),
      sleeves: sleeves.map((item, idx) => ({ name: item.name, value: item.value, color: palette[idx % palette.length] })),
      clusters: clusters.map((item, idx) => ({ name: item.name, value: item.value, color: palette[idx % palette.length] })),
    };
  }, [summary]);

  const totalValue = summary?.kpis?.totalValue ?? 0;
  const unrealisedPL = summary?.kpis?.unrealisedPL ?? 0;
  const cash = summary?.kpis?.cash;
  const equity = summary?.kpis?.equity ?? 0;
  const openPositions = summary?.kpis?.openPositions ?? 0;
  const currency = summary?.kpis?.currency || 'GBP';

  const sleeveAllocations = useMemo(() => {
    const sleeves = summary?.distributions?.sleeves || [];
    const total = sleeves.reduce((sum, s) => sum + s.value, 0);
    const posCount = summary?.kpis?.openPositions ?? 0;
    return sleeves.map((s, idx) => {
      const nominalMax = s.name === 'High-Risk' ? 40 : 80;
      const effectiveMax = posCount <= 3 ? 100 : nominalMax;
      return { name: s.name, used: total > 0 ? (s.value / total) * 100 : 0, max: effectiveMax, nominalMax, color: palette[idx % palette.length] };
    });
  }, [summary]);

  if (loading) {
    return (
      <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading portfolio distribution...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KPIBanner
        items={[
          { label: 'Portfolio Value', value: formatCurrency(totalValue, currency) },
          { label: 'Unrealised P&L', value: formatCurrency(unrealisedPL, currency) },
          { label: 'Available Cash', value: cash != null ? formatCurrency(cash, currency) : 'N/A' },
          { label: 'Equity', value: formatCurrency(equity, currency) },
          { label: 'Open Positions', value: String(openPositions) },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DistributionDonut
          data={distributions.protection}
          title="Protection Levels"
          centerLabel="Positions"
          centerValue={String(openPositions)}
          tickers={(summary?.positions || []).map((p) => ({ ticker: p.ticker, label: p.protectionLevel }))}
        />
        <PerformanceChart data={summary?.performance || []} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DistributionDonut
          data={distributions.sleeves}
          title="Sleeve Distribution"
          centerLabel="Sleeve Mix"
          centerValue={String(distributions.sleeves.length)}
          tickers={(summary?.positions || []).map((p) => ({
            ticker: p.ticker,
            label: p.sleeve === 'CORE' ? 'Core' : p.sleeve === 'ETF' ? 'ETF' : p.sleeve === 'HEDGE' ? 'Hedge' : 'High-Risk',
          }))}
        />
        <DistributionDonut
          data={distributions.clusters}
          title="Cluster Concentration"
          centerLabel="Clusters"
          centerValue={String(distributions.clusters.length)}
          tickers={(summary?.positions || []).map((p) => ({
            ticker: p.ticker,
            label: (p.cluster && p.cluster !== 'Unassigned' ? p.cluster : p.sector) || 'N/A',
          }))}
        />
        <SleeveAllocation sleeves={sleeveAllocations} />
      </div>
    </div>
  );
}
