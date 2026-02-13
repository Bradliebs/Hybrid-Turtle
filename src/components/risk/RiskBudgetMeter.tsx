'use client';

import { RISK_PROFILES } from '@/types';
import { useStore } from '@/store/useStore';
import { cn, formatPercent, formatCurrency } from '@/lib/utils';
import { Gauge, AlertTriangle } from 'lucide-react';

interface BudgetItem {
  label: string;
  current: number;
  limit: number;
  unit: '%' | '$' | '#';
}

interface RiskBudgetMeterProps {
  budget?: {
    usedRiskPercent: number;
    availableRiskPercent: number;
    maxRiskPercent: number;
    usedPositions: number;
    maxPositions: number;
    sleeveUtilization: Record<string, { used: number; max: number }>;
  } | null;
  equity?: number;
  riskProfile?: keyof typeof RISK_PROFILES;
}

export default function RiskBudgetMeter({ budget, equity, riskProfile }: RiskBudgetMeterProps) {
  const store = useStore();
  const profileKey = riskProfile || (store.riskProfile as keyof typeof RISK_PROFILES);
  const profile = RISK_PROFILES[profileKey];
  const effectiveEquity = equity ?? store.equity;

  const remainingBudget = budget
    ? (budget.availableRiskPercent / 100) * effectiveEquity
    : 0;
  const remainingSlots = budget
    ? budget.maxPositions - budget.usedPositions
    : 0;

  const items: BudgetItem[] = budget
    ? [
        { label: 'Total Open Risk', current: budget.usedRiskPercent, limit: budget.maxRiskPercent, unit: '%' },
        { label: 'Open Positions', current: budget.usedPositions, limit: budget.maxPositions, unit: '#' },
        { label: 'Core Sleeve', current: budget.sleeveUtilization.CORE.used, limit: budget.sleeveUtilization.CORE.max, unit: '%' },
        { label: 'ETF Sleeve', current: budget.sleeveUtilization.ETF.used, limit: budget.sleeveUtilization.ETF.max, unit: '%' },
        { label: 'High-Risk Sleeve', current: budget.sleeveUtilization.HIGH_RISK.used, limit: budget.sleeveUtilization.HIGH_RISK.max, unit: '%' },
      ]
    : [];

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-primary-400" />
        Risk Budget
      </h3>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-navy-800 p-3 rounded-lg text-center">
          <div className="text-xs text-muted-foreground">Remaining Budget</div>
          <div className="text-lg font-mono font-bold text-profit">
            {formatCurrency(remainingBudget)}
          </div>
        </div>
        <div className="bg-navy-800 p-3 rounded-lg text-center">
          <div className="text-xs text-muted-foreground">Available Slots</div>
          <div className="text-lg font-mono font-bold text-primary-400">
            {remainingSlots}
          </div>
        </div>
      </div>

      {/* Budget meters */}
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No open positions to calculate risk budget.
          </div>
        )}
        {items.map((item) => {
          const pct = (item.current / item.limit) * 100;
          const isWarning = pct >= 80;
          const isDanger = pct >= 95;

          let displayCurrent = '';
          let displayLimit = '';
          if (item.unit === '%') {
            displayCurrent = formatPercent(item.current);
            displayLimit = formatPercent(item.limit);
          } else if (item.unit === '$') {
            displayCurrent = formatCurrency(item.current);
            displayLimit = formatCurrency(item.limit);
          } else {
            displayCurrent = item.current.toString();
            displayLimit = item.limit.toString();
          }

          return (
            <div key={item.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground flex items-center gap-1">
                  {isDanger && <AlertTriangle className="w-3 h-3 text-loss" />}
                  {item.label}
                </span>
                <span className={cn(
                  'font-mono',
                  isDanger ? 'text-loss' : isWarning ? 'text-warning' : 'text-foreground'
                )}>
                  {displayCurrent} / {displayLimit}
                </span>
              </div>
              <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    isDanger ? 'bg-loss' : isWarning ? 'bg-warning' : 'bg-primary'
                  )}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
