'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/trade-pulse/[ticker])
 * Consumes: /api/prediction/trade-pulse, TradePulseGrade components
 * Risk-sensitive: NO — read-only analysis dashboard
 * Last modified: 2026-03-07
 * Notes: Full unified confidence dashboard per ticker.
 *        Hero dial → decision bar → signal grid → concerns → opportunities.
 *        Progressive disclosure: grade at top, detail on scroll.
 *        Concerns before opportunities (risks first).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { Loader2, ArrowLeft, AlertTriangle, CheckCircle2, BarChart3 } from 'lucide-react';
import { TradePulseDial } from '@/components/TradePulseGrade';
import { GRADE_STYLES, type TradePulseGrade } from '@/lib/prediction/trade-pulse';
import KellySizePanel, { useKellySize } from '@/components/KellySizePanel';
import TradeAdvisorPanel, { useTradeRecommendation } from '@/components/TradeAdvisorPanel';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────────

interface SignalContribution {
  name: string;
  shortName: string;
  score: number;
  weight: number;
  status: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'UNAVAILABLE';
  detail?: string;
}

interface TradePulseData {
  ticker: string;
  score: number;
  grade: TradePulseGrade;
  decision: string;
  signals: SignalContribution[];
  concerns: string[];
  opportunities: string[];
  computedAt: string;
}

// ── Signal Card ──────────────────────────────────────────────

const statusIcons: Record<string, { icon: string; color: string }> = {
  POSITIVE: { icon: '✓', color: 'text-emerald-400' },
  NEUTRAL: { icon: '─', color: 'text-muted-foreground' },
  NEGATIVE: { icon: '✕', color: 'text-red-400' },
  UNAVAILABLE: { icon: '?', color: 'text-muted-foreground/40' },
};

function SignalCard({ signal }: { signal: SignalContribution }) {
  const si = statusIcons[signal.status] ?? statusIcons.NEUTRAL;
  const pct = Math.round(signal.score);

  return (
    <div className={cn(
      'p-3 rounded-lg border',
      signal.status === 'POSITIVE' ? 'bg-emerald-500/5 border-emerald-500/20' :
      signal.status === 'NEGATIVE' ? 'bg-red-500/5 border-red-500/20' :
      'bg-navy-900/40 border-border/30'
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{signal.shortName}</span>
        <span className={cn('text-sm font-bold', si.color)}>{si.icon} {pct}</span>
      </div>
      <div className="h-1.5 bg-navy-800/60 rounded-full overflow-hidden mb-1">
        <div
          className={cn('h-full rounded-full',
            signal.status === 'POSITIVE' ? 'bg-emerald-500/70' :
            signal.status === 'NEGATIVE' ? 'bg-red-500/70' : 'bg-muted-foreground/30'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[9px] text-muted-foreground truncate">{signal.detail ?? signal.name}</div>
      <div className="text-[9px] text-muted-foreground/50 mt-0.5">Weight: {Math.round(signal.weight * 100)}%</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function TradePulsePage() {
  const params = useParams();
  const ticker = typeof params.ticker === 'string' ? params.ticker : '';
  const [data, setData] = useState<TradePulseData | null>(null);
  const [loading, setLoading] = useState(true);

  // Kelly sizing advisory
  const kellyData = useKellySize(data ? { ncs: data.score, maxRisk: 2 } : null);

  // RL trade recommendation (advisory only)
  const rlData = useTradeRecommendation(data ? {
    rMultiple: 0,
    daysInTrade: 0,
    stopDistanceAtr: 1,
    ncs: data.score,
  } : null);

  // Stale check: data older than 30 minutes
  const isStale = data ? (Date.now() - new Date(data.computedAt).getTime() > 30 * 60 * 1000) : false;

  useEffect(() => {
    if (!ticker) return;

    const fetchPulse = async () => {
      try {
        // Fetch cross-ref data to get this ticker's real NCS/FWS/danger scores
        const crossRef = await apiRequest<{ tickers?: Array<{
          ticker: string;
          dualNCS: number | null;
          dualFWS: number | null;
          dualBQS: number | null;
        }> }>('/api/scan/cross-ref');

        const match = crossRef.tickers?.find(t => t.ticker === ticker);
        const ncs = match?.dualNCS ?? 50;
        const fws = match?.dualFWS ?? 30;

        // Fetch global danger level
        let danger = 0;
        try {
          const dangerRes = await apiRequest<{ ok: boolean; data: { dangerScore: number } }>('/api/prediction/danger-level');
          if (dangerRes.data) danger = dangerRes.data.dangerScore;
        } catch {
          // Non-critical — default to 0
        }

        const qs = new URLSearchParams({ ticker, ncs: String(ncs), fws: String(fws), danger: String(danger) });
        const result = await apiRequest<{ ok: boolean; data: TradePulseData }>(
          `/api/prediction/trade-pulse?${qs}`
        );
        if (result.data) setData(result.data);
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    };

    fetchPulse();
  }, [ticker]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Back link */}
        <Link href="/plan" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Plan
        </Link>

        {loading ? (
          <div className="card-surface p-12 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Analysing {ticker}...
          </div>
        ) : !data ? (
          <div className="card-surface p-12 text-center text-muted-foreground">
            <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No analysis available for {ticker}.</p>
          </div>
        ) : (
          <>
            {/* Stale data warning */}
            {isStale && (
              <div className="px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Data is stale (&gt;30 minutes old). Consider re-scanning.
              </div>
            )}

            {/* ── Hero: Score Dial ── */}
            <div className="card-surface p-6 flex flex-col items-center">
              <h1 className="text-lg font-bold text-foreground mb-1">{ticker}</h1>
              <p className="text-sm text-muted-foreground mb-4">TradePulse Analysis</p>
              <TradePulseDial score={data.score} grade={data.grade} decision={data.decision} />
            </div>

            {/* ── Concerns (risks first) ── */}
            {data.concerns.length > 0 && (
              <div className="card-surface p-4">
                <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Concerns ({data.concerns.length})
                </h2>
                <div className="space-y-1.5">
                  {data.concerns.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-red-400">
                      <span className="mt-0.5">⚠</span>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Opportunities ── */}
            {data.opportunities.length > 0 && (
              <div className="card-surface p-4">
                <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Confirming Signals ({data.opportunities.length})
                </h2>
                <div className="space-y-1.5">
                  {data.opportunities.map((o, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-emerald-400">
                      <span className="mt-0.5">✓</span>
                      <span>{o}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Signal Grid ── */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Signal Breakdown
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {data.signals.map(s => (
                  <SignalCard key={s.shortName} signal={s} />
                ))}
              </div>
            </div>

            {/* ── Kelly Advisor Row ── */}
            {kellyData.hasResult && (
              <KellySizePanel data={kellyData} />
            )}

            {/* ── RL Recommendation ── */}
            {rlData.hasResult && (
              <TradeAdvisorPanel data={rlData} />
            )}

            {/* ── Footer ── */}
            <div className="text-center text-xs text-muted-foreground pb-4">
              Computed: {new Date(data.computedAt).toLocaleString()} · {data.signals.length} signals analysed
            </div>
          </>
        )}
      </main>
    </div>
  );
}
