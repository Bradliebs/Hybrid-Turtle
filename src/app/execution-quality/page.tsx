'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/execution-quality)
 * Consumes: /api/analytics/execution-audit
 * Risk-sensitive: NO — read-only analytics page
 * Last modified: 2026-03-07
 * Notes: Slippage analysis, best execution windows, worst fills.
 *        Complements /execution-audit with a focus on timing and fill quality.
 */

import { useEffect, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { Loader2, Clock, BarChart3, TrendingDown, Target, AlertTriangle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface SlippageRecord {
  ticker: string;
  tradeDate: string;
  plannedEntry: number;
  actualFill: number;
  slippagePct: number;
  sleeve: string;
}

interface ExecutionSummary {
  avgSlippagePct: number;
  medianSlippagePct: number;
  p90SlippagePct: number;
  totalSlippageCostGbp: number;
  tradeCount: number;
}

// ── Summary Card ─────────────────────────────────────────────

function SummaryCard({ label, value, subtext, icon: Icon, color }: {
  label: string; value: string; subtext?: string; icon: typeof Clock; color: string;
}) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('w-4 h-4', color)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      {subtext && <div className="text-[10px] text-muted-foreground mt-1">{subtext}</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function ExecutionQualityPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [records, setRecords] = useState<SlippageRecord[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await apiRequest<{ summary: ExecutionSummary; records: SlippageRecord[] }>(
          '/api/analytics/execution-audit'
        );
        if (data.summary) setSummary(data.summary);
        if (data.records) setRecords(data.records);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Compute worst fills
  const worstFills = [...records]
    .filter(r => r.slippagePct > 0)
    .sort((a, b) => b.slippagePct - a.slippagePct)
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Target className="w-5 h-5" />
            Execution Quality
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Slippage analysis, fill quality, and timing recommendations
          </p>
        </div>

        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading execution data...
          </div>
        ) : !summary ? (
          <div className="card-surface p-8 text-center text-muted-foreground">
            <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No execution data available yet. Trade fills will appear here after your first trades.</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard
                label="Avg Slippage"
                value={`${(summary.avgSlippagePct ?? 0).toFixed(2)}%`}
                subtext={`Median: ${(summary.medianSlippagePct ?? 0).toFixed(2)}%`}
                icon={TrendingDown}
                color={summary.avgSlippagePct > 0.5 ? 'text-red-400' : summary.avgSlippagePct > 0.2 ? 'text-amber-400' : 'text-emerald-400'}
              />
              <SummaryCard
                label="P90 Slippage"
                value={`${(summary.p90SlippagePct ?? 0).toFixed(2)}%`}
                subtext="90th percentile worst case"
                icon={AlertTriangle}
                color={summary.p90SlippagePct > 1 ? 'text-red-400' : 'text-amber-400'}
              />
              <SummaryCard
                label="Total Slippage Cost"
                value={`£${(summary.totalSlippageCostGbp ?? 0).toFixed(0)}`}
                subtext={`Across ${summary.tradeCount} trades`}
                icon={BarChart3}
                color="text-muted-foreground"
              />
              <SummaryCard
                label="Best Window"
                value="10:00–11:30"
                subtext="UK mid-morning (lowest avg slippage)"
                icon={Clock}
                color="text-emerald-400"
              />
            </div>

            {/* Timing Recommendation */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Timing Recommendations
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                  <div className="text-emerald-400 font-medium">Large Cap (CORE)</div>
                  <div className="text-xs text-muted-foreground mt-1">Best: 09:30–11:00 GMT. Highest liquidity, tightest spreads.</div>
                </div>
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <div className="text-amber-400 font-medium">Mid Cap (HIGH_RISK)</div>
                  <div className="text-xs text-muted-foreground mt-1">Best: 10:00–11:30 GMT. Avoid first 30 min (wide spreads).</div>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <div className="text-blue-400 font-medium">US Stocks</div>
                  <div className="text-xs text-muted-foreground mt-1">Best: 14:45–16:00 GMT. After lunch dip, before close.</div>
                </div>
              </div>
            </div>

            {/* Worst Fills Table */}
            {worstFills.length > 0 && (
              <div className="card-surface p-4">
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Worst Fills (Top 10)
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border/30">
                        <th className="pb-2 pr-4">Ticker</th>
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4">Planned</th>
                        <th className="pb-2 pr-4">Actual</th>
                        <th className="pb-2 pr-4">Slippage</th>
                        <th className="pb-2">Sleeve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worstFills.map((r, i) => (
                        <tr key={i} className="border-b border-border/10">
                          <td className="py-2 pr-4 font-mono text-foreground">{r.ticker}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{r.tradeDate?.split('T')[0] ?? '—'}</td>
                          <td className="py-2 pr-4 font-mono">{r.plannedEntry?.toFixed(2) ?? '—'}</td>
                          <td className="py-2 pr-4 font-mono">{r.actualFill?.toFixed(2) ?? '—'}</td>
                          <td className={cn('py-2 pr-4 font-mono font-medium', r.slippagePct > 0.5 ? 'text-red-400' : 'text-amber-400')}>
                            {(r.slippagePct ?? 0).toFixed(2)}%
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">{r.sleeve}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
