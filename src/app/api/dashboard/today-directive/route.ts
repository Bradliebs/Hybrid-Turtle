/**
 * DEPENDENCIES
 * Consumed by: TodayDirectiveCard.tsx (dashboard)
 * Consumes: prisma.ts, market-data.ts, position-sizer.ts, stop-manager.ts, modules/laggard-purge.ts, default-user.ts
 * Risk-sensitive: NO (read-only aggregation)
 * Last modified: 2026-03-03
 * Notes: Lightweight directive endpoint — fetches live prices once for open positions,
 *        then derives stop/laggard/pyramid counts. DB queries run in parallel.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { getMarketRegime } from '@/lib/market-data';
import { getBatchPrices } from '@/lib/market-data';
import { calculateRMultiple } from '@/lib/position-sizer';
import { generateStopRecommendations, generateTrailingStopRecommendations } from '@/lib/stop-manager';
import { detectLaggards } from '@/lib/modules';
import { apiError } from '@/lib/api-response';
import { getExecutionMode } from '@/lib/execution-mode';
import type { HealthStatus } from '@/types';

// ── Phase enum ──
const PHASES = ['PLANNING', 'OBSERVATION', 'EXECUTION', 'MAINTENANCE'] as const;
type Phase = (typeof PHASES)[number];

// Sunday=0 → PLANNING, Monday=1 → OBSERVATION, Tuesday=2 → EXECUTION, Wed–Sat → MAINTENANCE
function getPhaseForDay(day: number): Phase {
  switch (day) {
    case 0: return 'PLANNING';
    case 1: return 'OBSERVATION';
    case 2: return 'EXECUTION';
    default: return 'MAINTENANCE';
  }
}

// ── Directive state ──
const DIRECTIVE_STATES = [
  'SYSTEM_ALERT',
  'DATA_WARNING',
  'PLANNING',
  'OBSERVATION',
  'EXECUTION_BLOCKED',
  'EXECUTION_READY',
  'EXECUTION_NO_CANDIDATES',
  'OPPORTUNISTIC_AVAILABLE',
  'OPPORTUNISTIC_NONE',
  'MAINTENANCE_SIDEWAYS',
  'MAINTENANCE_STOPS',
  'MAINTENANCE_LAGGARD',
  'MAINTENANCE_PYRAMID',
  'MAINTENANCE_CLEAR',
] as const;
type DirectiveState = (typeof DIRECTIVE_STATES)[number];

// ── Zod response schema ──
const DirectiveResponseSchema = z.object({
  phase: z.enum(PHASES),
  regime: z.enum(['BULLISH', 'SIDEWAYS', 'BEARISH']),
  heartbeatStatus: z.enum(['SUCCESS', 'FAILED', 'RUNNING', 'NONE']),
  heartbeatAgeHours: z.number(),
  healthOverall: z.enum(['GREEN', 'YELLOW', 'RED']),
  scanAgeHours: z.number(),
  readyCandidateCount: z.number(),
  stopsPending: z.number(),
  laggardCount: z.number(),
  pyramidCount: z.number(),
  state: z.enum(DIRECTIVE_STATES),
  headline: z.string(),
  subtext: z.string().nullable(),
  action: z.object({ label: z.string(), href: z.string() }).nullable(),
});

type DirectiveResponse = z.infer<typeof DirectiveResponseSchema>;

// ── Headline / subtext / action lookup ──
function buildDirectiveContent(
  state: DirectiveState,
  data: {
    heartbeatAgeHours: number;
    scanAgeHours: number;
    readyCandidateCount: number;
    stopsPending: number;
    laggardCount: number;
    pyramidCount: number;
  }
): { headline: string; subtext: string | null; action: { label: string; href: string } | null } {
  switch (state) {
    case 'SYSTEM_ALERT':
      return {
        headline: 'Nightly run failed. Data may be stale.',
        subtext: 'Check heartbeat logs before trading.',
        action: { label: 'View Health Check', href: '/dashboard' },
      };
    case 'DATA_WARNING':
      return {
        headline: `Last nightly run was ${Math.round(data.heartbeatAgeHours)} hours ago.`,
        subtext: 'Run nightly to refresh data before trading.',
        action: { label: 'Run Nightly', href: '/dashboard' },
      };
    case 'PLANNING': {
      const scanText = data.scanAgeHours > 168
        ? 'No scan this week yet'
        : `Last scan: ${Math.round(data.scanAgeHours)} hours ago`;
      return {
        headline: 'Planning day. Run the scan and review candidates for Tuesday.',
        subtext: scanText,
        action: { label: 'Run Scan', href: '/scan' },
      };
    }
    case 'OBSERVATION':
      return {
        headline: 'Observation day. No new entries today.',
        subtext: data.stopsPending > 0 ? `${data.stopsPending} stop updates pending` : null,
        action: data.stopsPending > 0 ? { label: 'Review Stops', href: '/risk' } : null,
      };
    case 'EXECUTION_BLOCKED':
      return {
        headline: 'Execution day — regime is BEARISH. New entries blocked.',
        subtext: 'Monitor open positions only.',
        action: { label: 'View Positions', href: '/portfolio/positions' },
      };
    case 'EXECUTION_READY':
      return {
        headline: `${data.readyCandidateCount} candidate${data.readyCandidateCount === 1 ? '' : 's'} ready to execute.`,
        subtext: 'Complete pre-trade checklist before buying.',
        action: { label: 'Go to Positions', href: '/portfolio/positions' },
      };
    case 'EXECUTION_NO_CANDIDATES':
      return {
        headline: 'Execution day — no READY candidates from last scan.',
        subtext: `Last scan: ${Math.round(data.scanAgeHours)} hours ago`,
        action: { label: 'Run Scan', href: '/scan' },
      };
    case 'MAINTENANCE_STOPS':
      return {
        headline: `${data.stopsPending} trailing stop recommendation${data.stopsPending === 1 ? '' : 's'} to apply.`,
        subtext: null,
        action: { label: 'Review Stops', href: '/risk' },
      };
    case 'MAINTENANCE_LAGGARD':
      return {
        headline: `${data.laggardCount} position${data.laggardCount === 1 ? '' : 's'} flagged as dead money.`,
        subtext: 'Review for potential exit.',
        action: { label: 'View Positions', href: '/portfolio/positions' },
      };
    case 'MAINTENANCE_PYRAMID':
      return {
        headline: `${data.pyramidCount} pyramid opportunit${data.pyramidCount === 1 ? 'y' : 'ies'} at ≥2R.`,
        subtext: null,
        action: { label: 'View Positions', href: '/portfolio/positions' },
      };
    case 'MAINTENANCE_CLEAR':
      return {
        headline: 'Maintenance day. No urgent actions.',
        subtext: null,
        action: null,
      };
    case 'OPPORTUNISTIC_AVAILABLE':
      return {
        headline: `${data.readyCandidateCount} Auto-Yes candidate${data.readyCandidateCount === 1 ? '' : 's'} available for mid-week entry.`,
        subtext: `NCS ≥ 70 · FWS ≤ 30 · Max 1 position today`,
        action: { label: 'View Candidates', href: '/plan' },
      };
    case 'OPPORTUNISTIC_NONE':
      return {
        headline: 'Opportunistic window open — no candidates meet mid-week bar.',
        subtext: 'Next planned execution: Tuesday',
        action: null,
      };
    case 'MAINTENANCE_SIDEWAYS':
      return {
        headline: 'Regime is SIDEWAYS — opportunistic entries require BULLISH.',
        subtext: 'Next planned execution: Tuesday',
        action: { label: 'View Positions', href: '/portfolio/positions' },
      };
  }
}

// ── State priority resolution ──
function resolveState(data: {
  phase: Phase;
  regime: string;
  heartbeatStatus: string;
  heartbeatAgeHours: number;
  healthOverall: string;
  readyCandidateCount: number;
  stopsPending: number;
  laggardCount: number;
  pyramidCount: number;
}, now: Date): DirectiveState {
  // 1. SYSTEM_ALERT — heartbeat failed OR health RED
  if (data.heartbeatStatus === 'FAILED' || data.healthOverall === 'RED') return 'SYSTEM_ALERT';
  // 2. DATA_WARNING — stale nightly
  if (data.heartbeatAgeHours > 18) return 'DATA_WARNING';
  // 3. PLANNING
  if (data.phase === 'PLANNING') return 'PLANNING';
  // 4. OBSERVATION
  if (data.phase === 'OBSERVATION') return 'OBSERVATION';
  // 5–7. EXECUTION variants
  if (data.phase === 'EXECUTION') {
    if (data.regime === 'BEARISH') return 'EXECUTION_BLOCKED';
    if (data.readyCandidateCount > 0) return 'EXECUTION_READY';
    return 'EXECUTION_NO_CANDIDATES';
  }
  // 8–11. MAINTENANCE / OPPORTUNISTIC variants
  // Check if Wed-Fri and eligible for opportunistic mode
  const execMode = getExecutionMode(now.getDay(), data.regime);
  if (execMode.isOpportunistic) {
    if (execMode.canEnter && data.readyCandidateCount > 0) return 'OPPORTUNISTIC_AVAILABLE';
    if (execMode.canEnter) return 'OPPORTUNISTIC_NONE';
    if (data.regime === 'SIDEWAYS') return 'MAINTENANCE_SIDEWAYS';
  }
  if (data.stopsPending > 0) return 'MAINTENANCE_STOPS';
  if (data.laggardCount > 0) return 'MAINTENANCE_LAGGARD';
  if (data.pyramidCount > 0) return 'MAINTENANCE_PYRAMID';
  return 'MAINTENANCE_CLEAR';
}

// ── Map heartbeat DB status to our simplified enum ──
function mapHeartbeatStatus(dbStatus: string | null): 'SUCCESS' | 'FAILED' | 'RUNNING' | 'NONE' {
  if (!dbStatus) return 'NONE';
  const upper = dbStatus.toUpperCase();
  if (upper === 'OK' || upper === 'SUCCESS') return 'SUCCESS';
  if (upper === 'FAILED' || upper === 'ERROR') return 'FAILED';
  if (upper === 'RUNNING') return 'RUNNING';
  return 'SUCCESS'; // default for unknown statuses like 'OK'
}

// ── GET handler ──
export async function GET(_request: NextRequest) {
  try {
    const userId = await ensureDefaultUser();
    const now = new Date();
    const phase = getPhaseForDay(now.getDay());

    // ── Phase 1: Parallel DB queries ──
    const [latestHealth, latestHeartbeat, latestScan, openPositions] = await Promise.all([
      prisma.healthCheck.findFirst({
        where: { userId },
        orderBy: { runDate: 'desc' },
        select: { overall: true },
      }),
      prisma.heartbeat.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { status: true, timestamp: true },
      }),
      prisma.scan.findFirst({
        where: { userId },
        orderBy: { runDate: 'desc' },
        include: {
          results: {
            where: { status: 'READY' },
            select: { id: true },
          },
        },
      }),
      prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: { select: { ticker: true, currency: true, sleeve: true } } },
      }),
    ]);

    // ── Derived: heartbeat ──
    const heartbeatStatus = mapHeartbeatStatus(latestHeartbeat?.status ?? null);
    const heartbeatAgeHours = latestHeartbeat
      ? (now.getTime() - latestHeartbeat.timestamp.getTime()) / (1000 * 60 * 60)
      : 999; // No heartbeat → treat as very stale

    // ── Derived: health ──
    const healthOverall = (latestHealth?.overall as HealthStatus) ?? 'GREEN';

    // ── Derived: scan ──
    const scanAgeHours = latestScan
      ? (now.getTime() - latestScan.runDate.getTime()) / (1000 * 60 * 60)
      : 999;
    const readyCandidateCount = latestScan?.results.length ?? 0;

    // ── Phase 2: regime + live prices (parallel) ──
    const openTickers = openPositions.map((p) => p.stock.ticker);
    const [regime, livePrices] = await Promise.all([
      getMarketRegime().catch(() => 'SIDEWAYS' as const),
      openTickers.length > 0 ? getBatchPrices(openTickers) : Promise.resolve({} as Record<string, number>),
    ]);

    // ── Phase 3: stops, laggards, pyramids (need live prices) ──
    let stopsPending = 0;
    let laggardCount = 0;
    let pyramidCount = 0;

    if (openPositions.length > 0) {
      // Stop recommendations — merge R-based + trailing ATR, keeping highest per position
      // (mirrors the merge logic in GET /api/stops so counts always match)
      const priceMap = new Map(Object.entries(livePrices));
      const [rBasedRecs, trailingRecs] = await Promise.all([
        generateStopRecommendations(userId, priceMap).catch(() => []),
        generateTrailingStopRecommendations(userId).catch(() => []),
      ]);
      const mergedStops = new Map<string, number>(); // positionId → highest newStop
      for (const r of rBasedRecs) {
        mergedStops.set(r.positionId, r.newStop);
      }
      for (const r of trailingRecs) {
        const existing = mergedStops.get(r.positionId);
        if (!existing || r.trailingStop > existing) {
          mergedStops.set(r.positionId, r.trailingStop);
        }
      }
      stopsPending = mergedStops.size;

      // Laggards — build enriched position array for detectLaggards
      const enriched = openPositions.map((p) => ({
        id: p.id,
        ticker: p.stock.ticker,
        entryPrice: p.entryPrice,
        entryDate: p.entryDate,
        currentPrice: livePrices[p.stock.ticker] ?? p.entryPrice,
        initialRisk: p.initialRisk,
        shares: p.shares,
        sleeve: p.stock.sleeve,
      }));
      const laggards = detectLaggards(enriched);
      laggardCount = laggards.length;

      // Pyramid count — positions at >= 2R (not HEDGE)
      for (const p of openPositions) {
        if (p.stock.sleeve === 'HEDGE') continue;
        const price = livePrices[p.stock.ticker];
        if (!price) continue;
        const rMul = calculateRMultiple(price, p.entryPrice, p.initialRisk);
        if (rMul >= 2) pyramidCount++;
      }
    }

    // ── Resolve state, headline, subtext, action ──
    const state = resolveState({
      phase,
      regime,
      heartbeatStatus,
      heartbeatAgeHours,
      healthOverall,
      readyCandidateCount,
      stopsPending,
      laggardCount,
      pyramidCount,
    }, now);

    const { headline, subtext, action } = buildDirectiveContent(state, {
      heartbeatAgeHours,
      scanAgeHours,
      readyCandidateCount,
      stopsPending,
      laggardCount,
      pyramidCount,
    });

    const response: DirectiveResponse = {
      phase,
      regime,
      heartbeatStatus,
      heartbeatAgeHours: Math.round(heartbeatAgeHours * 10) / 10, // 1 decimal
      healthOverall,
      scanAgeHours: Math.round(scanAgeHours * 10) / 10,
      readyCandidateCount,
      stopsPending,
      laggardCount,
      pyramidCount,
      state,
      headline,
      subtext,
      action,
    };

    // Validate with Zod before returning
    const validated = DirectiveResponseSchema.parse(response);
    return NextResponse.json(validated);
  } catch (error) {
    console.error('[Today Directive] Error:', error);
    return apiError(500, 'DIRECTIVE_FAILED', 'Failed to compute today directive', (error as Error).message, true);
  }
}
