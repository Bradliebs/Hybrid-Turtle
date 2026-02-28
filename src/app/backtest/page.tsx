'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/backtest)
 * Consumes: /api/backtest, shared components (Navbar, RegimeBadge, StatusBadge)
 * Risk-sensitive: NO — read-only signal audit page
 * Last modified: 2026-02-28
 * Notes: Signal Replay page. Shows historical trigger hits from existing
 *        SnapshotTicker data with forward R-multiples and stop ladder simulation.
 *        No position creation, no Yahoo Finance calls, no DB writes.
 */

import { useEffect, useState, useMemo } from 'react';
import Navbar from '@/components/shared/Navbar';
import RegimeBadge from '@/components/shared/RegimeBadge';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import type { MarketRegime } from '@/types';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Filter,
  Loader2,
  Target,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface ForwardReturn {
  date: string;
  close: number;
  rMultiple: number;
  daysDelta: number;
}

interface SignalHit {
  ticker: string;
  name: string;
  sleeve: string;
  signalDate: string;
  entryPrice: number;
  entryTrigger: number;
  stopLevel: number;
  riskPerShare: number;
  regime: string;
  regimeStable: boolean;
  bqs: number;
  fws: number;
  ncs: number;
  actionNote: string;
  atrPct: number;
  adx: number;
  bps: number;
  fwd5: ForwardReturn | null;
  fwd10: ForwardReturn | null;
  fwd20: ForwardReturn | null;
  stopHit: boolean;
  stopHitDate: string | null;
  stopHitR: number | null;
  maxFavorableR: number | null;
  maxAdverseR: number | null;
}

interface BacktestMeta {
  snapshotCount: number;
  totalSignals: number;
  displayedSignals: number;
  withOutcomes: number;
  avgR20: number | null;
  winRate: number | null;
  stopsHit: number;
  stopsHitPct: number | null;
  avgMaxFavorableR: number | null;
  avgMaxAdverseR: number | null;
}

interface BacktestResponse {
  ok: boolean;
  signals: SignalHit[];
  meta: BacktestMeta;
}

// ── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function rBadge(r: number | null | undefined): { text: string; className: string } {
  if (r == null) return { text: '—', className: 'text-muted-foreground' };
  const sign = r >= 0 ? '+' : '';
  const text = `${sign}${r.toFixed(2)}R`;
  if (r >= 1.0) return { text, className: 'text-profit font-semibold' };
  if (r >= 0) return { text, className: 'text-profit/80' };
  if (r > -1.0) return { text, className: 'text-warning' };
  return { text, className: 'text-loss font-semibold' };
}

function ncsBadge(ncs: number): string {
  if (ncs >= 70) return 'text-profit bg-profit/15 border-profit/30';
  if (ncs >= 50) return 'text-blue-400 bg-blue-500/15 border-blue-500/30';
  if (ncs >= 30) return 'text-warning bg-warning/15 border-warning/30';
  return 'text-loss bg-loss/15 border-loss/30';
}

function fwsBadge(fws: number): string {
  if (fws <= 30) return 'text-profit';
  if (fws <= 50) return 'text-warning';
  return 'text-loss font-semibold';
}

// ── Component ────────────────────────────────────────────────

