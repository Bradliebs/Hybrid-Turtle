/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view)
 * Consumes: /api/prediction/beliefs (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows a 7×4 grid of signal × regime beliefs.
 *        Each cell shows Beta distribution mean ± CI and observation count.
 *        Highlights cells with tight CI (high confidence) or wide CI (insufficient data).
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Brain } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface Belief {
  signal: string;
  regime: string;
  alpha: number;
  beta: number;
  mean: number;
  credibleIntervalLow: number;
  credibleIntervalHigh: number;
  nObservations: number;
}

interface BeliefData {
  beliefs: Belief[];
  loading: boolean;
  hasData: boolean;
}

// ── Labels ───────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  adx: 'ADX', di: 'DI', hurst: 'Hurst', bis: 'BIS',
  drs: 'DRS', weeklyAdx: 'wADX', bps: 'BPS',
};

const REGIME_LABELS: Record<string, string> = {
  TRENDING: 'Trend', RANGING: 'Range', VOLATILE: 'Vol', TRANSITION: 'Trans',
};

const SIGNALS = ['adx', 'di', 'hurst', 'bis', 'drs', 'weeklyAdx', 'bps'];
const REGIMES = ['TRENDING', 'RANGING', 'VOLATILE', 'TRANSITION'];

// ── Hook ─────────────────────────────────────────────────────

export function useBeliefStates(): BeliefData {
  const [data, setData] = useState<BeliefData>({ beliefs: [], loading: true, hasData: false });

  useEffect(() => {
    let cancelled = false;
    const fetchBeliefs = async () => {
      try {
        const res = await fetch('/api/prediction/beliefs');
        if (!res.ok) { if (!cancelled) setData(prev => ({ ...prev, loading: false })); return; }
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.data?.beliefs) {
          setData({ beliefs: json.data.beliefs, loading: false, hasData: true });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };
    fetchBeliefs();
    return () => { cancelled = true; };
  }, []);

  return data;
}

// ── Belief Cell ──────────────────────────────────────────────

function BeliefCell({ belief }: { belief: Belief | undefined }) {
  if (!belief) {
    return <td className="p-1 text-center text-[9px] text-muted-foreground/30">—</td>;
  }

  const ciWidth = belief.credibleIntervalHigh - belief.credibleIntervalLow;
  const isHighConf = ciWidth < 0.25 && belief.nObservations >= 10;
  const isLowData = belief.nObservations < 5;
  const isPositive = belief.mean > 0.55;
  const isNegative = belief.mean < 0.45;

  return (
    <td className={cn(
      'p-1 text-center rounded',
      isHighConf && isPositive ? 'bg-emerald-500/10' :
      isHighConf && isNegative ? 'bg-red-500/10' :
      isLowData ? 'bg-navy-800/30' : ''
    )}>
      <div className={cn(
        'text-[10px] font-mono font-medium',
        isPositive ? 'text-emerald-400' : isNegative ? 'text-red-400' : 'text-muted-foreground'
      )}>
        {((belief.mean ?? 0.5) * 100).toFixed(0)}%
      </div>
      <div className="text-[8px] text-muted-foreground/60">
        n={belief.nObservations}
      </div>
    </td>
  );
}

// ── Component ────────────────────────────────────────────────

interface BeliefStatePanelProps {
  data: BeliefData;
}

export default function BeliefStatePanel({ data }: BeliefStatePanelProps) {
  if (!data.hasData || data.beliefs.length === 0) return null;

  const getBelief = (signal: string, regime: string): Belief | undefined =>
    data.beliefs.find(b => b.signal === signal && b.regime === regime);

  return (
    <div className="mt-2 px-3 py-2 bg-navy-900/40 rounded-lg border border-border/30">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Signal Beliefs (Bayesian)
        </span>
      </div>

      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr>
            <th className="p-1 text-left text-muted-foreground font-normal" />
            {REGIMES.map(r => (
              <th key={r} className="p-1 text-center text-muted-foreground font-normal">
                {REGIME_LABELS[r] ?? r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SIGNALS.map(s => (
            <tr key={s}>
              <td className="p-1 text-muted-foreground text-right pr-2 font-mono">
                {SIGNAL_LABELS[s] ?? s}
              </td>
              {REGIMES.map(r => (
                <BeliefCell key={r} belief={getBelief(s, r)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-3 mt-1 text-[9px] text-muted-foreground/60">
        <span><span className="text-emerald-400">■</span> Reliable (&gt;55%)</span>
        <span><span className="text-red-400">■</span> Unreliable (&lt;45%)</span>
        <span><span className="text-muted-foreground">■</span> Prior (50%)</span>
      </div>
    </div>
  );
}
