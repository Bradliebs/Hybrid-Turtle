'use client';

import { cn, formatCurrency, formatPrice, formatR } from '@/lib/utils';
import { Lock, ArrowUp, AlertTriangle, Shield, TrendingUp, Check } from 'lucide-react';

interface Position {
  ticker: string;
  entryPrice: number;
  currentPrice: number;
  currentStop: number;
  initialStop: number;
  rMultiple: number;
  protectionLevel: string;
  shares: number;
  priceCurrency?: string;
  initialRiskGBP?: number;
  openRiskGBP?: number;
  // @deprecated Use initialRiskGBP instead.
  riskGBP?: number;
}

interface StopLossPanelProps {
  positions?: Position[];
}

const levelColors: Record<string, string> = {
  INITIAL: 'bg-navy-700 text-muted-foreground',
  BREAKEVEN: 'bg-warning/20 text-warning',
  LOCK_08R: 'bg-blue-500/20 text-blue-400',
  LOCK_1R_TRAIL: 'bg-profit/20 text-profit',
};

export default function StopLossPanel({ positions = [] }: StopLossPanelProps) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-loss" />
          Stop-Loss Management
        </h3>
        <div className="flex items-center gap-1 text-xs text-primary-400">
          <Lock className="w-3 h-3" />
          Monotonic Enforcement
        </div>
      </div>

      <div className="bg-loss/10 border border-loss/30 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 text-xs text-loss font-semibold">
          <AlertTriangle className="w-3 h-3" />
          NEVER Rules Active
        </div>
        <ul className="mt-1 space-y-0.5 text-[11px] text-loss/80">
          <li>• Stops can ONLY move up — never lowered</li>
          <li>• Stop-loss must be set BEFORE entry</li>
          <li>• $0 stop-loss = blocked trade</li>
        </ul>
      </div>

      <div className="space-y-3">
        {positions.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No open positions to manage stops.
          </div>
        )}
        {positions.map((pos) => {
          const gainPerShare = pos.currentPrice - pos.entryPrice;
          const initialRiskGBP = pos.initialRiskGBP ?? pos.riskGBP ?? Math.max(0, (pos.entryPrice - pos.currentStop) * pos.shares);
          const openRiskGBP = pos.openRiskGBP ?? Math.max(0, (pos.currentPrice - pos.currentStop) * pos.shares);

          return (
            <div key={pos.ticker} className="bg-navy-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{pos.ticker}</span>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded font-mono',
                    levelColors[pos.protectionLevel]
                  )}>
                    {pos.protectionLevel.replace(/_/g, ' ')}
                  </span>
                </div>
                <span className="font-mono text-sm text-primary-400">{formatR(pos.rMultiple)}</span>
              </div>

              {/* Stop visualization */}
              <div className="relative">
                <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                  {/* Price range from initial stop to current price */}
                  <div className="h-full flex">
                    {/* below current stop = loss zone */}
                    <div
                      className="h-full bg-loss/40"
                      style={{ width: `${((pos.currentStop - pos.initialStop) / (pos.currentPrice - pos.initialStop)) * 100}%` }}
                    />
                    {/* above stop = profit locked */}
                    {pos.currentStop > pos.entryPrice && (
                      <div
                        className="h-full bg-profit/40"
                        style={{ width: `${((pos.currentPrice - pos.currentStop) / (pos.currentPrice - pos.initialStop)) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
                  <span>Stop: {formatPrice(pos.currentStop, pos.priceCurrency)}</span>
                  <span>Entry: {formatPrice(pos.entryPrice, pos.priceCurrency)}</span>
                  <span>Now: {formatPrice(pos.currentPrice, pos.priceCurrency)}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Initial Risk (Entry → Stop)</span>
                  <div className={cn(
                    'font-mono',
                    initialRiskGBP > 0 ? 'text-loss' : 'text-profit'
                  )}>
                    {formatCurrency(initialRiskGBP)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Open Risk (Current → Stop)</span>
                  <div className={cn(
                    'font-mono',
                    openRiskGBP > 0 ? 'text-loss' : 'text-profit'
                  )}>
                    {formatCurrency(openRiskGBP)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Unrealized</span>
                  <div className={cn(
                    'font-mono',
                    gainPerShare >= 0 ? 'text-profit' : 'text-loss'
                  )}>
                    {gainPerShare >= 0 ? '+' : ''}{formatCurrency(gainPerShare * pos.shares)}
                  </div>
                  <button className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 ml-auto mt-1">
                    <ArrowUp className="w-3 h-3" />
                    Raise Stop
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