export default function BacktestPage() {
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [tickerFilter, setTickerFilter] = useState('');
  const [sleeveFilter, setSleeveFilter] = useState('');
  const [regimeFilter, setRegimeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [sortField, setSortField] = useState<'date' | 'ncs' | 'bps' | 'fwd20' | 'maxFav'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (sleeveFilter) params.set('sleeve', sleeveFilter);
        if (regimeFilter) params.set('regime', regimeFilter);
        params.set('limit', '500');

        const result = await apiRequest<BacktestResponse>(`/api/backtest?${params.toString()}`);
        setData(result);
      } catch (err) {
        setError((err as Error).message || 'Failed to load signal replay data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [sleeveFilter, regimeFilter]);

  // Client-side filtering and sorting
  const filteredSignals = useMemo(() => {
    if (!data?.signals) return [];

    let signals = data.signals;

    // Ticker text search
    if (tickerFilter) {
      const q = tickerFilter.toUpperCase();
      signals = signals.filter(
        (s) => s.ticker.toUpperCase().includes(q) || s.name.toUpperCase().includes(q)
      );
    }

    // Action note filter
    if (actionFilter) {
      signals = signals.filter((s) => {
        if (actionFilter === 'auto-yes') return s.actionNote.startsWith('Auto-Yes');
        if (actionFilter === 'auto-no') return s.actionNote.startsWith('Auto-No');
        if (actionFilter === 'conditional') return s.actionNote.startsWith('Conditional');
        return true;
      });
    }

    // Sort
    signals = [...signals].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp = new Date(a.signalDate).getTime() - new Date(b.signalDate).getTime();
          break;
        case 'ncs':
          cmp = a.ncs - b.ncs;
          break;
        case 'bps':
          cmp = a.bps - b.bps;
          break;
        case 'fwd20':
          cmp = (a.fwd20?.rMultiple ?? -999) - (b.fwd20?.rMultiple ?? -999);
          break;
        case 'maxFav':
          cmp = (a.maxFavorableR ?? -999) - (b.maxFavorableR ?? -999);
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return signals;
  }, [data, tickerFilter, actionFilter, sortField, sortDir]);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'desc' ? (
      <ArrowDownRight className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ArrowUpRight className="w-3 h-3 inline ml-0.5" />
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary-500" />
              Signal Replay
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Historical trigger hits from snapshot data — signal quality audit
            </p>
          </div>
          {data?.meta && (
            <div className="text-xs text-muted-foreground text-right">
              <div>{data.meta.snapshotCount} snapshots analysed</div>
              <div>{data.meta.totalSignals} signals detected</div>
            </div>
          )}
        </div>

        {/* Summary Cards */}
        {data?.meta && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard
              label="Total Signals"
              value={String(data.meta.totalSignals)}
              icon={<Target className="w-4 h-4 text-primary-500" />}
            />
            <SummaryCard
              label="With Outcomes"
              value={String(data.meta.withOutcomes)}
              sub={data.meta.totalSignals > 0 ? `${Math.round((data.meta.withOutcomes / data.meta.totalSignals) * 100)}% tracked` : undefined}
              icon={<BarChart3 className="w-4 h-4 text-blue-400" />}
            />
            <SummaryCard
              label="Win Rate (20d)"
              value={data.meta.winRate != null ? `${data.meta.winRate}%` : '—'}
              valueClass={data.meta.winRate != null ? (data.meta.winRate >= 50 ? 'text-profit' : 'text-loss') : undefined}
              icon={<TrendingUp className="w-4 h-4 text-profit" />}
            />
            <SummaryCard
              label="Avg R (20d)"
              value={data.meta.avgR20 != null ? `${data.meta.avgR20 >= 0 ? '+' : ''}${data.meta.avgR20}R` : '—'}
              valueClass={data.meta.avgR20 != null ? (data.meta.avgR20 >= 0 ? 'text-profit' : 'text-loss') : undefined}
              icon={<Activity className="w-4 h-4 text-warning" />}
            />
            <SummaryCard
              label="Stops Hit"
              value={`${data.meta.stopsHit}`}
              sub={data.meta.stopsHitPct != null ? `${data.meta.stopsHitPct}%` : undefined}
              icon={<TrendingDown className="w-4 h-4 text-loss" />}
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filters:</span>
          </div>

          <input
            type="text"
            placeholder="Search ticker..."
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-navy-800 border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-40"
          />

          <select
            value={sleeveFilter}
            onChange={(e) => setSleeveFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-navy-800 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">All Sleeves</option>
            <option value="STOCK_CORE">Stock Core</option>
            <option value="ETF_CORE">ETF Core</option>
            <option value="STOCK_HIGH_RISK">High Risk</option>
            <option value="HEDGE">Hedge</option>
          </select>

          <select
            value={regimeFilter}
            onChange={(e) => setRegimeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-navy-800 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">All Regimes</option>
            <option value="BULLISH">Bullish</option>
            <option value="SIDEWAYS">Sideways</option>
            <option value="BEARISH">Bearish</option>
          </select>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-navy-800 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">All Actions</option>
            <option value="auto-yes">Auto-Yes</option>
            <option value="conditional">Conditional</option>
            <option value="auto-no">Auto-No</option>
          </select>

          <span className="text-xs text-muted-foreground ml-auto">
            {filteredSignals.length} signal{filteredSignals.length !== 1 ? 's' : ''} shown
          </span>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            <span className="ml-3 text-muted-foreground">Analysing snapshot history...</span>
          </div>
        )}

        {error && (
          <div className="bg-loss/10 border border-loss/30 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-loss mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-loss font-medium">Failed to load signal data</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* No data state */}
        {!loading && !error && data?.signals.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">No trigger signals found</p>
            <p className="text-sm mt-1">
              Signals appear when snapshot history shows price crossing above the entry trigger.
              <br />
              Run the nightly pipeline for a few days to build snapshot history.
            </p>
          </div>
        )}

        {/* Signal Table */}
        {!loading && !error && filteredSignals.length > 0 && (
          <div className="bg-navy-800/50 rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-navy-900/50">
                    <th
                      className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('date')}
                    >
                      Date <SortIcon field="date" />
                    </th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Ticker
                    </th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Regime
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Entry
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Stop
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Risk/sh
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      BQS
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      FWS
                    </th>
                    <th
                      className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('ncs')}
                    >
                      NCS <SortIcon field="ncs" />
                    </th>
                    <th
                      className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('bps')}
                      title="Breakout Probability Score (0–19)"
                    >
                      BPS <SortIcon field="bps" />
                    </th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Action
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      5d R
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      10d R
                    </th>
                    <th
                      className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('fwd20')}
                    >
                      20d R <SortIcon field="fwd20" />
                    </th>
                    <th
                      className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort('maxFav')}
                    >
                      Max R <SortIcon field="maxFav" />
                    </th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Max Draw
                    </th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground">
                      Stop Hit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignals.map((signal, i) => {
                    const r5 = rBadge(signal.fwd5?.rMultiple);
                    const r10 = rBadge(signal.fwd10?.rMultiple);
                    const r20 = rBadge(signal.fwd20?.rMultiple);
                    const maxFav = rBadge(signal.maxFavorableR);
                    const maxAdv = rBadge(signal.maxAdverseR);

                    // Action note → short label
                    let actionLabel = 'Cond';
                    let actionClass = 'text-warning bg-warning/15 border-warning/30';
                    if (signal.actionNote.startsWith('Auto-Yes')) {
                      actionLabel = 'Yes';
                      actionClass = 'text-profit bg-profit/15 border-profit/30';
                    } else if (signal.actionNote.startsWith('Auto-No')) {
                      actionLabel = 'No';
                      actionClass = 'text-loss bg-loss/15 border-loss/30';
                    }

                    return (
                      <tr
                        key={`${signal.ticker}-${signal.signalDate}-${i}`}
                        className={cn(
                          'border-b border-border/50 hover:bg-navy-700/30 transition-colors',
                          signal.stopHit && 'bg-loss/5'
                        )}
                      >
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {formatDate(signal.signalDate)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-foreground">{signal.ticker}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                            {signal.name}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <RegimeBadge regime={signal.regime as MarketRegime} size="sm" />
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">
                          {signal.entryPrice.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                          {signal.stopLevel.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                          {signal.riskPerShare.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-blue-400">{signal.bqs.toFixed(0)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={fwsBadge(signal.fws)}>{signal.fws.toFixed(0)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={cn(
                              'inline-flex px-1.5 py-0.5 rounded text-xs font-semibold border',
                              ncsBadge(signal.ncs)
                            )}
                          >
                            {signal.ncs.toFixed(0)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={cn(
                              'font-mono text-xs font-semibold',
                              signal.bps >= 14 ? 'text-profit' :
                              signal.bps >= 10 ? 'text-blue-400' :
                              signal.bps >= 6 ? 'text-amber-400' : 'text-muted-foreground'
                            )}
                          >
                            {signal.bps}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={cn(
                              'inline-flex px-1.5 py-0.5 rounded text-xs font-medium border',
                              actionClass
                            )}
                          >
                            {actionLabel}
                          </span>
                        </td>
                        <td className={cn('px-3 py-2.5 text-right font-mono text-xs', r5.className)}>
                          {r5.text}
                        </td>
                        <td className={cn('px-3 py-2.5 text-right font-mono text-xs', r10.className)}>
                          {r10.text}
                        </td>
                        <td className={cn('px-3 py-2.5 text-right font-mono text-xs', r20.className)}>
                          {r20.text}
                        </td>
                        <td className={cn('px-3 py-2.5 text-right font-mono text-xs', maxFav.className)}>
                          {maxFav.text}
                        </td>
                        <td className={cn('px-3 py-2.5 text-right font-mono text-xs', maxAdv.className)}>
                          {maxAdv.text}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {signal.stopHit ? (
                            <span className="text-loss text-xs font-semibold" title={signal.stopHitDate ? `Hit ${formatDate(signal.stopHitDate)} at ${signal.stopHitR?.toFixed(2)}R` : undefined}>
                              ✕ {signal.stopHitR != null ? `${signal.stopHitR.toFixed(1)}R` : ''}
                            </span>
                          ) : (
                            <span className="text-profit/60 text-xs">✓</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Legend */}
        {!loading && !error && filteredSignals.length > 0 && (
          <div className="bg-navy-800/30 rounded-lg border border-border/50 p-4">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">How to read this table</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Signal detection:</span> Price crossed
                above the entry trigger level between consecutive snapshots.
              </div>
              <div>
                <span className="font-medium text-foreground">R-multiples:</span> Forward returns
                expressed as multiples of risk per share (entry − stop). +1R = gained 1× your risk.
              </div>
              <div>
                <span className="font-medium text-foreground">5d / 10d / 20d R:</span> Closest
                snapshot price at ~5, ~10, ~20 calendar days after signal, converted to R.
              </div>
              <div>
                <span className="font-medium text-foreground">Max R / Max Draw:</span> Best and worst
                R-multiple reached at any subsequent snapshot. Stop Hit = initial or ratcheted stop
                would have been triggered.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Summary Card ─────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  icon,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="bg-navy-800/50 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={cn('text-xl font-bold', valueClass || 'text-foreground')}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
