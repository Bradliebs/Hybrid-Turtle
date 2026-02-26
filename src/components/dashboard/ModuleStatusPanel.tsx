'use client';

import { useState } from 'react';
import {
  Zap, Trash2, Flame, ArrowRightLeft, Thermometer,
  RotateCcw, BarChart3, Ban, Layers, TrendingUp,
  Scissors, BookOpen, Clock, FileText, ShieldAlert,
  Globe, RefreshCw, Database, Activity, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle,
} from 'lucide-react';
import type { AllModulesResult, ModuleStatus } from '@/types';
import { cn } from '@/lib/utils';
import { useModulesData } from '@/hooks/useModulesData';

const MODULE_ICONS: Record<number, React.ElementType> = {
  2: Zap,
  3: Trash2,
  5: Flame,
  7: ArrowRightLeft,
  8: Thermometer,
  9: RotateCcw,
  9.1: Activity,
  10: BarChart3,
  11: Ban,
  12: Layers,
  13: TrendingUp,
  14: Scissors,
  15: BookOpen,
  16: Clock,
  17: FileText,
  18: ShieldAlert,
  19: Globe,
  20: RefreshCw,
  21: Database,
};

const STATUS_CONFIG = {
  GREEN: { color: 'text-profit', bg: 'bg-profit/10', border: 'border-profit/20', icon: CheckCircle2 },
  YELLOW: { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20', icon: AlertTriangle },
  RED: { color: 'text-loss', bg: 'bg-loss/10', border: 'border-loss/20', icon: XCircle },
  INACTIVE: { color: 'text-muted-foreground', bg: 'bg-muted/10', border: 'border-muted/20', icon: MinusCircle },
  DISABLED: { color: 'text-muted-foreground/50', bg: 'bg-muted/5', border: 'border-muted/10', icon: MinusCircle },
};

export default function ModuleStatusPanel() {
  const { data, loading } = useModulesData();
  const [error] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());

  const toggleModule = (id: number) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary-400 animate-pulse" />
          Module Status
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Loading module checks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-loss" />
          Module Status
        </h3>
        <div className="text-xs text-loss">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const statuses = data.moduleStatuses || [];
  const redCount = statuses.filter(s => s.status === 'RED').length;
  const yellowCount = statuses.filter(s => s.status === 'YELLOW').length;
  const greenCount = statuses.filter(s => s.status === 'GREEN').length;

  // Show critical (RED/YELLOW) first, then GREEN, then INACTIVE
  const sortedStatuses = [...statuses].sort((a, b) => {
    const order = { RED: 0, YELLOW: 1, GREEN: 2, INACTIVE: 3, DISABLED: 4 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  const displayStatuses = expanded ? sortedStatuses : sortedStatuses.slice(0, 8);

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary-400" />
          Module Status ({statuses.length} modules)
        </h3>
        <div className="flex items-center gap-2 text-xs">
          {redCount > 0 && (
            <span className="text-loss font-medium">{redCount} issues</span>
          )}
          {yellowCount > 0 && (
            <span className="text-warning font-medium">{yellowCount} warnings</span>
          )}
          <span className="text-profit font-medium">{greenCount} OK</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {displayStatuses.map((mod) => {
          const config = STATUS_CONFIG[mod.status];
          const Icon = MODULE_ICONS[mod.id] || Activity;
          const StatusIcon = config.icon;
          const isExpanded = expandedModules.has(mod.id);
          const hasDetails = getModuleDetails(mod, data);

          return (
            <div
              key={mod.id}
              className={cn(
                'rounded-lg border p-2.5 transition-all cursor-pointer hover:shadow-sm',
                config.bg,
                config.border
              )}
              onClick={() => hasDetails && toggleModule(mod.id)}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', config.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground truncate">
                      {mod.name}
                    </span>
                    <StatusIcon className={cn('w-3 h-3 flex-shrink-0', config.color)} />
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {mod.summary}
                  </div>
                </div>
                {hasDetails && (
                  isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />
                )}
              </div>
              {isExpanded && hasDetails && (
                <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground space-y-1">
                  {getModuleDetails(mod, data)?.map((detail) => (
                    <div key={detail}>{detail}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {statuses.length > 8 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-xs text-primary-400 hover:text-primary-300 transition-colors flex items-center gap-1 mx-auto"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> Show all {statuses.length} modules
            </>
          )}
        </button>
      )}
    </div>
  );
}

function getModuleDetails(mod: ModuleStatus, data: AllModulesResult): string[] | null {
  switch (mod.id) {
    case 3:
      if (data.laggards.length === 0) return null;
      return data.laggards.map(l => `${l.ticker}: ${l.reason}`);
    case 5:
    case 14:
      if (data.climaxSignals.length === 0) return null;
      return data.climaxSignals.map(c => `${c.ticker}: ${c.reason}`);
    case 7:
      if (data.swapSuggestions.length === 0) return null;
      return data.swapSuggestions.map(s => s.reason);
    case 8:
      if (data.heatChecks.length === 0) return null;
      return data.heatChecks.map(h => h.reason);
    case 10:
      return [data.breadthSafety.reason];
    case 11:
      if (data.whipsawBlocks.length === 0) return null;
      return data.whipsawBlocks.map(w => w.reason);
    case 13:
      return [data.momentumExpansion.reason];
    case 9.1:
      return [data.regimeStability.reason];
    case 19:
      return [
        `SPY: ${data.dualRegime.spy.regime} ($${data.dualRegime.spy.price.toFixed(2)} vs MA200 $${data.dualRegime.spy.ma200.toFixed(2)})`,
        `VWRL: ${data.dualRegime.vwrl.regime} ($${data.dualRegime.vwrl.price.toFixed(2)} vs MA200 $${data.dualRegime.vwrl.ma200.toFixed(2)})`,
        `Combined: ${data.dualRegime.combined}`,
      ];
    default:
      return null;
  }
}
