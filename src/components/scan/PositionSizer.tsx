'use client';

import { useState } from 'react';
import { calculatePositionSize } from '@/lib/position-sizer';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import type { RiskProfileType } from '@/types';
import { RISK_PROFILES } from '@/types';
import { Calculator } from 'lucide-react';

export default function PositionSizer() {
  const { equity, riskProfile } = useStore();
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [result, setResult] = useState<ReturnType<typeof calculatePositionSize> | null>(null);
  const [error, setError] = useState<string>('');

  const calculate = () => {
    try {
      setError('');
      const entry = parseFloat(entryPrice);
      const stop = parseFloat(stopPrice);

      if (isNaN(entry) || isNaN(stop)) {
        setError('Please enter valid numbers');
        return;
      }

      const sizing = calculatePositionSize({
        equity,
        riskProfile: riskProfile as RiskProfileType,
        entryPrice: entry,
        stopPrice: stop,
      });

      setResult(sizing);
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    }
  };

  const profile = RISK_PROFILES[riskProfile];

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <Calculator className="w-4 h-4 text-primary-400" />
        Position Sizing Calculator
      </h3>

      <div className="text-xs text-muted-foreground mb-4 p-3 bg-navy-800 rounded-lg font-mono">
        Shares = (Equity × Risk%) / (Entry - Stop)
        <br />
        = ({formatCurrency(equity)} × {profile.riskPerTrade}%) / (Entry - Stop)
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Entry Price</label>
          <input
            type="number"
            className="input-field w-full"
            placeholder="e.g., 150.00"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Stop Price</label>
          <input
            type="number"
            className="input-field w-full"
            placeholder="e.g., 142.50"
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
          />
        </div>
      </div>

      <button onClick={calculate} className="btn-primary w-full mb-4">
        Calculate Position Size
      </button>

      {error && (
        <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg p-3 mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-navy-800 p-3 rounded-lg">
              <div className="text-xs text-muted-foreground">Shares to Buy</div>
              <div className="text-2xl font-bold font-mono text-primary-400">{result.shares}</div>
            </div>
            <div className="bg-navy-800 p-3 rounded-lg">
              <div className="text-xs text-muted-foreground">Total Cost</div>
              <div className="text-lg font-bold font-mono text-foreground">{formatCurrency(result.totalCost)}</div>
            </div>
            <div className="bg-navy-800 p-3 rounded-lg">
              <div className="text-xs text-muted-foreground">Risk ($)</div>
              <div className="text-lg font-bold font-mono text-loss">{formatCurrency(result.riskDollars)}</div>
            </div>
            <div className="bg-navy-800 p-3 rounded-lg">
              <div className="text-xs text-muted-foreground">Risk (% of Equity)</div>
              <div className="text-lg font-bold font-mono text-warning">{result.riskPercent.toFixed(2)}%</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground bg-navy-800 p-2 rounded font-mono">
            R per share: {formatCurrency(result.rPerShare)} | Profile: {profile.name} ({profile.riskPerTrade}%)
          </div>
        </div>
      )}
    </div>
  );
}
