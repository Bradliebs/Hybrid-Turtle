'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/shared/Navbar';
import KPIBanner from '@/components/portfolio/KPIBanner';
import PositionsTable from '@/components/portfolio/PositionsTable';
import T212SyncPanel from '@/components/portfolio/T212SyncPanel';
import StopUpdateQueue from '@/components/plan/StopUpdateQueue';
import { formatCurrency, formatPercent } from '@/lib/utils';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PORTFOLIO_SUB_NAV } from '@/types';
import { apiRequest } from '@/lib/api-client';
import { Loader2 } from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

interface PositionData {
  id: string;
  ticker: string;
  name: string;
  sleeve: string;
  status: string;
  entryPrice: number;
  entryDate: string;
  shares: number;
  currentStop: number;
  initialRisk: number;
  protectionLevel: string;
  currentPrice: number;
  rMultiple: number;
  gainPercent: number;
  gainDollars: number;
  value: number;
  initialRiskGBP: number;
  riskGBP?: number;
  priceCurrency: string;
  source: string;
  stock?: { ticker: string; name: string; sleeve: string };
}

interface PositionApiResponse {
  id: string;
  stock?: { ticker: string; name: string; sleeve: string };
  t212Ticker?: string;
  status: string;
  entryPrice: number;
  entryDate: string;
  shares: number;
  currentStop?: number;
  stopLoss?: number;
  initialRisk?: number;
  protectionLevel?: string;
  currentPrice?: number;
  rMultiple?: number;
  gainPercent?: number;
  gainDollars?: number;
  value?: number;
  initialRiskGBP?: number;
  riskGBP?: number;
  priceCurrency?: string;
  source?: string;
}

interface AccountData {
  totalValue: number | null;
  cash: number | null;
  invested: number | null;
  unrealisedPL: number | null;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('GBP');
  const [stopRefreshKey, setStopRefreshKey] = useState(0);

  // Fetch T212 positions from the database (enriched with live Yahoo prices)
  const fetchPositions = useCallback(async () => {
    try {
      const data = await apiRequest<PositionApiResponse[]>(
        `/api/positions?userId=${DEFAULT_USER_ID}&source=trading212&status=OPEN`
      );

      // Map API response to table format
      const mapped: PositionData[] = data.map((p) => ({
        id: p.id,
        ticker: p.stock?.ticker || p.t212Ticker || 'N/A',
        name: p.stock?.name || '',
        sleeve: p.stock?.sleeve || 'CORE',
        status: p.status,
        entryPrice: p.entryPrice,
        entryDate: p.entryDate,
        shares: p.shares,
        currentStop: p.currentStop || p.stopLoss || 0,
        initialRisk: p.initialRisk || 0,
        protectionLevel: p.protectionLevel || 'INITIAL',
        currentPrice: p.currentPrice || p.entryPrice,
        rMultiple: p.rMultiple || 0,
        gainPercent: p.gainPercent || 0,
        gainDollars: p.gainDollars || 0,
        value: p.value || (p.currentPrice ?? p.entryPrice) * p.shares,
        initialRiskGBP: p.initialRiskGBP ?? p.riskGBP ?? 0,
        riskGBP: p.riskGBP,
        priceCurrency: p.priceCurrency || 'GBP',
        source: p.source || 'trading212',
      }));

      setPositions(mapped);
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    }
  }, []);

  // Fetch T212 account summary (cached from last sync)
  const fetchAccount = useCallback(async () => {
    try {
      const data = await apiRequest<{ lastSync?: string; currency?: string; account?: AccountData }>(`/api/trading212/sync?userId=${DEFAULT_USER_ID}`);
      if (data.lastSync) {
        setLastSync(data.lastSync);
      }
      if (data.currency) {
        setCurrency(data.currency);
      }
      if (data.account) {
        setAccount(data.account);
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
    }
  }, []);

  // Load everything on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchPositions(), fetchAccount()]);
      setLoading(false);
    };
    load();
  }, [fetchPositions, fetchAccount]);

  // When T212 sync completes, refetch positions and account + refresh stop recs
  const handleSyncComplete = useCallback(async () => {
    await Promise.all([fetchPositions(), fetchAccount()]);
    setStopRefreshKey((k) => k + 1);
  }, [fetchPositions, fetchAccount]);

  // ── Action handlers for PositionsTable ──
  const handleUpdateStop = useCallback(async (positionId: string, newStop: number, reason: string): Promise<boolean> => {
    try {
      await apiRequest('/api/stops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, newStop, reason }),
      });
      await fetchPositions();
      setStopRefreshKey((k) => k + 1);
      return true;
    } catch {
      return false;
    }
  }, [fetchPositions]);

  const handleExitPosition = useCallback(async (positionId: string, exitPrice: number): Promise<boolean> => {
    try {
      await apiRequest('/api/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, exitPrice }),
      });
      await Promise.all([fetchPositions(), fetchAccount()]);
      return true;
    } catch {
      return false;
    }
  }, [fetchPositions, fetchAccount]);

  // Use T212 account summary for portfolio KPIs (properly currency-converted)
  const openPositions = positions.filter((p) => p.status === 'OPEN');
  const totalValue = account?.totalValue ?? 0;
  const unrealisedPL = account?.unrealisedPL ?? 0;
  const cash = account?.cash ?? 0;
  const invested = account?.invested ?? 0;
  const plPercent = invested > 0 ? (unrealisedPL / invested) * 100 : 0;

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
                  item.href === '/portfolio/positions'
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
        {/* KPI Row */}
        <KPIBanner
          items={[
            { label: 'Portfolio Value', value: formatCurrency(totalValue, currency), prefix: '' },
            {
              label: 'Unrealised P&L',
              value: formatCurrency(unrealisedPL, currency),
              change: plPercent,
              changeLabel: formatPercent(plPercent),
            },
            { label: 'Cash', value: formatCurrency(cash, currency), prefix: '' },
            { label: 'Invested', value: formatCurrency(invested, currency), prefix: '' },
            { label: 'Open Positions', value: String(openPositions.length), prefix: '' },
            {
              label: 'Last Synced',
              value: lastSync
                ? new Date(lastSync).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Never',
            },
          ]}
        />

        {/* Trading 212 Sync Panel */}
        <T212SyncPanel onSyncComplete={handleSyncComplete} />

        {/* Stop-Loss Recommendations — fetches live from /api/stops */}
        <StopUpdateQueue userId={DEFAULT_USER_ID} onApplied={fetchPositions} refreshTrigger={stopRefreshKey} />

        {/* Loading state */}
        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading positions with live prices...</span>
          </div>
        ) : openPositions.length === 0 ? (
          <div className="card-surface p-8 text-center text-muted-foreground">
            <p className="text-sm">No open positions. Click &ldquo;Sync Positions&rdquo; to import from Trading 212.</p>
          </div>
        ) : (
          <PositionsTable
            positions={positions}
            onUpdateStop={handleUpdateStop}
            onExitPosition={handleExitPosition}
          />
        )}
      </main>
    </div>
  );
}
