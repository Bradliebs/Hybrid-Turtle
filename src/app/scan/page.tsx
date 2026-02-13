'use client';

import { useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import StageFunnel from '@/components/scan/StageFunnel';
import TechnicalFilterGrid from '@/components/scan/TechnicalFilterGrid';
import CandidateTable from '@/components/scan/CandidateTable';
import PositionSizer from '@/components/scan/PositionSizer';
import TickerChart from '@/components/scan/TickerChart';
import StatusBadge from '@/components/shared/StatusBadge';
import RegimeBadge from '@/components/shared/RegimeBadge';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { Search, Play, Filter, Check, X, AlertTriangle, BarChart3, GitMerge } from 'lucide-react';
import Link from 'next/link';

const DEFAULT_USER_ID = 'default-user';

export default function ScanPage() {
  const [activeStage, setActiveStage] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [riskSummary, setRiskSummary] = useState<any | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const { marketRegime, riskProfile, equity } = useStore();

  const stages = [
    { num: 1, label: 'Universe' },
    { num: 2, label: 'Technical Filters' },
    { num: 3, label: 'Classification' },
    { num: 4, label: 'Ranking' },
    { num: 5, label: 'Risk Gates' },
    { num: 6, label: 'Anti-Chase' },
    { num: 7, label: 'Position Sizing' },
  ];

  const candidates = scanResult?.candidates || [];
  const passesAll = candidates.filter((c: any) => c.passesAllFilters);
  const readyCandidates = passesAll.filter((c: any) => c.status === 'READY');
  const watchCandidates = passesAll.filter((c: any) => c.status === 'WATCH');
  const farCandidates = candidates.filter((c: any) => c.status === 'FAR');

  const filterResults = useMemo(() => {
    return candidates.slice(0, 12).map((c: any) => ({
      ticker: c.ticker,
      name: c.name,
      ...c.filterResults,
      passesAll: c.passesAllFilters,
    }));
  }, [candidates]);

  const antiChaseResults = useMemo(() => {
    // Use server-side anti-chase results
    return passesAll.map((c: any) => ({
      ...c,
      guard: c.antiChaseResult || { passed: true, reason: 'Not evaluated' },
    }));
  }, [passesAll]);

  const funnelStages = useMemo(() => {
    const sizedCount = passesAll.filter((c: any) => (c.shares || 0) > 0).length;
    const riskGateCount = scanResult?.passedRiskGates ?? passesAll.filter((c: any) => c.passesRiskGates !== false).length;
    const antiChaseCount = scanResult?.passedAntiChase ?? antiChaseResults.filter((c: any) => c.guard.passed).length;
    return [
      { label: 'Stage 1: Universe', count: scanResult?.totalScanned || 0, color: '#7c3aed' },
      { label: 'Stage 2: Technical', count: scanResult?.passedFilters || 0, color: '#3b82f6' },
      { label: 'Stage 3: Classified', count: candidates.length, color: '#06b6d4' },
      { label: 'Stage 4: Ranked', count: candidates.length, color: '#22c55e' },
      { label: 'Stage 5: Risk Gates', count: riskGateCount, color: '#84cc16' },
      { label: 'Stage 6: Anti-Chase', count: antiChaseCount, color: '#f59e0b' },
      { label: 'Stage 7: Sized', count: sizedCount, color: '#ef4444' },
    ];
  }, [scanResult, candidates.length, passesAll.length, antiChaseResults]);

  const sleeveCounts = useMemo(() => {
    const counts = { CORE: 0, ETF: 0, HIGH_RISK: 0 };
    candidates.forEach((c: any) => {
      counts[c.sleeve as keyof typeof counts] += 1;
    });
    return counts;
  }, [candidates]);

  const riskCapChecks = useMemo(() => {
    if (!riskSummary?.budget) return [];
    const budget = riskSummary.budget;
    return [
      {
        label: `Total Open Risk ≤ ${budget.maxRiskPercent.toFixed(1)}%`,
        passed: budget.usedRiskPercent <= budget.maxRiskPercent,
        current: `${budget.usedRiskPercent.toFixed(1)}%`,
        limit: `${budget.maxRiskPercent.toFixed(1)}%`,
      },
      {
        label: `Max Positions (${budget.maxPositions})`,
        passed: budget.usedPositions < budget.maxPositions,
        current: String(budget.usedPositions),
        limit: String(budget.maxPositions),
      },
      {
        label: `Core Sleeve ≤ ${budget.sleeveUtilization.CORE.max.toFixed(0)}%`,
        passed: budget.sleeveUtilization.CORE.used <= budget.sleeveUtilization.CORE.max,
        current: `${budget.sleeveUtilization.CORE.used.toFixed(1)}%`,
        limit: `${budget.sleeveUtilization.CORE.max.toFixed(0)}%`,
      },
      {
        label: `ETF Sleeve ≤ ${budget.sleeveUtilization.ETF.max.toFixed(0)}%`,
        passed: budget.sleeveUtilization.ETF.used <= budget.sleeveUtilization.ETF.max,
        current: `${budget.sleeveUtilization.ETF.used.toFixed(1)}%`,
        limit: `${budget.sleeveUtilization.ETF.max.toFixed(0)}%`,
      },
      {
        label: `High-Risk Sleeve ≤ ${budget.sleeveUtilization.HIGH_RISK.max.toFixed(0)}%`,
        passed: budget.sleeveUtilization.HIGH_RISK.used <= budget.sleeveUtilization.HIGH_RISK.max,
        current: `${budget.sleeveUtilization.HIGH_RISK.used.toFixed(1)}%`,
        limit: `${budget.sleeveUtilization.HIGH_RISK.max.toFixed(0)}%`,
      },
    ];
  }, [riskSummary]);

  // Restore from sessionStorage immediately on mount (no flash of empty)
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('scanResult');
      if (stored) {
        const parsed = JSON.parse(stored);
        setScanResult(parsed);
        setCachedAt(parsed.cachedAt || null);
      }
    } catch {
      // ignore corrupt sessionStorage
    }
  }, []);

  useEffect(() => {
    const fetchRisk = async () => {
      try {
        const res = await fetch(`/api/risk?userId=${DEFAULT_USER_ID}`);
        if (!res.ok) return;
        const data = await res.json();
        setRiskSummary(data);
      } catch {
        // Silent fail
      }
    };

    const fetchCachedScan = async () => {
      try {
        const res = await fetch('/api/scan');
        if (!res.ok) return;
        const data = await res.json();
        if (data.hasCache) {
          setScanResult(data);
          setCachedAt(data.cachedAt || null);
          // Persist to sessionStorage for instant recovery on navigation
          try { sessionStorage.setItem('scanResult', JSON.stringify(data)); } catch {}
        }
      } catch {
        // Silent fail — no cache yet
      }
    };

    fetchRisk();
    fetchCachedScan();
  }, []);

  const runScan = async () => {
    setIsRunning(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          riskProfile,
          equity,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setScanResult(data);
      setCachedAt(data.cachedAt || new Date().toISOString());
      // Persist to sessionStorage for instant recovery on navigation
      try { sessionStorage.setItem('scanResult', JSON.stringify(data)); } catch {}
    } catch {
      // Silent fail
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <Search className="w-6 h-6 text-primary-400" />
              7-Stage Scan Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Systematic screening pipeline for trade candidates
              {cachedAt && (
                <span className="ml-2 text-xs text-primary-400/60">
                  Cached {new Date(cachedAt).toLocaleString()}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RegimeBadge regime={marketRegime} />
            <Link href="/scan/cross-ref" className="btn-outline text-sm flex items-center gap-2">
              <GitMerge className="w-4 h-4" />
              Cross-Ref
            </Link>
            <Link href="/scan/scores" className="btn-outline text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Dual Scores
            </Link>
            <button
              onClick={runScan}
              className="btn-primary flex items-center gap-2"
              disabled={isRunning}
            >
              <Play className="w-4 h-4" />
              {isRunning ? 'Running Scan...' : 'Run Full Scan'}
            </button>
          </div>
        </div>

        {/* Stage Selector */}
        <div className="card-surface p-2">
          <div className="flex gap-1 overflow-x-auto">
            {stages.map((stage) => (
              <button
                key={stage.num}
                onClick={() => setActiveStage(stage.num)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all',
                  activeStage === stage.num
                    ? 'bg-primary/20 text-primary-400 border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-navy-600/30'
                )}
              >
                <span className="w-6 h-6 rounded-full bg-navy-700 flex items-center justify-center text-xs font-bold">
                  {stage.num}
                </span>
                {stage.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Funnel + Stage Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Stage 1: Universe */}
            {activeStage === 1 && (
              <div className="card-surface p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">Stock Universe</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-navy-800 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-primary-400 font-mono">{sleeveCounts.CORE}</div>
                    <div className="text-xs text-muted-foreground mt-1">Core Stocks</div>
                  </div>
                  <div className="bg-navy-800 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-warning font-mono">{sleeveCounts.HIGH_RISK}</div>
                    <div className="text-xs text-muted-foreground mt-1">High-Risk</div>
                  </div>
                  <div className="bg-navy-800 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-blue-400 font-mono">{sleeveCounts.ETF}</div>
                    <div className="text-xs text-muted-foreground mt-1">Core ETFs</div>
                  </div>
                </div>
              </div>
            )}

            {/* Stage 2: Technical Filters */}
            {activeStage === 2 && (
              <TechnicalFilterGrid results={filterResults} />
            )}

            {/* Stage 3: Classification */}
            {activeStage === 3 && (
              <div className="space-y-4">
                {/* Triggered Banner */}
                {(() => {
                  const triggeredCandidates = passesAll.filter((c: any) => c.distancePercent <= 0);
                  if (triggeredCandidates.length === 0) return null;
                  return (
                    <div className="bg-emerald-500/10 border-2 border-emerald-500/40 rounded-xl p-5 animate-pulse">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <span className="text-xl">⚡</span>
                          </div>
                          <div>
                            <div className="text-lg font-bold text-emerald-400">
                              {triggeredCandidates.length} TRIGGERED — READY TO BUY
                            </div>
                            <div className="text-sm text-emerald-400/70">
                              Price is at or above entry trigger
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {triggeredCandidates.map((c: any) => (
                            <span
                              key={c.ticker}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm font-bold border border-emerald-500/30"
                            >
                              {c.ticker}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-3 gap-4">
                  <div className="card-surface p-4 text-center border-profit/30 border">
                    <div className="text-3xl font-bold text-profit font-mono">{readyCandidates.length}</div>
                    <StatusBadge status="READY" className="mt-2" />
                    <div className="text-xs text-muted-foreground mt-1">≤ 2% from breakout</div>
                  </div>
                  <div className="card-surface p-4 text-center border-warning/30 border">
                    <div className="text-3xl font-bold text-warning font-mono">{watchCandidates.length}</div>
                    <StatusBadge status="WATCH" className="mt-2" />
                    <div className="text-xs text-muted-foreground mt-1">≤ 5% from breakout</div>
                  </div>
                  <div className="card-surface p-4 text-center border-loss/30 border">
                    <div className="text-3xl font-bold text-loss font-mono">{farCandidates.length}</div>
                    <StatusBadge status="FAR" className="mt-2" />
                    <div className="text-xs text-muted-foreground mt-1">&gt; 3% away — ignore</div>
                  </div>
                </div>

                <div className="card-surface p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-2">Entry Trigger Formula</h4>
                  <div className="bg-navy-800 p-3 rounded-lg font-mono text-sm text-muted-foreground">
                    Entry = 20-day High + (10% × ATR buffer)
                  </div>
                </div>
              </div>
            )}

            {/* Stage 4: Ranking */}
            {activeStage === 4 && (
              <CandidateTable candidates={candidates} />
            )}

            {/* Stage 5: Risk Cap Gates */}
            {activeStage === 5 && (
              <div className="card-surface p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">Risk Cap Gate Checks</h3>
                {/* Portfolio-level gates */}
                <div className="space-y-3 mb-6">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Portfolio-Level Gates</h4>
                  {riskCapChecks.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      No portfolio data available to evaluate risk gates.
                    </div>
                  )}
                  {riskCapChecks.map((check, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 bg-navy-800 rounded-lg"
                    >
                      {check.passed ? (
                        <Check className="w-5 h-5 text-profit flex-shrink-0" />
                      ) : (
                        <X className="w-5 h-5 text-loss flex-shrink-0" />
                      )}
                      <span className="text-sm text-foreground flex-1">{check.label}</span>
                      <span className="text-sm font-mono text-muted-foreground">
                        {check.current} / {check.limit}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Per-candidate gate results */}
                {passesAll.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Per-Candidate Gate Results</h4>
                    {passesAll.filter((c: any) => c.riskGateResults).map((c: any) => {
                      const failed = c.riskGateResults.filter((g: any) => !g.passed);
                      return (
                        <div key={c.ticker} className="flex items-center gap-3 p-3 bg-navy-800 rounded-lg">
                          {failed.length === 0 ? (
                            <Check className="w-4 h-4 text-profit flex-shrink-0" />
                          ) : (
                            <X className="w-4 h-4 text-loss flex-shrink-0" />
                          )}
                          <span className="text-primary-400 font-semibold w-16">{c.ticker}</span>
                          <span className="text-sm text-muted-foreground flex-1">
                            {failed.length === 0
                              ? `All ${c.riskGateResults.length} gates passed`
                              : failed.map((g: any) => g.message).join(' | ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Stage 6: Anti-Chasing Guard */}
            {activeStage === 6 && (
              <div className="card-surface p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  Execution Guard (Anti-Chase)
                </h3>
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 mb-4">
                  <p className="text-sm text-warning font-semibold">
                    Triggered candidates must pass: (Price - Entry) / ATR &le; 0.75 AND Price / Entry - 1 &le; 3.0%. Prevents chasing gaps.
                  </p>
                </div>
                <div className="space-y-2">
                  {antiChaseResults.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      Run a scan to evaluate anti-chase checks.
                    </div>
                  )}
                  {antiChaseResults.map((c: any) => (
                    <div key={c.ticker} className="flex items-center gap-3 p-3 bg-navy-800 rounded-lg">
                      {c.guard.passed ? (
                        <Check className="w-4 h-4 text-profit" />
                      ) : (
                        <X className="w-4 h-4 text-loss" />
                      )}
                      <span className="text-primary-400 font-semibold">{c.ticker}</span>
                      <span className="text-sm text-muted-foreground">— {c.guard.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stage 7: Position Sizing */}
            {activeStage === 7 && (
              <CandidateTable candidates={passesAll} showSizing />
            )}
          </div>

          {/* Right Sidebar: Funnel + Position Sizer */}
          <div className="space-y-6">
            <StageFunnel stages={funnelStages} />
            <PositionSizer />
          </div>
        </div>

        {/* Technical Chart — select a candidate ticker to see price + indicators */}
        {candidates.length > 0 && (
          <TickerChart
            tickers={candidates.map((c: any) => ({
              ticker: c.ticker,
              sleeve: c.sleeve,
              status: c.status,
            }))}
            initialTicker={candidates[0]?.ticker}
          />
        )}
      </main>
    </div>
  );
}
