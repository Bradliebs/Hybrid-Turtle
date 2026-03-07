'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/causal-audit)
 * Consumes: /api/prediction/invariance
 * Risk-sensitive: NO — read-only analysis page
 * Last modified: 2026-03-07
 * Notes: Shows which signals are causally stable vs regime-dependent.
 *        Invariance bar chart, β-per-regime small multiples, recommendations.
 *        ⛔ ANALYSIS ONLY — no changes to NCS or signals.
 */

import { useEffect, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { Loader2, PlayCircle, Shield, AlertTriangle, BarChart3 } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface SignalInvariance {
  signal: string;
  invarianceScore: number;
  betaPerEnvironment: Record<string, number>;
  betaVariance: number;
  classification: 'CAUSAL' | 'MIXED' | 'SPURIOUS';
}

interface AuditResult {
  signals: SignalInvariance[];
  computedAt: string;
  sampleSize: number;
}

// ── Labels ───────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  bqsTrend: 'Trend (ADX)', bqsDirection: 'Direction (DI)',
  bqsVolatility: 'Volatility', bqsProximity: 'Proximity',
  bqsTailwind: 'Regime (DRS)', bqsRs: 'Rel. Strength',
  bqsWeeklyAdx: 'Weekly ADX', bqsBis: 'BIS',
  bqsHurst: 'Hurst', bqsVolBonus: 'Vol Bonus',
};

const classStyles = {
  CAUSAL: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Causal' },
  MIXED: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Mixed' },
  SPURIOUS: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Spurious' },
};

const ENVS = ['TRENDING', 'RANGING', 'VOLATILE', 'TRANSITION'];
const ENV_LABELS: Record<string, string> = {
  TRENDING: 'Trend', RANGING: 'Range', VOLATILE: 'Vol', TRANSITION: 'Trans',
};

// ── Components ───────────────────────────────────────────────

function InvarianceBar({ signal }: { signal: SignalInvariance }) {
  const label = LABELS[signal.signal] ?? signal.signal;
  const style = classStyles[signal.classification];
  const pct = Math.round(signal.invarianceScore * 100);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-muted-foreground w-28 truncate">{label}</span>
      <div className="flex-1 h-4 bg-navy-800/60 rounded-full overflow-hidden relative">
        <div className="absolute top-0 bottom-0 w-px bg-amber-500/30 z-10" style={{ left: '30%' }} title="0.3 threshold" />
        <div className="absolute top-0 bottom-0 w-px bg-emerald-500/30 z-10" style={{ left: '60%' }} title="0.6 threshold" />
        <div
          className={cn('h-full rounded-full transition-all duration-500',
            signal.classification === 'CAUSAL' ? 'bg-emerald-500/70' :
            signal.classification === 'MIXED' ? 'bg-amber-500/70' : 'bg-red-500/50'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-10 text-right">{pct}%</span>
      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border w-16 text-center', style.bg, style.border, style.text)}>
        {style.label}
      </span>
    </div>
  );
}

function BetaChart({ signal }: { signal: SignalInvariance }) {
  const betas = Object.entries(signal.betaPerEnvironment);
  const maxAbs = Math.max(...betas.map(([, b]) => Math.abs(b)), 0.001);

  return (
    <div className="flex items-end gap-1 h-12">
      {ENVS.map(env => {
        const beta = signal.betaPerEnvironment[env] ?? 0;
        const height = Math.abs(beta) / maxAbs * 100;
        const isPositive = beta >= 0;

        return (
          <div key={env} className="flex flex-col items-center gap-0.5 flex-1">
            <div className="relative w-full h-8 flex items-end justify-center">
              <div
                className={cn('w-full rounded-t', isPositive ? 'bg-emerald-500/50' : 'bg-red-500/50')}
                style={{ height: `${Math.max(height, 5)}%` }}
                title={`β = ${beta}`}
              />
            </div>
            <span className="text-[8px] text-muted-foreground">{ENV_LABELS[env]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function CausalAuditPage() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const data = await apiRequest<{ ok: boolean; data: { hasResult: boolean; result: AuditResult | null } }>(
          '/api/prediction/invariance'
        );
        if (data.data.hasResult && data.data.result) setResult(data.data.result);
      } catch { /* silent */ }
      finally { setLoading(false); }
    };
    fetchLatest();
  }, []);

  const runAudit = async () => {
    setRunning(true);
    try {
      const data = await apiRequest<{ ok: boolean; data: AuditResult }>(
        '/api/prediction/invariance', { method: 'POST' }
      );
      if (data.data) setResult({ signals: data.data.signals, computedAt: new Date().toISOString(), sampleSize: (data.data as unknown as { totalSamples: number }).totalSamples ?? 0 });
    } catch (e) { console.error('IRM failed:', e); }
    finally { setRunning(false); }
  };

  const causalCount = result?.signals.filter(s => s.classification === 'CAUSAL').length ?? 0;
  const spuriousCount = result?.signals.filter(s => s.classification === 'SPURIOUS').length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Causal Invariance Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              IRM analysis — identifies signals that predict across all regimes vs. regime-dependent ones
            </p>
          </div>
          <button onClick={runAudit} disabled={running}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {running ? 'Running...' : 'Run IRM Analysis'}
          </button>
        </div>

        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading...
          </div>
        ) : !result ? (
          <div className="card-surface p-8 text-center text-muted-foreground">
            <Shield className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No invariance audit yet. Click &ldquo;Run IRM Analysis&rdquo; to identify causal vs spurious signals.</p>
            <p className="text-xs mt-2">Needs ≥2 regime environments with ≥10 samples each in ScoreBreakdown.</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="card-surface p-4 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-bold text-lg">{causalCount}</span>
                <span className="text-sm text-muted-foreground">Causal</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-400 font-bold text-lg">{result.signals.length - causalCount - spuriousCount}</span>
                <span className="text-sm text-muted-foreground">Mixed</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-red-400 font-bold text-lg">{spuriousCount}</span>
                <span className="text-sm text-muted-foreground">Spurious</span>
              </div>
              <div className="ml-auto text-xs text-muted-foreground">
                {result.sampleSize} samples · {new Date(result.computedAt).toLocaleDateString()}
              </div>
            </div>

            {/* Invariance Bars */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Invariance Scores
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Higher = more stable across regimes. &lt;0.3 = spurious. 0.3–0.6 = mixed. &gt;0.6 = causal.
              </p>
              {result.signals.map(s => <InvarianceBar key={s.signal} signal={s} />)}
            </div>

            {/* β per regime chart */}
            <div className="card-surface p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                β Coefficients per Regime
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                How much each signal predicts outcomes in each regime. Similar heights = invariant.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {result.signals.map(s => (
                  <div key={s.signal} className="text-center">
                    <div className="text-[10px] text-muted-foreground mb-1">{LABELS[s.signal] ?? s.signal}</div>
                    <BetaChart signal={s} />
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendations */}
            {spuriousCount > 0 && (
              <div className="card-surface p-4">
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" /> Recommendations
                </h2>
                {result.signals.filter(s => s.classification === 'SPURIOUS').map(s => (
                  <div key={s.signal} className="flex items-center gap-2 text-sm py-1">
                    <span className="text-red-400">⚠</span>
                    <span className="text-foreground">{LABELS[s.signal] ?? s.signal}</span>
                    <span className="text-muted-foreground">— consider removing or making conditional (invariance = {((s.invarianceScore ?? 0) * 100).toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
