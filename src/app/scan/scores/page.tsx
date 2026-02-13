'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import DualScoreKPICards from '@/components/scan/scores/DualScoreKPICards';
import NCSDistributionChart from '@/components/scan/scores/NCSDistributionChart';
import BQSvsFWSScatter from '@/components/scan/scores/BQSvsFWSScatter';
import DualScoreFilters from '@/components/scan/scores/DualScoreFilters';
import DualScoreTable from '@/components/scan/scores/DualScoreTable';
import WhyCard from '@/components/scan/scores/WhyCard';
import ScoringGuide from '@/components/scan/scores/ScoringGuide';
import type { ScoredTicker } from '@/lib/dual-score';
import { BarChart3, RefreshCw, ArrowLeft, CloudDownload, Database, FileText, GitMerge } from 'lucide-react';
import Link from 'next/link';

interface ScoresResponse {
  tickers: ScoredTicker[];
  summary: {
    total: number;
    autoYes: number;
    autoNo: number;
    conditional: number;
    avgNCS: number;
    avgBQS: number;
    avgFWS: number;
  };
  filters: { sleeves: string[]; statuses: string[] };
  source?: string;
  updatedAt: string;
}

export default function DualScoreDashboard() {
  const [data, setData] = useState<ScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState('');
  const [sleeve, setSleeve] = useState('');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState('');
  const [minNCS, setMinNCS] = useState(0);
  const [maxFWS, setMaxFWS] = useState(100);

  // Selection state
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scan/scores');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      const result: ScoresResponse = await res.json();
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  // ── Sync from Yahoo Finance ──
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/scan/snapshots/sync', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || body.error);
      setSyncMessage(body.message);
      // Reload scores from newly synced DB data
      await fetchScores();
    } catch (err) {
      setSyncMessage(`Sync failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  // ── Filtered tickers ──
  const filtered = useMemo(() => {
    if (!data) return [];
    let tickers = data.tickers;

    if (search) {
      const q = search.toLowerCase();
      tickers = tickers.filter(
        (t) =>
          t.ticker.toLowerCase().includes(q) ||
          (t.name && t.name.toLowerCase().includes(q))
      );
    }
    if (sleeve) {
      tickers = tickers.filter((t) => t.sleeve === sleeve);
    }
    if (status) {
      tickers = tickers.filter((t) => t.status === status);
    }
    if (action === 'Auto-Yes') {
      tickers = tickers.filter((t) => t.ActionNote.startsWith('Auto-Yes'));
    } else if (action === 'Auto-No') {
      tickers = tickers.filter((t) => t.ActionNote.startsWith('Auto-No'));
    } else if (action === 'Conditional') {
      tickers = tickers.filter((t) => t.ActionNote.startsWith('Conditional'));
    }
    if (minNCS > 0) {
      tickers = tickers.filter((t) => t.NCS >= minNCS);
    }
    if (maxFWS < 100) {
      tickers = tickers.filter((t) => t.FWS <= maxFWS);
    }
    return tickers;
  }, [data, search, sleeve, status, action, minNCS, maxFWS]);

  // ── Selected ticker data ──
  const selectedTickerData = useMemo(() => {
    if (!selectedTicker || !data) return null;
    return data.tickers.find((t) => t.ticker === selectedTicker) ?? null;
  }, [data, selectedTicker]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-primary-400 animate-spin" />
              <p className="text-sm text-muted-foreground">Loading scores...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Error / empty state ──
  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="card-surface p-8 text-center max-w-lg">
              <div className="text-5xl mb-4">📊</div>
              <h2 className="text-lg font-bold text-foreground mb-2">No Snapshot Data</h2>
              <p className="text-sm text-muted-foreground mb-6">
                No snapshot data available. Sync live data from Yahoo Finance or
                place a <code className="text-primary-400">master_snapshot.csv</code> in the
                Planning folder.
              </p>
              {error && (
                <p className="text-xs text-loss/80 mb-4 font-mono bg-navy-800 p-3 rounded-lg">
                  {error}
                </p>
              )}
              {syncMessage && (
                <p className="text-xs text-primary-400/80 mb-4 font-mono bg-navy-800 p-3 rounded-lg">
                  {syncMessage}
                </p>
              )}
              <div className="flex items-center justify-center gap-3">
                <Link href="/scan" className="btn-outline text-sm flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Scan
                </Link>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  {syncing ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudDownload className="w-4 h-4" />
                  )}
                  {syncing ? 'Syncing...' : 'Sync from Yahoo'}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <BarChart3 className="w-6 h-6 text-primary-400" />
              Dual Score Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
              BQS / FWS / NCS scoring — {data.summary.total} tickers scored
              {data.source && (
                <span className="inline-flex items-center gap-1 text-xs bg-navy-800 px-2 py-0.5 rounded-full">
                  {data.source === 'csv' ? (
                    <FileText className="w-3 h-3" />
                  ) : (
                    <Database className="w-3 h-3" />
                  )}
                  {data.source}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Snapshot {new Date(data.updatedAt).toLocaleString()}
            </span>
            <Link href="/scan" className="btn-outline text-sm flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Scan
            </Link>
            <Link href="/scan/cross-ref" className="btn-outline text-sm flex items-center gap-2">
              <GitMerge className="w-4 h-4" />
              Cross-Ref
            </Link>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {syncing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <CloudDownload className="w-4 h-4" />
              )}
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
            <button
              onClick={() => fetchScores()}
              className="btn-outline text-sm flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Scoring Guide */}
        <ScoringGuide />

        {/* KPI Cards */}
        <DualScoreKPICards {...data.summary} />

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <NCSDistributionChart tickers={data.tickers} />
          <BQSvsFWSScatter tickers={data.tickers} />
        </div>

        {/* Filters */}
        <DualScoreFilters
          search={search}
          onSearchChange={setSearch}
          sleeve={sleeve}
          onSleeveChange={setSleeve}
          status={status}
          onStatusChange={setStatus}
          action={action}
          onActionChange={setAction}
          minNCS={minNCS}
          onMinNCSChange={setMinNCS}
          maxFWS={maxFWS}
          onMaxFWSChange={setMaxFWS}
          sleeves={data.filters.sleeves}
          statuses={data.filters.statuses}
          resultCount={filtered.length}
        />

        {/* Table + Why Card */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
          <DualScoreTable
            tickers={filtered}
            selectedTicker={selectedTicker}
            onSelect={setSelectedTicker}
          />
          <WhyCard ticker={selectedTickerData} />
        </div>
      </main>
    </div>
  );
}
