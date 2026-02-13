'use client';

import { useState, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

export default function MarketIndicesBar() {
  const { marketIndices, setMarketIndices, setFearGreed, setMarketRegime } = useStore();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [indicesRes, fgRes, regimeRes] = await Promise.all([
        fetch('/api/market-data?action=indices'),
        fetch('/api/market-data?action=fear-greed'),
        fetch('/api/market-data?action=regime'),
      ]);
      if (indicesRes.ok) {
        const d = await indicesRes.json();
        if (d.indices) setMarketIndices(d.indices);
      }
      if (fgRes.ok) {
        const d = await fgRes.json();
        if (d.value !== undefined) setFearGreed(d);
      }
      if (regimeRes.ok) {
        const d = await regimeRes.json();
        if (d.regime) setMarketRegime(d.regime);
      }
    } catch {
      // silent
    } finally {
      setRefreshing(false);
    }
  }, [setMarketIndices, setFearGreed, setMarketRegime]);

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-3 min-w-max pb-2 items-center">
        {marketIndices.map((index) => (
          <div
            key={index.ticker}
            className="card-surface p-4 min-w-[180px] flex flex-col gap-1"
          >
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              {index.name}
            </div>
            <div className="text-lg font-bold font-mono text-foreground">
              {index.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div
              className={cn(
                'flex items-center gap-1 text-sm font-mono',
                index.change >= 0 ? 'text-profit' : 'text-loss'
              )}
            >
              {index.change >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>
                {index.change >= 0 ? '+' : ''}
                {index.change.toFixed(2)}
              </span>
              <span className="text-xs">
                ({index.changePercent >= 0 ? '+' : ''}
                {index.changePercent.toFixed(2)}%)
              </span>
            </div>
          </div>
        ))}

        {/* Manual refresh button */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh market data"
          className={cn(
            'flex-shrink-0 p-3 rounded-lg border border-navy-500/30 bg-navy-700/40',
            'hover:bg-navy-600/50 hover:border-primary-400/30 transition-all duration-200',
            'text-muted-foreground hover:text-primary-400',
            refreshing && 'opacity-50 cursor-not-allowed'
          )}
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
        </button>
      </div>
    </div>
  );
}
