#!/usr/bin/env npx tsx
/**
 * Audit Harness — exercises core trading functions against synthetic fixtures.
 * Produces reports/audit_snapshot.md with pipeline output.
 *
 * Usage:  npm run audit:harness
 *    or:  npx tsx scripts/audit_harness.ts
 *
 * No strategy logic is changed — this is a read-only diagnostic tool.
 */

import * as fs from 'fs';
import * as path from 'path';

import { runTechnicalFilters, classifyCandidate, rankCandidate } from '../src/lib/scan-engine';
import { checkAntiChasingGuard } from '../src/lib/scan-guards';
import { validateRiskGates } from '../src/lib/risk-gates';
import { calculateStopRecommendation, getProtectionLevel } from '../src/lib/stop-manager';
import { calculatePositionSize, calculateRMultiple } from '../src/lib/position-sizer';
import { calculateAdaptiveBuffer } from '../src/lib/modules/adaptive-atr-buffer';

import type { TechnicalData, Sleeve, RiskProfileType, CandidateStatus } from '../src/types';
import { ATR_STOP_MULTIPLIER } from '../src/types';

// ── Synthetic Fixture Data ──────────────────────────────────

interface FixtureTicker {
  ticker: string;
  sleeve: Sleeve;
  sector: string;
  cluster: string;
  price: number;
  technicals: TechnicalData;
}

const FIXTURES: FixtureTicker[] = [
  {
    ticker: 'AAPL',
    sleeve: 'CORE',
    sector: 'Technology',
    cluster: 'Big Tech',
    price: 210.0,
    technicals: {
      ma200: 195.0,
      adx: 28,
      plusDI: 24,
      minusDI: 18,
      atr: 4.5,
      atr20DayAgo: 4.0,
      atrSpiking: false,
      atrPercent: 2.1,
      twentyDayHigh: 212.0,
      efficiency: 55,
      relativeStrength: 72,
      volumeRatio: 1.4,
    },
  },
  {
    ticker: 'MSFT',
    sleeve: 'CORE',
    sector: 'Technology',
    cluster: 'Big Tech',
    price: 420.0,
    technicals: {
      ma200: 400.0,
      adx: 32,
      plusDI: 30,
      minusDI: 15,
      atr: 8.0,
      atr20DayAgo: 7.5,
      atrSpiking: false,
      atrPercent: 1.9,
      twentyDayHigh: 425.0,
      efficiency: 62,
      relativeStrength: 80,
      volumeRatio: 1.1,
    },
  },
  {
    ticker: 'PLTR',
    sleeve: 'HIGH_RISK',
    sector: 'Technology',
    cluster: 'Data Analytics',
    price: 38.0,
    technicals: {
      ma200: 28.0,
      adx: 35,
      plusDI: 28,
      minusDI: 12,
      atr: 2.8,
      atr20DayAgo: 2.0,
      atrSpiking: true,
      atrPercent: 7.4,
      twentyDayHigh: 39.0,
      efficiency: 45,
      relativeStrength: 88,
      volumeRatio: 2.1,
    },
  },
  {
    ticker: 'XOM',
    sleeve: 'CORE',
    sector: 'Energy',
    cluster: 'Oil Majors',
    price: 105.0,
    technicals: {
      ma200: 110.0, // below MA200 — should fail filter
      adx: 18,      // below 20 — should fail filter
      plusDI: 14,
      minusDI: 22,  // -DI > +DI — should fail filter
      atr: 3.0,
      atr20DayAgo: 2.8,
      atrSpiking: false,
      atrPercent: 2.9,
      twentyDayHigh: 112.0,
      efficiency: 25, // below 30 — efficiency gate fail
      relativeStrength: 30,
      volumeRatio: 0.8,
    },
  },
  {
    ticker: 'VWRL.L',
    sleeve: 'ETF',
    sector: 'Global',
    cluster: 'Broad ETF',
    price: 9500.0,
    technicals: {
      ma200: 9200.0,
      adx: 22,
      plusDI: 20,
      minusDI: 16,
      atr: 150.0,
      atr20DayAgo: 140.0,
      atrSpiking: false,
      atrPercent: 1.6,
      twentyDayHigh: 9550.0,
      efficiency: 40,
      relativeStrength: 50,
      volumeRatio: 0.9,
    },
  },
];

