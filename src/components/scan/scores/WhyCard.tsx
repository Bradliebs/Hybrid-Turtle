import { memo, type ReactNode } from 'react';
import type { ScoredTicker } from '@/lib/dual-score';
import { safeNum } from '@/lib/dual-score';
import { Info } from 'lucide-react';
import GlossaryTerm from '@/components/GlossaryTerm';

interface WhyCardProps {
  ticker: ScoredTicker | null;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2.5 bg-navy-800 rounded-full overflow-hidden flex-1">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function ComponentRow({ label, value, max }: { label: string; value: number; max: number }) {
  const color = max > 0 && value / max > 0.7 ? '#22c55e' : value / max > 0.4 ? '#f59e0b' : '#94a3b8';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-28 truncate">{label}</span>
      <ProgressBar value={value} max={max} color={color} />
      <span className="text-xs font-mono text-muted-foreground w-14 text-right">
        {value.toFixed(1)}/{max}
      </span>
    </div>
  );
}

function FWSComponentRow({ label, value, max }: { label: string; value: number; max: number }) {
  // For FWS higher=worse, so reverse color logic
  const color = max > 0 && value / max > 0.7 ? '#ef4444' : value / max > 0.4 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-28 truncate">{label}</span>
      <ProgressBar value={value} max={max} color={color} />
      <span className="text-xs font-mono text-muted-foreground w-14 text-right">
        {value.toFixed(1)}/{max}
      </span>
    </div>
  );
}

