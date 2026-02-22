'use client';

import { useState } from 'react';
import {
  FileText, TrendingUp, ShieldAlert,
  Flame, Trash2, Ban, ArrowRightLeft,
  ChevronDown, ChevronUp, Zap, RotateCcw,
  ArrowRight, AlertTriangle,
} from 'lucide-react';
import type { WeeklyActionCard as ActionCardType } from '@/types';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';

type DrillSection =
  | null
  | 'stops'
  | 'laggards'
  | 'climax'
  | 'whipsaw'
  | 'swaps'
  | 'fastFollowers'
  | 'reentry';

export default function ActionCardWidget() {
  const { data: modulesData, loading } = useModulesData();
  const [drillOpen, setDrillOpen] = useState<DrillSection>(null);

  const toggle = (section: DrillSection) =>
    setDrillOpen(prev => (prev === section ? null : section));

  const card = modulesData?.actionCard ?? null;

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary-400 animate-pulse" />
          Weekly Action Card
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Generating...</div>
      </div>
    );
  }

  if (!card) return null;

  const regimeColor =
    card.regime === 'BULLISH'
      ? 'text-profit'
      : card.regime === 'BEARISH'
        ? 'text-loss'
        : 'text-warning';

  const alertCount =
    (card.laggardDetails?.length || 0) +
    (card.climaxDetails?.length || 0) +
    (card.whipsawDetails?.length || 0) +
    (card.swapDetails?.length || 0) +
    (card.fastFollowerDetails?.length || 0) +
    (card.reentryDetails?.length || 0);

  return (
    <div className="card-surface p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary-400" />
          Weekly Action Card
        </h3>
        <span className="text-[10px] text-muted-foreground">Week of {card.weekOf}</span>
      </div>

      {/* Top Summary Row */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="text-center">
          <div className={cn('text-lg font-bold', regimeColor)}>{card.regime}</div>
          <div className="text-[10px] text-muted-foreground">Regime</div>
        </div>
        <div className="text-center">
          <div className={cn('text-lg font-bold', card.breadthPct < 40 ? 'text-loss' : 'text-foreground')}>
            {card.breadthPct.toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground">Breadth</div>
        </div>
        <div className="text-center">
          <div className={cn('text-lg font-bold', card.riskBudgetPct > 80 ? 'text-warning' : 'text-foreground')}>
            {card.riskBudgetPct.toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground">Risk Used</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-foreground">{card.maxPositions}</div>
          <div className="text-[10px] text-muted-foreground">Max Pos</div>
        </div>
      </div>

      {/* 🚨 TRIGGER MET — prominent alert above everything else */}
      {card.triggerMet && card.triggerMet.length > 0 && (
        <div className="mb-3 p-3 rounded-lg border-2 border-amber-400/60 bg-amber-500/10 animate-pulse">
          <div className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            TRIGGER MET ({card.triggerMet.length})
          </div>
          <div className="space-y-2">
            {card.triggerMet.map(t => {
              const sym = t.currency === 'GBX' || t.currency === 'GBP' ? '£' : t.currency === 'EUR' ? '€' : '$';
              return (
                <div key={t.ticker} className="bg-navy-800/80 rounded-md p-2 border border-amber-500/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-amber-400">{t.ticker}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                      PRICE ABOVE TRIGGER
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-1">{t.name} · {t.sleeve}</div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <span className="text-muted-foreground">Close</span>
                      <div className="font-mono font-medium text-amber-400">{sym}{t.close.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Trigger</span>
                      <div className="font-mono font-medium text-foreground">{sym}{t.entryTrigger.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Stop</span>
                      <div className="font-mono font-medium text-loss">{sym}{t.stopLevel.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-amber-300/80 mt-1 italic">
                    Confirm volume ≥1.0× on breakout day before buying
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ready Candidates */}
      {card.readyCandidates.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-foreground mb-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-profit" />
            Ready Candidates ({card.readyCandidates.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {card.readyCandidates.slice(0, 8).map(c => (
              <span
                key={c.ticker}
                className="text-[10px] px-1.5 py-0.5 rounded bg-profit/10 text-profit border border-profit/20"
              >
                {c.ticker}
              </span>
            ))}
            {card.readyCandidates.length > 8 && (
              <span className="text-[10px] text-muted-foreground">
                +{card.readyCandidates.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stop Updates — drillable */}
      {card.stopUpdates.length > 0 && (
        <DrillableSection
          icon={<ShieldAlert className="w-3 h-3 text-warning" />}
          label={`Stop Updates (${card.stopUpdates.length})`}
          isOpen={drillOpen === 'stops'}
          onToggle={() => toggle('stops')}
          color="warning"
        >
          <div className="space-y-1.5">
            {card.stopUpdates.map((s) => (
              <div key={s.ticker} className="flex items-center gap-2 text-[11px]">
                <span className="font-medium text-foreground w-12">{s.ticker}</span>
                <span className="text-muted-foreground">${s.from.toFixed(2)}</span>
                <ArrowRight className="w-3 h-3 text-profit" />
                <span className="text-profit font-medium">${s.to.toFixed(2)}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  +{((s.to - s.from) / s.from * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </DrillableSection>
      )}

      {/* ── Action Items (drillable detail panels) ── */}
      {alertCount > 0 && (
        <div className="border-t border-border/50 pt-2 mt-2 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Action Items ({alertCount})
          </div>

          {/* Swap Suggestions */}
          {card.swapDetails && card.swapDetails.length > 0 && (
            <DrillableSection
              icon={<ArrowRightLeft className="w-3 h-3 text-primary-400" />}
              label={`Swap Suggestion${card.swapDetails.length > 1 ? 's' : ''} (${card.swapDetails.length})`}
              isOpen={drillOpen === 'swaps'}
              onToggle={() => toggle('swaps')}
              color="primary"
            >
              <div className="space-y-2">
                {card.swapDetails.map((s) => (
                  <div key={`${s.weakTicker}-${s.strongTicker}`} className="bg-surface-elevated/50 rounded-md p-2 border border-border/30">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] text-muted-foreground">Cluster:</span>
                      <span className="text-[11px] font-medium text-foreground">{s.cluster}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <div className="text-[10px] text-loss">Sell (weak)</div>
                        <div className="text-[11px] font-medium text-foreground">{s.weakTicker}</div>
                        <div className="text-[10px] text-muted-foreground">
                          R = {s.weakRMultiple.toFixed(2)}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-primary-400 shrink-0" />
                      <div className="flex-1 text-right">
                        <div className="text-[10px] text-profit">Buy (strong)</div>
                        <div className="text-[11px] font-medium text-foreground">{s.strongTicker}</div>
                        <div className="text-[10px] text-muted-foreground">
                          Rank {s.strongRankScore.toFixed(0)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </DrillableSection>
          )}

          {/* Laggards */}
          {card.laggardDetails && card.laggardDetails.length > 0 && (
            <DrillableSection
              icon={<Trash2 className="w-3 h-3 text-warning" />}
              label={`Laggard${card.laggardDetails.length > 1 ? 's' : ''} (${card.laggardDetails.length})`}
              isOpen={drillOpen === 'laggards'}
              onToggle={() => toggle('laggards')}
              color="warning"
            >
              <div className="space-y-2">
                {card.laggardDetails.map((l) => (
                  <div key={l.ticker} className="bg-surface-elevated/50 rounded-md p-2 border border-border/30">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground">{l.ticker}</span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded',
                          l.action === 'TRIM_LAGGARD'
                            ? 'bg-loss/10 text-loss border border-loss/20'
                            : 'bg-warning/10 text-warning border border-warning/20'
                        )}
                      >
                        {l.action === 'TRIM_LAGGARD' ? 'DEAD MONEY' : l.action}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <span className="text-muted-foreground">Days held</span>
                        <div className="font-medium text-foreground">{l.daysHeld}d</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">P&L</span>
                        <div className={cn('font-medium', l.gainPercent >= 0 ? 'text-profit' : 'text-loss')}>
                          {l.gainPercent >= 0 ? '+' : ''}{l.gainPercent.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">R-multiple</span>
                        <div className={cn('font-medium', l.rMultiple >= 0 ? 'text-profit' : 'text-loss')}>
                          {l.rMultiple >= 0 ? '+' : ''}{l.rMultiple.toFixed(2)}R
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </DrillableSection>
          )}

          {/* Climax Signals */}
          {card.climaxDetails && card.climaxDetails.length > 0 && (
            <DrillableSection
              icon={<Flame className="w-3 h-3 text-loss" />}
              label={`Climax Signal${card.climaxDetails.length > 1 ? 's' : ''} (${card.climaxDetails.length})`}
              isOpen={drillOpen === 'climax'}
              onToggle={() => toggle('climax')}
              color="danger"
            >
              <div className="space-y-2">
                {card.climaxDetails.map((c) => (
                  <div key={c.ticker} className="bg-surface-elevated/50 rounded-md p-2 border border-border/30">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground">{c.ticker}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-loss/10 text-loss border border-loss/20">
                        {c.action}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <span className="text-muted-foreground">Above MA20</span>
                        <div className="font-medium text-loss">+{c.priceAboveMa20Pct.toFixed(1)}%</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Volume</span>
                        <div className="font-medium text-foreground">{c.volumeRatio.toFixed(1)}×</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Price</span>
                        <div className="font-medium text-foreground">${c.price.toFixed(2)}</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      MA20: ${c.ma20.toFixed(2)} — {c.action === 'TRIM' ? 'Trim 50% of position' : 'Tighten stop to close − 1.5×ATR'}
                    </div>
                  </div>
                ))}
              </div>
            </DrillableSection>
          )}

          {/* Whipsaw Blocks */}
          {card.whipsawDetails && card.whipsawDetails.length > 0 && (
            <DrillableSection
              icon={<Ban className="w-3 h-3 text-loss" />}
              label={`Whipsaw Block${card.whipsawDetails.length > 1 ? 's' : ''} (${card.whipsawDetails.length})`}
              isOpen={drillOpen === 'whipsaw'}
              onToggle={() => toggle('whipsaw')}
              color="danger"
            >
              <div className="space-y-1.5">
                {card.whipsawDetails.map((w) => (
                  <div key={w.ticker} className="flex items-center gap-2 text-[11px] bg-surface-elevated/50 rounded-md p-2 border border-border/30">
                    <Ban className="w-3 h-3 text-loss shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">{w.ticker}</span>
                      <span className="text-muted-foreground ml-2">
                        {w.stopsInLast30Days} stop{w.stopsInLast30Days > 1 ? 's' : ''} in 30d — blocked 60 days
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </DrillableSection>
          )}

          {/* Fast-Follower Re-Entry */}
          {card.fastFollowerDetails && card.fastFollowerDetails.length > 0 && (
            <DrillableSection
              icon={<Zap className="w-3 h-3 text-yellow-400" />}
              label={`Fast-Follower${card.fastFollowerDetails.length > 1 ? 's' : ''} (${card.fastFollowerDetails.length})`}
              isOpen={drillOpen === 'fastFollowers'}
              onToggle={() => toggle('fastFollowers')}
              color="info"
            >
              <div className="space-y-2">
                {card.fastFollowerDetails.map((f) => (
                  <div key={f.ticker} className="bg-surface-elevated/50 rounded-md p-2 border border-border/30">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground">{f.ticker}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                        RE-ENTER
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <span className="text-muted-foreground">Days since exit</span>
                        <div className="font-medium text-foreground">{f.daysSinceExit}d</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">20d high</span>
                        <div className={cn('font-medium', f.reclaimedTwentyDayHigh ? 'text-profit' : 'text-loss')}>
                          {f.reclaimedTwentyDayHigh ? 'Reclaimed' : 'Below'}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Volume</span>
                        <div className="font-medium text-foreground">{f.volumeRatio.toFixed(1)}×</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Stopped out {f.exitDate} — shakeout recovery signal
                    </div>
                  </div>
                ))}
              </div>
            </DrillableSection>
          )}

          {/* Re-Entry Signals */}
          {card.reentryDetails && card.reentryDetails.length > 0 && (
            <DrillableSection
              icon={<RotateCcw className="w-3 h-3 text-blue-400" />}
              label={`Re-Entry Signal${card.reentryDetails.length > 1 ? 's' : ''} (${card.reentryDetails.length})`}
              isOpen={drillOpen === 'reentry'}
              onToggle={() => toggle('reentry')}
              color="info"
            >
              <div className="space-y-2">
                {card.reentryDetails.map((r) => (
                  <div key={r.ticker} className="bg-surface-elevated/50 rounded-md p-2 border border-border/30">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground">{r.ticker}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        RE-ENTER
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <span className="text-muted-foreground">Exit profit</span>
                        <div className="font-medium text-profit">+{r.exitProfitR.toFixed(1)}R</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Days ago</span>
                        <div className="font-medium text-foreground">{r.daysSinceExit}d</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">20d high</span>
                        <div className={cn('font-medium', r.reclaimedTwentyDayHigh ? 'text-profit' : 'text-loss')}>
                          {r.reclaimedTwentyDayHigh ? 'Reclaimed' : 'Below'}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Exited {r.exitDate} — profitable re-entry opportunity
                    </div>
                  </div>
                ))}
              </div>
            </DrillableSection>
          )}
        </div>
      )}

      {/* Notes */}
      {card.notes.length > 0 && (
        <div className="border-t border-border/50 pt-2 mt-2">
          <div className="space-y-1">
            {card.notes.map((note) => (
              <div key={note} className="text-[10px] text-muted-foreground">
                {note}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable drillable section component ──
function DrillableSection({
  icon,
  label,
  isOpen,
  onToggle,
  color,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  color: 'warning' | 'danger' | 'primary' | 'info';
  children: React.ReactNode;
}) {
  const borderColor = {
    warning: 'border-warning/20',
    danger: 'border-loss/20',
    primary: 'border-primary-400/20',
    info: 'border-blue-400/20',
  }[color];

  return (
    <div className={cn('rounded-md border', borderColor, 'overflow-hidden')}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated/50 transition-colors"
      >
        {icon}
        <span className="flex-1 text-left">{label}</span>
        {isOpen ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        )}
      </button>
      {isOpen && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}