// Existing portfolio for risk gate checks
const EXISTING_POSITIONS = [
  {
    id: 'pos-1', ticker: 'NVDA', sleeve: 'CORE' as Sleeve,
    sector: 'Technology', cluster: 'Semiconductors',
    value: 3200, riskDollars: 160, shares: 20,
    entryPrice: 140, currentStop: 132, currentPrice: 160,
  },
  {
    id: 'pos-2', ticker: 'META', sleeve: 'CORE' as Sleeve,
    sector: 'Technology', cluster: 'Big Tech',
    value: 2800, riskDollars: 120, shares: 5,
    entryPrice: 520, currentStop: 496, currentPrice: 560,
  },
];

const EQUITY = 15000;
const RISK_PROFILE: RiskProfileType = 'BALANCED';
const SIMULATED_REGIME = 'BULLISH';

// ── Output Schema (exported for test) ──────────────────────

export interface AuditRow {
  ticker: string;
  sleeve: Sleeve;
  filtersPass: boolean;
  efficiencyPass: boolean;
  status: CandidateStatus | 'BLOCKED';
  triggerDistance: string;
  entryTrigger: number;
  stopPrice: number;
  rank: number;
  riskGates: { gate: string; passed: boolean; current: number; limit: number }[];
  antiChase: { passed: boolean; reason: string };
  sizing: { shares: number; riskDollars: number; riskPercent: number; totalCost: number } | null;
  stopRec: { newStop: number; newLevel: string; reason: string } | null;
  protectionLevel: string;
  openRiskContribution: number;
}

export interface AuditSnapshot {
  generatedAt: string;
  regime: string;
  equity: number;
  riskProfile: RiskProfileType;
  existingPositions: number;
  rows: AuditRow[];
}

// ── Harness Logic ───────────────────────────────────────────

