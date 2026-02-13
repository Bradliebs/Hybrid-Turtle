'use client';

import { formatCurrency, formatPrice, formatR } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Lock, ArrowUp, ArrowDown, Shield, Edit3 } from 'lucide-react';

export interface StopUpdate {
  ticker: string;
  currentStop: number;
  recommendedStop: number;
  protectionLevel: string;
  rMultiple: number;
  currentPrice: number;
  direction: 'up' | 'hold';
  reason: string;
  priceCurrency?: string;
}

const protectionColors: Record<string, string> = {
  INITIAL: 'text-muted-foreground',
  BREAKEVEN: 'text-warning',
  LOCK_08R: 'text-blue-400',
  LOCK_1R_TRAIL: 'text-profit',
};

interface StopUpdateQueueProps {
  updates: StopUpdate[];
}

export default function StopUpdateQueue({ updates }: StopUpdateQueueProps) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Stop-Loss Update Queue
        </h3>
        <span className="text-xs text-muted-foreground">
          {updates.filter(u => u.direction === 'up').length} pending updates
        </span>
      </div>

      <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 mb-4">
        <p className="text-xs text-primary-400 font-semibold">
          ⚠️ Stops can only move UP — monotonic enforcement active
        </p>
      </div>

      {updates.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No open positions — nothing to manage.
        </p>
      )}

      <div className="space-y-3">
        {updates.map((update) => (
          <div
            key={update.ticker}
            className={cn(
              'bg-navy-800 rounded-lg p-3 border',
              update.direction === 'up' ? 'border-profit/30' : 'border-navy-600'
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">{update.ticker}</span>
                <span className={cn(
                  'text-xs font-mono',
                  protectionColors[update.protectionLevel] || 'text-muted-foreground'
                )}>
                  {update.protectionLevel.replace(/_/g, ' ')}
                </span>
              </div>
              <span className="text-xs font-mono text-primary-400">
                {formatR(update.rMultiple)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs mb-2">
              <div>
                <span className="text-muted-foreground">Current Stop</span>
                <div className="font-mono text-foreground">{formatPrice(update.currentStop, update.priceCurrency)}</div>
              </div>
              <div className="text-center">
                {update.direction === 'up' ? (
                  <ArrowUp className="w-5 h-5 text-profit mx-auto mt-2" />
                ) : (
                  <Lock className="w-4 h-4 text-muted-foreground mx-auto mt-2" />
                )}
              </div>
              <div className="text-right">
                <span className="text-muted-foreground">Recommended</span>
                <div className={cn(
                  'font-mono',
                  update.direction === 'up' ? 'text-profit' : 'text-muted-foreground'
                )}>
                  {formatPrice(update.recommendedStop, update.priceCurrency)}
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground mt-1">
              {update.reason}
            </div>

            {update.direction === 'up' && (
              <button className="mt-2 w-full text-xs py-1.5 rounded bg-profit/20 text-profit font-medium hover:bg-profit/30 transition-colors">
                Apply Stop Update
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
