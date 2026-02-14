'use client';

import { useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import KPIBanner from '@/components/portfolio/KPIBanner';
import DistributionDonut from '@/components/portfolio/DistributionDonut';
import PerformanceChart from '@/components/portfolio/PerformanceChart';
import SleeveAllocation from '@/components/portfolio/SleeveAllocation';
import { apiRequest } from '@/lib/api-client';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PORTFOLIO_SUB_NAV } from '@/types';
import { Loader2 } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

const palette = ['#7c3aed', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#475569'];

/** Shape of a distribution item (sleeve/cluster/protection) */
interface DistributionItem {
  name: string;
  value: number;
}

/** Shape of a position summary entry from the API */
interface PortfolioPositionSummary {
  ticker: string;
  sleeve: string;
  protectionLevel: string;
  sector?: string;
  cluster?: string;
}

/** Shape of the /api/portfolio/summary response */
interface PortfolioSummary {
  kpis?: {
    totalValue: number;
    unrealisedPL: number;
    cash?: number;
    equity: number;
    openPositions: number;
    currency?: string;
  };
  distributions?: {
    protectionLevels: DistributionItem[];
    sleeves: DistributionItem[];
    clusters: DistributionItem[];
  };
  positions?: PortfolioPositionSummary[];
  performance?: { date: string; value: number }[];
}

export default function DistributionPage() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const data = await apiRequest<PortfolioSummary>(`/api/portfolio/summary?userId=${DEFAULT_USER_ID}`);
        setSummary(data);
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  const distributions = useMemo(() => {
    const protectionLevels = summary?.distributions?.protectionLevels || [];
    const sleeves = summary?.distributions?.sleeves || [];
    const clusters = summary?.distributions?.clusters || [];

    return {
      protection: protectionLevels.map((item: DistributionItem, idx: number) => ({
        name: item.name,
        value: item.value,
        color: palette[idx % palette.length],
      })),
      sleeves: sleeves.map((item: DistributionItem, idx: number) => ({
        name: item.name,
        value: item.value,
        color: palette[idx % palette.length],
      })),
      clusters: clusters.map((item: DistributionItem, idx: number) => ({
        name: item.name,
        value: item.value,
        color: palette[idx % palette.length],
      })),
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
    const total = sleeves.reduce((sum: number, s: DistributionItem) => sum + s.value, 0);
    const posCount = summary?.kpis?.openPositions ?? 0;
    return sleeves.map((s: DistributionItem, idx: number) => {
      const nominalMax = s.name === 'High-Risk' ? 40 : 80;
      // With very few positions, relax caps — they only matter for diversification at scale
      const effectiveMax = posCount <= 3 ? 100 : nominalMax;
      return {
        name: s.name,
        used: total > 0 ? (s.value / total) * 100 : 0,
        max: effectiveMax,
        nominalMax,
        color: palette[idx % palette.length],
      };
    });
  }, [summary]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Sub-navigation */}
      <div className="border-b border-border bg-navy-900/50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          <div className="flex gap-1 py-1">
            {PORTFOLIO_SUB_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                  item.href === '/portfolio/distribution'
                    ? 'bg-primary/15 text-primary-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading portfolio distribution...</span>
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <KPIBanner
              items={[
                { label: 'Portfolio Value', value: formatCurrency(totalValue, currency) },
                { label: 'Unrealised P&L', value: formatCurrency(unrealisedPL, currency) },
                { label: 'Available Cash', value: cash != null ? formatCurrency(cash, currency) : 'N/A' },
                { label: 'Equity', value: formatCurrency(equity, currency) },
                { label: 'Open Positions', value: String(openPositions) },
              ]}
            />

            {/* First Row: Protection Level Distribution + Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DistributionDonut
                data={distributions.protection}
                title="Protection Levels"
                centerLabel="Positions"
                centerValue={String(openPositions)}
                tickers={(summary?.positions || []).map((p: PortfolioPositionSummary) => ({
                  ticker: p.ticker,
                  label: p.protectionLevel,
                }))}
              />
              <PerformanceChart data={summary?.performance || []} />
            </div>

            {/* Second Row: Sleeve + Cluster */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <DistributionDonut
                data={distributions.sleeves}
                title="Sleeve Distribution"
                centerLabel="Sleeve Mix"
                centerValue={String(distributions.sleeves.length)}
                tickers={(summary?.positions || []).map((p: PortfolioPositionSummary) => ({
                  ticker: p.ticker,
                  label: p.sleeve === 'CORE' ? 'Core' : p.sleeve === 'ETF' ? 'ETF' : p.sleeve === 'HEDGE' ? 'Hedge' : 'High-Risk',
                }))}
              />
              <DistributionDonut
                data={distributions.clusters}
                title="Cluster Concentration"
                centerLabel="Clusters"
                centerValue={String(distributions.clusters.length)}
                tickers={(summary?.positions || []).map((p: PortfolioPositionSummary) => ({
                  ticker: p.ticker,
                  label: (p.cluster && p.cluster !== 'Unassigned' ? p.cluster : p.sector) || 'N/A',
                }))}
              />
              <SleeveAllocation sleeves={sleeveAllocations} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
