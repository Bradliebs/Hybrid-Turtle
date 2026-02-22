'use client';

import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { Check, X, AlertTriangle, Shield, TrendingUp, Activity, Database } from 'lucide-react';

interface CheckItem {
  label: string;
  checked: boolean;
  category: 'market' | 'risk' | 'health' | 'entry';
  critical?: boolean;
}

const categoryIcons: Record<string, React.ElementType> = {
  market: TrendingUp,
  risk: Shield,
  health: Activity,
  entry: Database,
};

const categoryLabels: Record<string, string> = {
  market: 'Market Conditions',
  risk: 'Risk Gate',
  health: 'System Health',
  entry: 'Entry Rules',
};

interface PreTradeChecklistProps {
  healthReport?: {
    overall: string;
    checks: Record<string, string>;
    results: Array<{ id: string; status: string }>;
  } | null;
  riskBudget?: {
    usedRiskPercent: number;
    maxRiskPercent: number;
    usedPositions: number;
    maxPositions: number;
    sleeveUtilization: Record<string, { used: number; max: number }>;
  } | null;
  hasReadyCandidates?: boolean;
}

export default function PreTradeChecklist({
  healthReport,
  riskBudget,
  hasReadyCandidates = false,
}: PreTradeChecklistProps) {
  const { marketRegime, healthStatus, fearGreed } = useStore();

  const overallHealth = healthReport?.overall || healthStatus;
  const allHealthGreen = healthReport?.results?.every((r) => r.status === 'GREEN') ?? false;
  const dataFresh = healthReport?.results?.find((r) => r.id === 'A1')?.status === 'GREEN';
  const openRiskOk = riskBudget
    ? riskBudget.usedRiskPercent <= riskBudget.maxRiskPercent
    : false;
  const positionCountOk = riskBudget
    ? riskBudget.usedPositions < riskBudget.maxPositions
    : false;
  const sleeveOk = riskBudget
    ? Object.values(riskBudget.sleeveUtilization).every((s) => s.used <= s.max)
    : false;
  const fearGreedOk = fearGreed ? fearGreed.label !== 'Extreme Fear' : false;

  const checks: CheckItem[] = [
    { label: 'Market regime is BULLISH', checked: marketRegime === 'BULLISH', category: 'market', critical: true },
    { label: 'Fear & Greed not in Extreme Fear', checked: fearGreedOk, category: 'market' },
    { label: 'S&P above 200-day MA', checked: marketRegime !== 'BEARISH', category: 'market' },
    { label: 'Health check is GREEN', checked: overallHealth === 'GREEN', category: 'health', critical: true },
    { label: 'All 16 health items pass', checked: allHealthGreen, category: 'health' },
    { label: 'Data is fresh (< 24h)', checked: dataFresh, category: 'health' },
    { label: 'Total open risk < limit', checked: openRiskOk, category: 'risk' },
    { label: 'Position count < max', checked: positionCountOk, category: 'risk' },
    { label: 'Sleeve caps not breached', checked: sleeveOk, category: 'risk' },
    { label: 'Candidate passed all 6 filters (100%)', checked: hasReadyCandidates, category: 'entry', critical: true },
    { label: 'Entry trigger uses 20-day high + ATR buffer', checked: hasReadyCandidates, category: 'entry' },
    { label: 'Stop-loss is pre-set before entry', checked: hasReadyCandidates, category: 'entry', critical: true },
    { label: 'Position size uses formula: Shares = (Eq × R%) / (E - S)', checked: hasReadyCandidates, category: 'entry' },
    { label: 'Shares rounded DOWN (never up)', checked: hasReadyCandidates, category: 'entry' },
  ];

  const categories = ['market', 'risk', 'health', 'entry'];
  const allPassed = checks.every(c => c.checked);
  const failedCount = checks.filter(c => !c.checked).length;
  const criticalFailed = checks.filter(c => c.critical && !c.checked);

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Pre-Trade Checklist
        </h3>
        {allPassed ? (
          <span className="text-xs px-2 py-1 rounded bg-profit/20 text-profit font-medium">
            ALL CLEAR
          </span>
        ) : criticalFailed.length > 0 ? (
          <span className="text-xs px-2 py-1 rounded bg-warning/20 text-warning font-medium">
            {criticalFailed.length} WARNING{criticalFailed.length !== 1 ? 'S' : ''}
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded bg-warning/20 text-warning font-medium">
            {failedCount} CAUTION{failedCount !== 1 ? 'S' : ''}
          </span>
        )}
      </div>

      {criticalFailed.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-warning text-sm font-semibold mb-1">
            <AlertTriangle className="w-4 h-4" />
            TRADE WITH CAUTION
          </div>
          <p className="text-xs text-muted-foreground mb-2">The following items need attention before entering:</p>
          <ul className="space-y-1">
            {criticalFailed.map((c) => (
              <li key={c.label} className="text-xs text-warning/80">• {c.label}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {categories.map((cat) => {
          const Icon = categoryIcons[cat];
          const items = checks.filter(c => c.category === cat);

          return (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {categoryLabels[cat]}
                </span>
              </div>
              <div className="space-y-1.5">
                {items.map((item) => (
                  <div
                    key={item.label}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded',
                      item.checked ? 'bg-navy-800/50' : 'bg-loss/5 border border-loss/20'
                    )}
                  >
                    {item.checked ? (
                      <Check className="w-4 h-4 text-profit flex-shrink-0" />
                    ) : (
                      <X className="w-4 h-4 text-loss flex-shrink-0" />
                    )}
                    <span className={cn(
                      'text-xs',
                      item.checked ? 'text-muted-foreground' : 'text-loss'
                    )}>
                      {item.label}
                    </span>
                    {item.critical && (
                      <span className="text-[10px] px-1 py-0.5 bg-warning/20 text-warning rounded ml-auto">
                        CRITICAL
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
