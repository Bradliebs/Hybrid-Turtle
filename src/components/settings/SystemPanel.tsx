'use client';

/**
 * DEPENDENCIES
 * Consumed by: /settings page
 * Consumes: /api/stocks, /api/backup, BackupPanel
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: System section — backups, universe management, immutable rules.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Database, Shield, AlertTriangle, Search, Plus, X,
  ChevronDown, ChevronUp, RefreshCw, Loader2,
} from 'lucide-react';
import BackupPanel from '@/components/settings/BackupPanel';
import CacheStatusPanel from '@/components/settings/CacheStatusPanel';
import FeatureFlagsPanel from '@/components/settings/FeatureFlagsPanel';

interface StockItem {
  id: string;
  ticker: string;
  name: string;
  sleeve: string;
  sector: string | null;
  cluster: string | null;
  superCluster: string | null;
  region: string | null;
  currency: string | null;
  active: boolean;
}

export default function SystemPanel() {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [stockSummary, setStockSummary] = useState({ total: 0, core: 0, etf: 0, highRisk: 0 });
  const [stockSearch, setStockSearch] = useState('');
  const [stockSleeveFilter, setStockSleeveFilter] = useState<string>('ALL');
  const [stocksLoading, setStocksLoading] = useState(true);
  const [stocksExpanded, setStocksExpanded] = useState(false);
  const [addTicker, setAddTicker] = useState('');
  const [addSleeve, setAddSleeve] = useState<'CORE' | 'ETF' | 'HIGH_RISK' | 'HEDGE'>('CORE');

  const fetchStocks = useCallback(async () => {
    setStocksLoading(true);
    try {
      const params = new URLSearchParams();
      if (stockSleeveFilter !== 'ALL') params.set('sleeve', stockSleeveFilter);
      if (stockSearch) params.set('search', stockSearch);
      const data = await apiRequest<{ stocks: StockItem[]; summary: { total: number; core: number; etf: number; highRisk: number } }>(`/api/stocks?${params.toString()}`);
      setStocks(data.stocks || []);
      setStockSummary(data.summary || { total: 0, core: 0, etf: 0, highRisk: 0 });
    } catch {
      console.error('Failed to fetch stocks');
    } finally {
      setStocksLoading(false);
    }
  }, [stockSleeveFilter, stockSearch]);

  useEffect(() => { fetchStocks(); }, [fetchStocks]);

  const handleAddStock = async () => {
    if (!addTicker.trim()) return;
    try {
      await apiRequest('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: addTicker.trim().toUpperCase(), sleeve: addSleeve }),
      });
      setAddTicker('');
      fetchStocks();
    } catch { console.error('Failed to add stock'); }
  };

  const handleRemoveStock = async (ticker: string) => {
    try {
      await apiRequest(`/api/stocks?ticker=${ticker}`, { method: 'DELETE' });
      fetchStocks();
    } catch { console.error('Failed to remove stock'); }
  };

  return (
    <div className="space-y-6">
      {/* Database Backup */}
      <BackupPanel />

      {/* Cache Status */}
      <CacheStatusPanel />

      {/* Feature Flags */}
      <FeatureFlagsPanel />

      {/* Ticker Universe */}
      <div className="card-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Database className="w-5 h-5 text-primary-400" />
            Ticker Universe
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="px-2 py-1 rounded bg-primary/10 text-primary-400 font-mono">{stockSummary.total} total</span>
            <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-400 font-mono">{stockSummary.core} Core</span>
            <span className="px-2 py-1 rounded bg-purple-500/10 text-purple-400 font-mono">{stockSummary.etf} ETF</span>
            <span className="px-2 py-1 rounded bg-orange-500/10 text-orange-400 font-mono">{stockSummary.highRisk} High‑Risk</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Search ticker, sector..." value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} className="input-field w-full pl-9 text-sm" />
          </div>
          <div className="flex gap-1 bg-surface-2 rounded-lg p-1">
            {['ALL', 'CORE', 'ETF', 'HIGH_RISK', 'HEDGE'].map((s) => (
              <button key={s} onClick={() => setStockSleeveFilter(s)} className={cn('px-3 py-1.5 text-xs rounded-md transition-colors', stockSleeveFilter === s ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground')}>
                {s === 'HIGH_RISK' ? 'High-Risk' : s === 'ALL' ? 'All' : s === 'HEDGE' ? 'Hedge' : s}
              </button>
            ))}
          </div>
          <button onClick={() => setStocksExpanded(!stocksExpanded)} className="text-muted-foreground hover:text-foreground p-2" title={stocksExpanded ? 'Collapse' : 'Expand'}>
            {stocksExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Add ticker */}
        <div className="flex items-center gap-2 mb-4">
          <input type="text" placeholder="Add ticker..." value={addTicker} onChange={(e) => setAddTicker(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && handleAddStock()} className="input-field text-sm w-32 font-mono" />
          <select value={addSleeve} onChange={(e) => setAddSleeve(e.target.value as 'CORE' | 'ETF' | 'HIGH_RISK' | 'HEDGE')} className="input-field text-sm" title="Sleeve">
            <option value="CORE">Core</option>
            <option value="ETF">ETF</option>
            <option value="HIGH_RISK">High-Risk</option>
            <option value="HEDGE">Hedge</option>
          </select>
          <button onClick={handleAddStock} disabled={!addTicker.trim()} className={cn('btn-primary flex items-center gap-1 text-xs px-3 py-2', !addTicker.trim() && 'opacity-50 cursor-not-allowed')}>
            <Plus className="w-3 h-3" /> Add
          </button>
          <button onClick={fetchStocks} className="text-muted-foreground hover:text-foreground p-2" title="Refresh">
            <RefreshCw className={cn('w-4 h-4', stocksLoading && 'animate-spin')} />
          </button>
        </div>

        {/* Stocks table */}
        {stocksLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
            <span className="ml-2 text-sm text-muted-foreground">Loading universe...</span>
          </div>
        ) : (
          <div className={cn('overflow-auto border border-white/5 rounded-lg', stocksExpanded ? 'max-h-[600px]' : 'max-h-[280px]')}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Ticker</th>
                  <th className="text-left px-3 py-2 font-medium">Sleeve</th>
                  <th className="text-left px-3 py-2 font-medium">Sector</th>
                  <th className="text-left px-3 py-2 font-medium">Cluster</th>
                  <th className="text-left px-3 py-2 font-medium">Super Cluster</th>
                  <th className="text-left px-3 py-2 font-medium">Region</th>
                  <th className="text-left px-3 py-2 font-medium">CCY</th>
                  <th className="text-right px-3 py-2 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stocks.map((stock) => (
                  <tr key={stock.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-3 py-1.5 font-mono font-semibold text-foreground">{stock.ticker}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium',
                        stock.sleeve === 'CORE' && 'bg-blue-500/20 text-blue-400',
                        stock.sleeve === 'ETF' && 'bg-purple-500/20 text-purple-400',
                        stock.sleeve === 'HIGH_RISK' && 'bg-orange-500/20 text-orange-400',
                        stock.sleeve === 'HEDGE' && 'bg-teal-500/20 text-teal-400'
                      )}>{stock.sleeve}</span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{stock.sector || '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{stock.cluster || '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{stock.superCluster || '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{stock.region || '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground font-mono">{stock.currency || '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => handleRemoveStock(stock.ticker)} className="text-muted-foreground hover:text-loss transition-colors" title="Remove"><X className="w-3 h-3" /></button>
                    </td>
                  </tr>
                ))}
                {stocks.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No stocks found{stockSearch ? ` matching "${stockSearch}"` : ''}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          {stocks.length} stocks shown · Imported from Planning folder · Run <code className="text-primary-400 font-mono">npx prisma db seed</code> to re-import
        </p>
      </div>

      {/* Immutable Rules */}
      <div className="card-surface p-6 border border-loss/30">
        <h2 className="text-lg font-semibold text-loss flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5" />
          Immutable Rules — Cannot Be Modified
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            'NEVER lower a stop-loss — monotonic enforcement',
            'NEVER buy if regime ≠ BULLISH',
            'NEVER skip the 16-point health check',
            'NEVER chase a Monday gap > 1 ATR',
            'NEVER override sleeve or cluster caps',
            'NEVER round position size UP (always floor)',
            'NEVER enter a trade with $0 stop-loss',
            'NEVER exceed max positions for risk profile',
            'NEVER average down on a losing position',
            'NEVER trade on Monday (Observe Only)',
          ].map((rule) => (
            <div key={rule} className="flex items-center gap-2 p-2 bg-loss/5 border border-loss/20 rounded">
              <Shield className="w-3 h-3 text-loss flex-shrink-0" />
              <span className="text-xs text-loss/80">{rule}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
