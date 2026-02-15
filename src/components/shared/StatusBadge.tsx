'use client';

import { cn } from '@/lib/utils';
import type { CandidateStatus, HealthStatus, MarketRegime, PositionStatus, ProtectionLevel } from '@/types';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusStyles: Record<string, string> = {
  // Candidate Status
  READY: 'bg-profit/20 text-profit border border-profit/30',
  WATCH: 'bg-warning/20 text-warning border border-warning/30',
  WAIT_PULLBACK: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  FAR: 'bg-loss/20 text-loss border border-loss/30',
  TRIGGERED: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  // Position Status
  OPEN: 'bg-profit/20 text-profit border border-profit/30',
  CLOSED: 'bg-muted text-muted-foreground border border-border',
  // Market Regime
  BULLISH: 'bg-profit/20 text-profit border border-profit/30',
  SIDEWAYS: 'bg-warning/20 text-warning border border-warning/30',
  BEARISH: 'bg-loss/20 text-loss border border-loss/30',
  // Rating
  'Strong Bullish': 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  'Bullish': 'bg-profit/20 text-profit border border-profit/30',
  'Neutral': 'bg-muted text-muted-foreground border border-border',
  'Bearish': 'bg-loss/20 text-loss border border-loss/30',
  'Strong Bearish': 'bg-red-600/20 text-red-500 border border-red-600/30',
  'N/A': 'bg-muted/50 text-muted-foreground border border-border/50',
  // Protection Level
  INITIAL: 'bg-loss/20 text-loss border border-loss/30',
  BREAKEVEN: 'bg-warning/20 text-warning border border-warning/30',
  LOCK_08R: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  LOCK_1R_TRAIL: 'bg-profit/20 text-profit border border-profit/30',
};

const statusLabels: Record<string, string> = {
  LOCK_08R: 'Lock +0.8R',
  LOCK_1R_TRAIL: 'Lock +1R Trail',
  SMALL_ACCOUNT: 'Small Account',
  HIGH_RISK: 'High Risk',
};

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = statusStyles[status] || 'bg-muted text-muted-foreground border border-border';
  const label = statusLabels[status] || status;

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        style,
        className
      )}
    >
      {label}
    </span>
  );
}