export function runAuditHarness(): AuditSnapshot {
  const rows: AuditRow[] = [];

  for (const fix of FIXTURES) {
    // Stage 2: Technical filters
    const filters = runTechnicalFilters(fix.price, fix.technicals, fix.sleeve);

    // ATR spike override (replicates scan-engine inline logic)
    let effectivePass = filters.passesAll;
    let atrOverrideStatus: CandidateStatus | null = null;
    if (fix.technicals.atrSpiking && fix.technicals.plusDI > fix.technicals.minusDI) {
      // SOFT_CAP: READY → WATCH
      atrOverrideStatus = 'WATCH';
    } else if (fix.technicals.atrSpiking && fix.technicals.plusDI <= fix.technicals.minusDI) {
      // HARD_BLOCK
      effectivePass = false;
      atrOverrideStatus = 'FAR';
    }

    // Adaptive buffer entry trigger
    const buffer = calculateAdaptiveBuffer(
      fix.ticker,
      fix.technicals.twentyDayHigh,
      fix.technicals.atr,
      fix.technicals.atrPercent,
    );
    const entryTrigger = buffer.adjustedEntryTrigger;
    const stopPrice = entryTrigger - ATR_STOP_MULTIPLIER * fix.technicals.atr;

    // Stage 3: Classification
    let status: CandidateStatus | 'BLOCKED' = effectivePass
      ? classifyCandidate(fix.price, entryTrigger)
      : 'BLOCKED';

    // ATR spike override on status
    if (atrOverrideStatus === 'WATCH' && status === 'READY') {
      status = 'WATCH';
    } else if (atrOverrideStatus === 'FAR') {
      status = 'BLOCKED';
    }

    // Efficiency downgrade
    if (!filters.efficiencyAbove30 && status === 'READY') {
      status = 'WATCH';
    }

    const distance = ((entryTrigger - fix.price) / fix.price) * 100;

    // Stage 4: Ranking
    const rank = effectivePass
      ? rankCandidate(fix.sleeve, fix.technicals, status === 'BLOCKED' ? 'FAR' : status)
      : 0;

    // Stage 5: Risk gates
    const newPosValue = fix.price * 10; // assume 10 shares for gate sizing
    const newPosRisk = (entryTrigger - stopPrice) * 10;
    const riskGates = validateRiskGates(
      {
        sleeve: fix.sleeve,
        sector: fix.sector,
        cluster: fix.cluster,
        value: newPosValue,
        riskDollars: newPosRisk,
      },
      EXISTING_POSITIONS,
      EQUITY,
      RISK_PROFILE,
    );

    // Stage 6: Anti-chase (simulate Monday)
    const antiChase = checkAntiChasingGuard(fix.price, entryTrigger, fix.technicals.atr, 1);

    // Position sizing (only if filters pass)
    let sizing: AuditRow['sizing'] = null;
    if (effectivePass && stopPrice > 0 && stopPrice < entryTrigger) {
      try {
        const result = calculatePositionSize({
          equity: EQUITY,
          riskProfile: RISK_PROFILE,
          entryPrice: entryTrigger,
          stopPrice,
          sleeve: fix.sleeve,
        });
        sizing = {
          shares: result.shares,
          riskDollars: result.riskDollars,
          riskPercent: result.riskPercent,
          totalCost: result.totalCost,
        };
      } catch {
        sizing = null;
      }
    }

    // Stop recommendation (simulate existing position at entry)
    const initialRisk = entryTrigger - stopPrice;
    const rMultiple = initialRisk > 0 ? calculateRMultiple(fix.price, entryTrigger, initialRisk) : 0;
    const protectionLevel = getProtectionLevel(rMultiple);
    const stopRec = initialRisk > 0
      ? calculateStopRecommendation(
          fix.price,
          entryTrigger,
          initialRisk,
          stopPrice,
          'INITIAL',
          fix.technicals.atr,
        )
      : null;

    // Open risk contribution
    const openRisk = sizing
      ? Math.max(0, sizing.riskDollars)
      : 0;

    rows.push({
      ticker: fix.ticker,
      sleeve: fix.sleeve,
      filtersPass: effectivePass,
      efficiencyPass: filters.efficiencyAbove30,
      status,
      triggerDistance: `${distance >= 0 ? '+' : ''}${distance.toFixed(2)}%`,
      entryTrigger: Math.round(entryTrigger * 100) / 100,
      stopPrice: Math.round(stopPrice * 100) / 100,
      rank,
      riskGates: riskGates.map(g => ({ gate: g.gate, passed: g.passed, current: g.current, limit: g.limit })),
      antiChase: { passed: antiChase.passed, reason: antiChase.reason },
      sizing,
      stopRec: stopRec ? { newStop: stopRec.newStop, newLevel: stopRec.newLevel, reason: stopRec.reason } : null,
      protectionLevel,
      openRiskContribution: openRisk,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    regime: SIMULATED_REGIME,
    equity: EQUITY,
    riskProfile: RISK_PROFILE,
    existingPositions: EXISTING_POSITIONS.length,
    rows,
  };
}

// ── Markdown Generator ──────────────────────────────────────

export function generateMarkdownReport(snapshot: AuditSnapshot): string {
  const lines: string[] = [];

  lines.push('# Audit Snapshot Report');
  lines.push('');
  lines.push(`**Generated:** ${snapshot.generatedAt}  `);
  lines.push(`**Regime:** ${snapshot.regime}  `);
  lines.push(`**Equity:** £${snapshot.equity.toLocaleString()}  `);
  lines.push(`**Risk Profile:** ${snapshot.riskProfile}  `);
  lines.push(`**Existing Positions:** ${snapshot.existingPositions}  `);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Summary table
  lines.push('## Pipeline Summary');
  lines.push('');
  lines.push('| Ticker | Sleeve | Filters | Status | Trigger Dist | Rank | Gates | Anti-Chase | Shares | Risk £ | Risk % | Protection |');
  lines.push('|--------|--------|---------|--------|-------------|------|-------|------------|--------|--------|--------|------------|');

  for (const r of snapshot.rows) {
    const gatesPass = r.riskGates.every(g => g.passed) ? '✓' : '✗';
    const acPass = r.antiChase.passed ? '✓' : '✗';
    const shares = r.sizing?.shares ?? '—';
    const riskD = r.sizing ? `£${r.sizing.riskDollars.toFixed(0)}` : '—';
    const riskP = r.sizing ? `${r.sizing.riskPercent.toFixed(2)}%` : '—';

    lines.push(
      `| ${r.ticker} | ${r.sleeve} | ${r.filtersPass ? '✓' : '✗'} | ${r.status} | ${r.triggerDistance} | ${r.rank} | ${gatesPass} | ${acPass} | ${shares} | ${riskD} | ${riskP} | ${r.protectionLevel} |`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // Detailed sections per ticker
  lines.push('## Detailed Results');
  lines.push('');

  for (const r of snapshot.rows) {
    lines.push(`### ${r.ticker} (${r.sleeve})`);
    lines.push('');
    lines.push(`- **Filters:** ${r.filtersPass ? 'PASS' : 'FAIL'} | Efficiency: ${r.efficiencyPass ? 'PASS' : 'FAIL'}`);
    lines.push(`- **Status:** ${r.status} | Distance: ${r.triggerDistance}`);
    lines.push(`- **Entry Trigger:** ${r.entryTrigger} | Stop: ${r.stopPrice}`);
    lines.push(`- **Rank Score:** ${r.rank}`);
    lines.push(`- **Protection Level:** ${r.protectionLevel}`);
    lines.push('');

    // Risk gates detail
    lines.push('**Risk Gates:**');
    lines.push('');
    lines.push('| Gate | Pass | Current | Limit |');
    lines.push('|------|------|---------|-------|');
    for (const g of r.riskGates) {
      lines.push(`| ${g.gate} | ${g.passed ? '✓' : '✗'} | ${g.current.toFixed(1)} | ${g.limit.toFixed(1)} |`);
    }
    lines.push('');

    // Anti-chase
    lines.push(`**Anti-Chase (Monday):** ${r.antiChase.passed ? '✓ PASS' : '✗ FAIL'} — ${r.antiChase.reason}`);
    lines.push('');

    // Sizing
    if (r.sizing) {
      lines.push(`**Position Size:** ${r.sizing.shares} shares | Cost: £${r.sizing.totalCost.toFixed(0)} | Risk: £${r.sizing.riskDollars.toFixed(0)} (${r.sizing.riskPercent.toFixed(2)}%)`);
    } else {
      lines.push('**Position Size:** N/A (filters not passed or invalid stop)');
    }
    lines.push('');

    // Stop recommendation
    if (r.stopRec) {
      lines.push(`**Stop Recommendation:** → ${r.stopRec.newStop.toFixed(2)} (${r.stopRec.newLevel}) — ${r.stopRec.reason}`);
    } else {
      lines.push('**Stop Recommendation:** None (no upgrade needed)');
    }
    lines.push('');

    lines.push(`**Open Risk Contribution:** £${r.openRiskContribution.toFixed(0)}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ── CLI Entry Point ─────────────────────────────────────────

function main() {
  console.log('[AuditHarness] Running against synthetic fixtures...');

  const snapshot = runAuditHarness();
  const markdown = generateMarkdownReport(snapshot);

  // Ensure reports/ directory exists
  const reportsDir = path.resolve(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const outPath = path.join(reportsDir, 'audit_snapshot.md');
  fs.writeFileSync(outPath, markdown, 'utf-8');

  console.log(`[AuditHarness] Report written to: ${outPath}`);
  console.log('');

  // Print quick summary to console
  console.log('  Summary:');
  console.log(`    Regime:    ${snapshot.regime}`);
  console.log(`    Equity:    £${snapshot.equity.toLocaleString()}`);
  console.log(`    Profile:   ${snapshot.riskProfile}`);
  console.log(`    Tickers:   ${snapshot.rows.length}`);
  console.log(`    Passing:   ${snapshot.rows.filter(r => r.filtersPass).length}`);
  console.log(`    READY:     ${snapshot.rows.filter(r => r.status === 'READY').length}`);
  console.log(`    WATCH:     ${snapshot.rows.filter(r => r.status === 'WATCH').length}`);
  console.log(`    BLOCKED:   ${snapshot.rows.filter(r => r.status === 'BLOCKED').length}`);
  console.log('');
}

// Only run main() when executed directly (not when imported by tests)
const isDirectRun = process.argv[1]?.includes('audit_harness');
if (isDirectRun) {
  main();
}
