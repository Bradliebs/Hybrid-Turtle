'use client';

import { useState, useMemo } from 'react';
import { Calculator, ArrowRight } from 'lucide-react';
import { useRiskProfile } from '@/hooks/useRiskProfile';
import { cn } from '@/lib/utils';
import type { Sleeve } from '@/types';

const SLEEVE_OPTIONS: { value: Sleeve; label: string }[] = [
  { value: 'CORE', label: 'Core' },
  { value: 'ETF', label: 'ETF' },
  { value: 'HIGH_RISK', label: 'High Risk' },
  { value: 'HEDGE', label: 'Hedge' },
];

export default function PositionSizerWidget() {
  const { equity, riskProfile, profile, sizePosition } = useRiskProfile();
  const [entryPrice, setEntryPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [sleeve, setSleeve] = useState<Sleeve>('CORE');

  const result = useMemo(() => {
    const entry = parseFloat(entryPrice);
    const stop = parseFloat(stopPrice);
    if (!entry || !stop || entry <= 0 || stop <= 0 || stop >= entry) return null;
    try {
      return sizePosition(entry, stop);
    } catch {
      return null;
    }
  }, [entryPrice, stopPrice, sizePosition]);

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Calculator className="w-4 h-4 text-primary-400" />
        Position Sizer
      </h3>

      {/* Profile info */}
      <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2 flex-wrap">
        <span className="bg-navy-600/50 px-2 py-0.5 rounded">{profile.name}</span>
        <span>{profile.riskPerTrade}% risk</span>
        <span>·</span>
        <span>£{equity.toLocaleString()} equity</span>
      </div>

      {/* Input fields */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Entry Price</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            placeholder="0.00"
            className="w-full bg-navy-700/50 border border-navy-500/30 rounded px-3 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary-400/50"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Stop Price</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
            placeholder="0.00"
            className="w-full bg-navy-700/50 border border-navy-500/30 rounded px-3 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary-400/50"
          />
        </div>
      </div>

      {/* Sleeve selector */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground block mb-1">Sleeve</label>
        <div className="flex gap-1.5">
          {SLEEVE_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSleeve(s.value)}
              className={cn(
                'text-xs px-2.5 py-1 rounded transition-colors',
                sleeve === s.value
                  ? 'bg-primary-400/20 text-primary-400 border border-primary-400/40'
                  : 'bg-navy-600/30 text-muted-foreground border border-navy-500/20 hover:border-navy-400/30'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      {result ? (
        <div className="bg-navy-700/40 rounded-lg p-3 border border-navy-500/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Shares</span>
            <span className="text-lg font-bold font-mono text-profit">{result.shares}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Total Cost</span>
            <span className="text-sm font-mono text-foreground">
              £{result.totalCost.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Risk £</span>
            <span className="text-sm font-mono text-warning">
              £{result.riskDollars.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Risk %</span>
            <span className="text-sm font-mono text-foreground">
              {result.riskPercent.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">1R per share</span>
            <span className="text-sm font-mono text-foreground">
              £{result.rPerShare.toFixed(2)}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground text-center py-3 bg-navy-700/20 rounded-lg">
          <ArrowRight className="w-3 h-3 inline mr-1" />
          Enter entry & stop price to calculate
        </div>
      )}
    </div>
  );
}
