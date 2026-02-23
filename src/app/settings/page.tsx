'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/shared/Navbar';
import { useStore } from '@/store/useStore';
import { RISK_PROFILES, type RiskProfileType } from '@/types';
import { apiRequest } from '@/lib/api-client';
import { cn, formatCurrency, formatPercent } from '@/lib/utils';
import {
  Settings as SettingsIcon,
  Shield,
  DollarSign,
  Bell,
  Database,
  Link,
  AlertTriangle,
  Check,
  Save,
  TestTube,
  Eye,
  EyeOff,
  RefreshCw,
  Unplug,
  Plug,
  TrendingUp,
  Loader2,
  Search,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

export default function SettingsPage() {
  const { riskProfile, setRiskProfile, equity, setEquity } = useStore();
  const [equityInput, setEquityInput] = useState(equity.toString());
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  // Market Data Provider state
  const [marketDataProvider, setMarketDataProvider] = useState<'yahoo' | 'eodhd'>('yahoo');
  const [eodhApiKey, setEodhApiKey] = useState('');
  const [eodhApiKeySet, setEodhApiKeySet] = useState(false);
  const [showEodhKey, setShowEodhKey] = useState(false);

  // Trading 212 Invest state
  const [t212ApiKey, setT212ApiKey] = useState('');
  const [t212ApiSecret, setT212ApiSecret] = useState('');
  const [t212Environment, setT212Environment] = useState<'demo' | 'live'>('demo');
  const [t212ShowKey, setT212ShowKey] = useState(false);
  const [t212ShowSecret, setT212ShowSecret] = useState(false);
  const [t212Connected, setT212Connected] = useState(false);
  const [t212AccountId, setT212AccountId] = useState<string | null>(null);
  const [t212Currency, setT212Currency] = useState<string | null>(null);
  const [t212LastSync, setT212LastSync] = useState<string | null>(null);
  const [t212Connecting, setT212Connecting] = useState(false);
  const [t212Syncing, setT212Syncing] = useState(false);
  const [t212Error, setT212Error] = useState<string | null>(null);
  const [t212Success, setT212Success] = useState<string | null>(null);

  // Trading 212 ISA state
  const [t212IsaApiKey, setT212IsaApiKey] = useState('');
  const [t212IsaApiSecret, setT212IsaApiSecret] = useState('');
  const [t212IsaShowKey, setT212IsaShowKey] = useState(false);
  const [t212IsaShowSecret, setT212IsaShowSecret] = useState(false);
  const [t212IsaConnected, setT212IsaConnected] = useState(false);
  const [t212IsaAccountId, setT212IsaAccountId] = useState<string | null>(null);
  const [t212IsaCurrency, setT212IsaCurrency] = useState<string | null>(null);
  const [t212IsaLastSync, setT212IsaLastSync] = useState<string | null>(null);
  const [t212IsaConnecting, setT212IsaConnecting] = useState(false);
  const [t212IsaError, setT212IsaError] = useState<string | null>(null);
  const [t212IsaSuccess, setT212IsaSuccess] = useState<string | null>(null);

  const profile = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES];

  // Stock universe state
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

  useEffect(() => {
    fetchStocks();
  }, [fetchStocks]);

  // Load market data provider settings from DB on mount
  useEffect(() => {
    async function loadProviderSettings() {
      try {
        const data = await apiRequest<{
          marketDataProvider?: string;
          eodhApiKey?: string | null;
          eodhApiKeySet?: boolean;
        }>(`/api/settings?userId=${DEFAULT_USER_ID}`);
        if (data.marketDataProvider === 'eodhd') setMarketDataProvider('eodhd');
        if (data.eodhApiKeySet) setEodhApiKeySet(true);
      } catch {
        // Settings load failed — keep defaults (yahoo)
      }
    }
    loadProviderSettings();
  }, []);

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
    } catch {
      console.error('Failed to add stock');
    }
  };

  const handleRemoveStock = async (ticker: string) => {
    try {
      await apiRequest(`/api/stocks?ticker=${ticker}`, { method: 'DELETE' });
      fetchStocks();
    } catch {
      console.error('Failed to remove stock');
    }
  };

  const handleTelegramTest = async () => {
    if (!telegramToken || !telegramChatId) {
      setTelegramTestResult({ success: false, message: 'Enter both Bot Token and Chat ID' });
      return;
    }
    setTelegramTesting(true);
    setTelegramTestResult(null);
    try {
      const data = await apiRequest<{ botName: string }>('/api/settings/telegram-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: telegramToken, chatId: telegramChatId }),
      });
      setTelegramTestResult({ success: true, message: `Test sent via ${data.botName}` });
    } catch (err) {
      setTelegramTestResult({ success: false, message: err instanceof Error ? err.message : 'Network error — is the server running?' });
    } finally {
      setTelegramTesting(false);
      setTimeout(() => setTelegramTestResult(null), 5000);
    }
  };

  const handleSave = async () => {
    const newEquity = parseFloat(equityInput);
    if (!isNaN(newEquity) && newEquity > 0) {
      setEquity(newEquity);
    }
    // Persist to database
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          riskProfile,
          equity: !isNaN(newEquity) && newEquity > 0 ? newEquity : equity,
          marketDataProvider,
          // Only send eodhApiKey if user entered a new one (not the masked placeholder)
          ...(eodhApiKey && !eodhApiKey.startsWith('****') ? { eodhApiKey } : {}),
        }),
      });
    } catch {
      console.error('Failed to persist settings');
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleT212Connect = async () => {
    if (!t212ApiKey || !t212ApiSecret) {
      setT212Error('Please enter both API Key and API Secret');
      return;
    }

    setT212Connecting(true);
    setT212Error(null);
    setT212Success(null);

    try {
      const data = await apiRequest<{ accountId: number; currency: string }>('/api/trading212/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          apiKey: t212ApiKey,
          apiSecret: t212ApiSecret,
          environment: t212Environment,
          accountType: 'invest',
        }),
      });

      setT212Connected(true);
      setT212AccountId(data.accountId?.toString());
      setT212Currency(data.currency);
      setT212Success(`Connected! Account: ${data.accountId} (${data.currency})`);
    } catch (err) {
      setT212Error(err instanceof Error ? err.message : 'Network error — could not reach Trading 212');
    } finally {
      setT212Connecting(false);
    }
  };

  const handleT212Disconnect = async () => {
    try {
      await apiRequest(`/api/trading212/connect?userId=${DEFAULT_USER_ID}&accountType=invest`, { method: 'DELETE' });
      setT212Connected(false);
      setT212AccountId(null);
      setT212Currency(null);
      setT212LastSync(null);
      setT212ApiKey('');
      setT212ApiSecret('');
      setT212Success(null);
      setT212Error(null);
    } catch {
      setT212Error('Failed to disconnect');
    }
  };

  const handleT212IsaConnect = async () => {
    if (!t212IsaApiKey || !t212IsaApiSecret) {
      setT212IsaError('Please enter both API Key and API Secret');
      return;
    }

    setT212IsaConnecting(true);
    setT212IsaError(null);
    setT212IsaSuccess(null);

    try {
      const data = await apiRequest<{ accountId: number; currency: string }>('/api/trading212/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          apiKey: t212IsaApiKey,
          apiSecret: t212IsaApiSecret,
          environment: t212Environment, // ISA shares environment with Invest
          accountType: 'isa',
        }),
      });

      setT212IsaConnected(true);
      setT212IsaAccountId(data.accountId?.toString());
      setT212IsaCurrency(data.currency);
      setT212IsaSuccess(`Connected! ISA Account: ${data.accountId} (${data.currency})`);
    } catch (err) {
      setT212IsaError(err instanceof Error ? err.message : 'Network error — could not reach Trading 212');
    } finally {
      setT212IsaConnecting(false);
    }
  };

  const handleT212IsaDisconnect = async () => {
    try {
      await apiRequest(`/api/trading212/connect?userId=${DEFAULT_USER_ID}&accountType=isa`, { method: 'DELETE' });
      setT212IsaConnected(false);
      setT212IsaAccountId(null);
      setT212IsaCurrency(null);
      setT212IsaLastSync(null);
      setT212IsaApiKey('');
      setT212IsaApiSecret('');
      setT212IsaSuccess(null);
      setT212IsaError(null);
    } catch {
      setT212IsaError('Failed to disconnect');
    }
  };

  const handleT212Sync = async () => {
    setT212Syncing(true);
    setT212Error(null);
    setT212Success(null);

    try {
      const data = await apiRequest<{ syncedAt: string; sync: { invest: { created: number; updated: number; closed: number }; isa: { created: number; updated: number; closed: number } }; account?: { totalValue?: number } }>('/api/trading212/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_USER_ID }),
      });

      setT212LastSync(data.syncedAt);
      const inv = data.sync.invest;
      const isa = data.sync.isa;
      const parts: string[] = [];
      if (inv.created + inv.updated + inv.closed > 0) {
        parts.push(`Invest: ${inv.created} new, ${inv.updated} updated, ${inv.closed} closed`);
      }
      if (isa.created + isa.updated + isa.closed > 0) {
        parts.push(`ISA: ${isa.created} new, ${isa.updated} updated, ${isa.closed} closed`);
      }
      setT212Success(parts.length > 0 ? `Synced! ${parts.join(' | ')}` : 'Synced! No changes.');
      if (data.sync.isa && (isa.created + isa.updated + isa.closed > 0)) {
        setT212IsaLastSync(data.syncedAt);
      }

      // Update equity from combined T212 account value (flat totalValue = invest + ISA combined)
      const combined = data.account?.totalValue;
      if (combined && combined > 0) {
        setEquity(combined);
        setEquityInput(combined.toFixed(2));
      }
    } catch (err) {
      setT212Error(err instanceof Error ? err.message : 'Network error during sync');
    } finally {
      setT212Syncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <SettingsIcon className="w-6 h-6 text-primary-400" />
              Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure your HybridTurtle trading system
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/user-guide.md"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg border border-white/10 text-sm text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors flex items-center gap-2"
            >
              <Link className="w-4 h-4" />
              Open User Guide
            </a>
            <button
              onClick={handleSave}
              className={cn(
                'btn-primary flex items-center gap-2',
                saved && 'bg-profit hover:bg-profit'
              )}
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Account & Equity */}
        <div className="card-surface p-6">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-primary-400" />
            Account
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Account Equity</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <input
                  type="number"
                  value={equityInput}
                  onChange={(e) => setEquityInput(e.target.value)}
                  className="input-field pl-7 w-full"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Risk per trade: {formatCurrency(parseFloat(equityInput || '0') * profile.riskPerTrade / 100)}
              </p>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Risk Profile</label>
              <select
                value={riskProfile}
                onChange={(e) => setRiskProfile(e.target.value as RiskProfileType)}
                className="input-field w-full"
              >
                {(Object.entries(RISK_PROFILES) as [RiskProfileType, typeof RISK_PROFILES[RiskProfileType]][]).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.name} ({p.riskPerTrade}% / {p.maxPositions} pos)
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Max positions: {profile.maxPositions} · Max total risk: {formatPercent(profile.maxOpenRisk)}
              </p>
            </div>
          </div>
        </div>

        {/* Trading 212 Integration */}
        <div className="card-surface p-6 border border-primary/20">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
            <TrendingUp className="w-5 h-5 text-primary-400" />
            Trading 212 Integration
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Connect your Trading 212 accounts to automatically sync portfolio positions. Invest and ISA accounts use separate API keys.
          </p>

          {/* Environment selector — shared by both accounts */}
          <div className="mb-4">
            <label className="block text-sm text-muted-foreground mb-1">Environment</label>
            <select
              value={t212Environment}
              onChange={(e) => setT212Environment(e.target.value as 'demo' | 'live')}
              className="input-field"
              disabled={t212Connected || t212IsaConnected}
            >
              <option value="demo">Paper Trading (Demo)</option>
              <option value="live">Live Trading (Real Money)</option>
            </select>
            {(t212Connected || t212IsaConnected) && (
              <p className="text-xs text-muted-foreground mt-1">Disconnect all accounts to change environment.</p>
            )}
          </div>

          {/* Sync button — syncs both accounts at once */}
          {(t212Connected || t212IsaConnected) && (
            <div className="mb-4">
              {t212Error && (
                <div className="mb-3 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {t212Error}
                </div>
              )}
              {t212Success && (
                <div className="mb-3 p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit flex items-center gap-2">
                  <Check className="w-4 h-4 flex-shrink-0" />
                  {t212Success}
                </div>
              )}
              <button
                onClick={handleT212Sync}
                disabled={t212Syncing}
                className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2"
              >
                {t212Syncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {t212Syncing ? 'Syncing Both Accounts...' : 'Sync All Connected Accounts'}
              </button>
            </div>
          )}

          {/* ── Invest Account ── */}
          <div className="border border-border rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary-400" />
              Invest Account
            </h3>

            {t212Connected && (
              <div className="mb-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-profit animate-pulse" />
                    <span className="text-sm font-medium text-foreground">Connected</span>
                    {t212AccountId && (
                      <span className="text-xs text-muted-foreground">
                        Account: {t212AccountId} ({t212Currency}) — {t212Environment.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleT212Disconnect}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-loss/20 text-loss rounded-lg hover:bg-loss/30 transition-colors"
                  >
                    <Unplug className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
                {t212LastSync && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last synced: {new Date(t212LastSync).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {!t212Connected && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">API Key</label>
                    <div className="relative">
                      <input
                        type={t212ShowKey ? 'text' : 'password'}
                        value={t212ApiKey}
                        onChange={(e) => setT212ApiKey(e.target.value)}
                        placeholder="Invest API Key"
                        className="input-field w-full pr-10 text-sm"
                      />
                      <button
                        onClick={() => setT212ShowKey(!t212ShowKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {t212ShowKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">API Secret</label>
                    <div className="relative">
                      <input
                        type={t212ShowSecret ? 'text' : 'password'}
                        value={t212ApiSecret}
                        onChange={(e) => setT212ApiSecret(e.target.value)}
                        placeholder="Invest API Secret"
                        className="input-field w-full pr-10 text-sm"
                      />
                      <button
                        onClick={() => setT212ShowSecret(!t212ShowSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {t212ShowSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleT212Connect}
                  disabled={t212Connecting || !t212ApiKey || !t212ApiSecret}
                  className={cn(
                    'btn-primary flex items-center gap-2 text-sm',
                    (t212Connecting || !t212ApiKey || !t212ApiSecret) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {t212Connecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plug className="w-4 h-4" />
                  )}
                  {t212Connecting ? 'Connecting...' : 'Connect & Test'}
                </button>
              </>
            )}
          </div>

          {/* ── ISA Account ── */}
          <div className="border border-border rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-primary-400" />
              Stocks ISA Account
            </h3>

            {t212IsaError && (
              <div className="mb-3 p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {t212IsaError}
              </div>
            )}
            {t212IsaSuccess && (
              <div className="mb-3 p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit flex items-center gap-2">
                <Check className="w-4 h-4 flex-shrink-0" />
                {t212IsaSuccess}
              </div>
            )}

            {t212IsaConnected && (
              <div className="mb-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-profit animate-pulse" />
                    <span className="text-sm font-medium text-foreground">Connected</span>
                    {t212IsaAccountId && (
                      <span className="text-xs text-muted-foreground">
                        ISA Account: {t212IsaAccountId} ({t212IsaCurrency}) — {t212Environment.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleT212IsaDisconnect}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-loss/20 text-loss rounded-lg hover:bg-loss/30 transition-colors"
                  >
                    <Unplug className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
                {t212IsaLastSync && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last synced: {new Date(t212IsaLastSync).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {!t212IsaConnected && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">ISA API Key</label>
                    <div className="relative">
                      <input
                        type={t212IsaShowKey ? 'text' : 'password'}
                        value={t212IsaApiKey}
                        onChange={(e) => setT212IsaApiKey(e.target.value)}
                        placeholder="ISA API Key"
                        className="input-field w-full pr-10 text-sm"
                      />
                      <button
                        onClick={() => setT212IsaShowKey(!t212IsaShowKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {t212IsaShowKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">ISA API Secret</label>
                    <div className="relative">
                      <input
                        type={t212IsaShowSecret ? 'text' : 'password'}
                        value={t212IsaApiSecret}
                        onChange={(e) => setT212IsaApiSecret(e.target.value)}
                        placeholder="ISA API Secret"
                        className="input-field w-full pr-10 text-sm"
                      />
                      <button
                        onClick={() => setT212IsaShowSecret(!t212IsaShowSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {t212IsaShowSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleT212IsaConnect}
                  disabled={t212IsaConnecting || !t212IsaApiKey || !t212IsaApiSecret}
                  className={cn(
                    'btn-primary flex items-center gap-2 text-sm',
                    (t212IsaConnecting || !t212IsaApiKey || !t212IsaApiSecret) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {t212IsaConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plug className="w-4 h-4" />
                  )}
                  {t212IsaConnecting ? 'Connecting...' : 'Connect & Test'}
                </button>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Generate separate API keys for each account from your Trading 212 app.
            <a
              href="https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-400 hover:text-primary-300 ml-1"
            >
              How to get your API key →
            </a>
          </p>
        </div>

        {/* Market Data Provider */}
        <div className="card-surface p-6">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
            <Database className="w-5 h-5 text-primary-400" />
            Market Data Provider
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Choose your market data source. Yahoo Finance is free and requires no API key.
            EODHD offers premium data and requires a paid API key.
          </p>

          {/* Provider toggle */}
          <div className="mb-4">
            <label className="block text-sm text-muted-foreground mb-2">Active Provider</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMarketDataProvider('yahoo')}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
                  marketDataProvider === 'yahoo'
                    ? 'bg-primary/20 border-primary text-primary-400'
                    : 'border-white/10 text-muted-foreground hover:text-foreground hover:bg-surface-2'
                )}
              >
                Yahoo Finance
                <span className="block text-[10px] font-normal mt-0.5 opacity-70">Free · No API key</span>
              </button>
              <button
                onClick={() => {
                  if (!eodhApiKeySet && !eodhApiKey) {
                    // Can't switch to EODHD without a key
                    return;
                  }
                  setMarketDataProvider('eodhd');
                }}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
                  marketDataProvider === 'eodhd'
                    ? 'bg-primary/20 border-primary text-primary-400'
                    : 'border-white/10 text-muted-foreground hover:text-foreground hover:bg-surface-2',
                  !eodhApiKeySet && !eodhApiKey && 'opacity-50 cursor-not-allowed'
                )}
                title={!eodhApiKeySet && !eodhApiKey ? 'Enter your EODHD API key first' : undefined}
              >
                EODHD
                <span className="block text-[10px] font-normal mt-0.5 opacity-70">Premium · API key required</span>
              </button>
            </div>
          </div>

          {/* EODHD API Key */}
          <div className="p-4 rounded-lg border border-white/10 bg-surface-2/50">
            <label className="block text-sm text-muted-foreground mb-1">EODHD API Key</label>
            <div className="relative">
              <input
                type={showEodhKey ? 'text' : 'password'}
                value={eodhApiKey}
                onChange={(e) => {
                  setEodhApiKey(e.target.value);
                  if (e.target.value) setEodhApiKeySet(true);
                }}
                placeholder={eodhApiKeySet ? '••••••••' : 'Enter your EODHD API key'}
                className="input-field w-full pr-10"
              />
              <button
                onClick={() => setShowEodhKey(!showEodhKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showEodhKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Get an API key at{' '}
              <a
                href="https://eodhd.com/financial-apis/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 hover:text-primary-300"
              >
                eodhd.com →
              </a>
              {eodhApiKeySet && (
                <span className="ml-2 text-profit">
                  <Check className="w-3 h-3 inline" /> Key configured
                </span>
              )}
            </p>
          </div>

          {/* Status info */}
          <div className="mt-3 flex items-center gap-2">
            <div className={cn(
              'w-2 h-2 rounded-full',
              marketDataProvider === 'yahoo' ? 'bg-green-400' : 'bg-blue-400'
            )} />
            <span className="text-xs text-muted-foreground">
              Currently using: <span className="text-foreground font-medium">
                {marketDataProvider === 'yahoo' ? 'Yahoo Finance' : 'EODHD'}
              </span>
              {marketDataProvider === 'yahoo' && ' (free, no API key needed)'}
              {marketDataProvider === 'eodhd' && ' (premium, API key required)'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Switching providers takes effect after saving. Both providers use the same caching
            and rate-limiting strategy. You can switch back to Yahoo at any time.
          </p>
        </div>

        {/* Telegram */}
        <div className="card-surface p-6">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-primary-400" />
            Telegram Notifications
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Bot Token</label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder="Enter bot token"
                  className="input-field w-full pr-10"
                />
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Chat ID</label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="Enter chat ID"
                className="input-field w-full"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleTelegramTest}
              disabled={telegramTesting}
              className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 disabled:opacity-50"
            >
              {telegramTesting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <TestTube className="w-3 h-3" />
              )}
              {telegramTesting ? 'Sending...' : 'Send Test Message'}
            </button>
            {telegramTestResult && (
              <span className={cn('text-xs', telegramTestResult.success ? 'text-green-400' : 'text-red-400')}>
                {telegramTestResult.success ? '✓' : '✗'} {telegramTestResult.message}
              </span>
            )}
          </div>
        </div>

        {/* Universe Management — DB-backed */}
        <div className="card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Database className="w-5 h-5 text-primary-400" />
              Ticker Universe
            </h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2 py-1 rounded bg-primary/10 text-primary-400 font-mono">
                {stockSummary.total} total
              </span>
              <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-400 font-mono">
                {stockSummary.core} Core
              </span>
              <span className="px-2 py-1 rounded bg-purple-500/10 text-purple-400 font-mono">
                {stockSummary.etf} ETF
              </span>
              <span className="px-2 py-1 rounded bg-orange-500/10 text-orange-400 font-mono">
                {stockSummary.highRisk} High‑Risk
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search ticker, sector..."
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                className="input-field w-full pl-9 text-sm"
              />
            </div>

            {/* Sleeve tabs */}
            <div className="flex gap-1 bg-surface-2 rounded-lg p-1">
              {['ALL', 'CORE', 'ETF', 'HIGH_RISK', 'HEDGE'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStockSleeveFilter(s)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md transition-colors',
                    stockSleeveFilter === s
                      ? 'bg-primary text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {s === 'HIGH_RISK' ? 'High-Risk' : s === 'ALL' ? 'All' : s === 'HEDGE' ? 'Hedge' : s}
                </button>
              ))}
            </div>

            {/* Toggle expand */}
            <button
              onClick={() => setStocksExpanded(!stocksExpanded)}
              className="text-muted-foreground hover:text-foreground p-2"
              title={stocksExpanded ? 'Collapse' : 'Expand'}
            >
              {stocksExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {/* Add ticker inline */}
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              placeholder="Add ticker..."
              value={addTicker}
              onChange={(e) => setAddTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStock()}
              className="input-field text-sm w-32 font-mono"
            />
            <select
              value={addSleeve}
              onChange={(e) => setAddSleeve(e.target.value as 'CORE' | 'ETF' | 'HIGH_RISK' | 'HEDGE')}
              className="input-field text-sm"
            >
              <option value="CORE">Core</option>
              <option value="ETF">ETF</option>
              <option value="HIGH_RISK">High-Risk</option>
              <option value="HEDGE">Hedge</option>
            </select>
            <button
              onClick={handleAddStock}
              disabled={!addTicker.trim()}
              className={cn(
                'btn-primary flex items-center gap-1 text-xs px-3 py-2',
                !addTicker.trim() && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
            <button
              onClick={fetchStocks}
              className="text-muted-foreground hover:text-foreground p-2"
              title="Refresh"
            >
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
            <div className={cn(
              'overflow-auto border border-white/5 rounded-lg',
              stocksExpanded ? 'max-h-[600px]' : 'max-h-[280px]'
            )}>
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
                      <td className="px-3 py-1.5 font-mono font-semibold text-foreground">
                        {stock.ticker}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium',
                          stock.sleeve === 'CORE' && 'bg-blue-500/20 text-blue-400',
                          stock.sleeve === 'ETF' && 'bg-purple-500/20 text-purple-400',
                          stock.sleeve === 'HIGH_RISK' && 'bg-orange-500/20 text-orange-400',
                          stock.sleeve === 'HEDGE' && 'bg-teal-500/20 text-teal-400'
                        )}>
                          {stock.sleeve}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{stock.sector || '—'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{stock.cluster || '—'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{stock.superCluster || '—'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{stock.region || '—'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground font-mono">{stock.currency || '—'}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => handleRemoveStock(stock.ticker)}
                          className="text-muted-foreground hover:text-loss transition-colors"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {stocks.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                        No stocks found{stockSearch ? ` matching "${stockSearch}"` : ''}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-3">
            {stocks.length} stocks shown · Imported from your Planning folder files · Run{' '}
            <code className="text-primary-400 font-mono">npx prisma db seed</code> to re-import
          </p>
        </div>

        {/* NEVER Rules (Read Only) */}
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
              <div
                key={rule}
                className="flex items-center gap-2 p-2 bg-loss/5 border border-loss/20 rounded"
              >
                <Shield className="w-3 h-3 text-loss flex-shrink-0" />
                <span className="text-xs text-loss/80">{rule}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