function ScoreBar({ value, label, color }: { value: number; label: ReactNode; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-foreground">{label} {value.toFixed(1)}</span>
      </div>
      <div className="h-4 bg-navy-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function WhyCard({ ticker }: WhyCardProps) {
  if (!ticker) {
    return (
      <div className="card-surface p-4 h-full flex flex-col items-center justify-center gap-3 min-h-[400px]">
        <Info className="w-10 h-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground text-center">
          Click a row to see the full score breakdown
        </p>
        <p className="text-xs text-muted-foreground/60 text-center">
          The Why Card explains every component of the score
        </p>
      </div>
    );
  }

  const bqsColor = ticker.BQS >= 60 ? '#3b82f6' : ticker.BQS >= 40 ? '#f59e0b' : '#ef4444';
  const fwsColor = ticker.FWS <= 30 ? '#22c55e' : ticker.FWS <= 60 ? '#f59e0b' : '#ef4444';
  const ncsColor = ticker.NCS >= 70 ? '#22c55e' : ticker.NCS >= 40 ? '#f59e0b' : '#ef4444';

  const actionColor = ticker.ActionNote.startsWith('Auto-Yes')
    ? '#22c55e'
    : ticker.ActionNote.startsWith('Auto-No')
    ? '#ef4444'
    : '#f59e0b';

  return (
    <div className="card-surface p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Ticker Breakdown
        </h3>
      </div>

      {/* Title */}
      <div>
        <div className="text-lg font-bold text-foreground">{ticker.ticker}</div>
        <div className="text-sm text-muted-foreground">{ticker.name}</div>
      </div>

      {/* Key prices */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
          Close {safeNum(ticker.close).toFixed(2)}
        </span>
        {safeNum(ticker.entry_trigger) > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
            Entry {safeNum(ticker.entry_trigger).toFixed(2)}
          </span>
        )}
        {safeNum(ticker.stop_level) > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
            Stop {safeNum(ticker.stop_level).toFixed(2)}
          </span>
        )}
      </div>

      {/* BQS */}
      <div className="space-y-2">
        <ScoreBar value={ticker.BQS} label={<GlossaryTerm term="BQS">BQS</GlossaryTerm>} color={bqsColor} />
        <div className="bg-navy-800/50 rounded-lg p-2.5 space-y-1.5">
          <ComponentRow label="Trend (ADX)" value={ticker.bqs_trend} max={25} />
          <ComponentRow label="Direction (DI)" value={ticker.bqs_direction} max={10} />
          <ComponentRow label="Volatility" value={ticker.bqs_volatility} max={15} />
          <ComponentRow label="Proximity" value={ticker.bqs_proximity} max={15} />
          <ComponentRow label="Regime Tailwind" value={ticker.bqs_tailwind} max={20} />
          <ComponentRow label="RS Score" value={ticker.bqs_rs} max={15} />
          {ticker.bqs_vol_bonus > 0 && (
            <ComponentRow label="Vol Bonus" value={ticker.bqs_vol_bonus} max={5} />
          )}
          {ticker.bqs_weekly_adx !== 0 && (
            <ComponentRow label="Weekly ADX" value={ticker.bqs_weekly_adx} max={10} />
          )}
          {ticker.bqs_bis > 0 && (
            <ComponentRow label="Breakout Integrity" value={ticker.bqs_bis} max={15} />
          )}
          {ticker.bqs_hurst > 0 && (
            <ComponentRow label="Hurst (Persistence)" value={ticker.bqs_hurst} max={8} />
          )}
        </div>
      </div>

      {/* FWS */}
      <div className="space-y-2">
        <ScoreBar value={ticker.FWS} label={<GlossaryTerm term="FWS">FWS</GlossaryTerm>} color={fwsColor} />
        <div className="bg-navy-800/50 rounded-lg p-2.5 space-y-1.5">
          <FWSComponentRow label="Volume Risk" value={ticker.fws_volume} max={30} />
          <FWSComponentRow label="Extension Risk" value={ticker.fws_extension} max={25} />
          <FWSComponentRow label="Marginal Trend" value={ticker.fws_marginal_trend} max={10} />
          <FWSComponentRow label="Vol Shock" value={ticker.fws_vol_shock} max={20} />
          <FWSComponentRow label="Regime Instab." value={ticker.fws_regime_instability} max={10} />
        </div>
      </div>

      {/* NCS Equation */}
      <div className="space-y-2">
        <ScoreBar value={ticker.NCS} label={<GlossaryTerm term="NCS">NCS</GlossaryTerm>} color={ncsColor} />
        <div className="bg-navy-800/50 rounded-lg p-2.5 space-y-1">
          <div className="text-xs text-muted-foreground">NCS Equation</div>
          <div className="text-sm font-mono text-foreground font-bold">
            {ticker.BaseNCS.toFixed(1)} − {ticker.EarningsPenalty.toFixed(1)} − {ticker.ClusterPenalty.toFixed(1)} − {ticker.SuperClusterPenalty.toFixed(1)} = {ticker.NCS.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            BaseNCS = clamp(BQS − 0.8×FWS + 10)
          </div>
        </div>
      </div>

      {/* Earnings Warning (if applicable) */}
      {(ticker.EarningsPenalty > 0 || (ticker.days_to_earnings != null && Number(ticker.days_to_earnings) <= 5)) && (
        <div
          className="rounded-lg p-3 border-l-4"
          style={{
            borderLeftColor: Number(ticker.days_to_earnings) <= 2 ? '#ef4444' : '#f59e0b',
            backgroundColor: Number(ticker.days_to_earnings) <= 2 ? '#ef444410' : '#f59e0b10',
          }}
        >
          <div className="text-xs font-semibold text-foreground mb-1">📅 Earnings</div>
          <div className="text-sm text-muted-foreground">
            {ticker.days_to_earnings != null
              ? `Next earnings: ${Number(ticker.days_to_earnings)} day${Number(ticker.days_to_earnings) === 1 ? '' : 's'} away`
              : 'Earnings expected within 5 days'}
            {Number(ticker.days_to_earnings) <= 2 && (
              <div className="text-red-400 font-semibold mt-1">System recommendation: Do not buy</div>
            )}
            {Number(ticker.days_to_earnings) > 2 && Number(ticker.days_to_earnings) <= 5 && (
              <div className="text-amber-400 font-semibold mt-1">System recommendation: Wait for result</div>
            )}
            {ticker.EarningsPenalty > 0 && (
              <div className="text-xs text-muted-foreground mt-1">NCS penalty: −{ticker.EarningsPenalty.toFixed(0)}</div>
            )}
          </div>
        </div>
      )}

      {/* Action Note */}
      <div
        className="rounded-lg p-3 border-l-4"
        style={{ borderLeftColor: actionColor, backgroundColor: `${actionColor}10` }}
      >
        <div className="text-xs font-semibold text-foreground mb-1">Action</div>
        <div className="text-sm text-muted-foreground">{ticker.ActionNote}</div>
      </div>
    </div>
  );
}

export default memo(WhyCard);
