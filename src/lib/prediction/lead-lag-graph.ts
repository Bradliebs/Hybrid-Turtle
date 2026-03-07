/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/lead-lag/route.ts, nightly.ts (weekly)
 * Consumes: lead-lag-analyser.ts, market-data.ts, prisma.ts
 * Risk-sensitive: NO — stores and queries lead-lag graph only
 * Last modified: 2026-03-07
 * Notes: Persists lead-lag edges to DB. Queries upstream movers for a ticker.
 *        At scan time, computes NCS adjustment based on upstream asset movement.
 *        ⛔ Does NOT modify dual-score.ts — adjustment is applied at display layer.
 */

import { prisma } from '@/lib/prisma';
import { getStockQuote } from '@/lib/market-data';
import {
  computeLeadLagEdges,
  MACRO_PROXIES,
  type LeadLagEdge,
} from './lead-lag-analyser';

// ── Types ────────────────────────────────────────────────────

export interface LeadLagSignalResult {
  ticker: string;
  upstreamSignals: UpstreamSignal[];
  ncsAdjustment: number;  // total NCS boost/penalty from lead-lag
}

export interface UpstreamSignal {
  leader: string;
  lag: number;
  correlation: number;
  direction: 'POSITIVE' | 'NEGATIVE';
  /** Recent move of the leader in % */
  recentMove: number;
  /** Whether the move is significant (> 1 ATR equivalent) */
  significant: boolean;
  /** NCS adjustment from this edge */
  adjustment: number;
}

// ── Graph Persistence ────────────────────────────────────────

/**
 * Save computed lead-lag edges to the database.
 * Replaces all existing edges (full refresh model).
 */
export async function saveLeadLagGraph(edges: LeadLagEdge[]): Promise<void> {
  // Delete existing edges and replace with new ones
  await prisma.$transaction([
    prisma.leadLagEdge.deleteMany(),
    ...edges.map(e =>
      prisma.leadLagEdge.create({
        data: {
          leader: e.leader,
          follower: e.follower,
          lag: e.lag,
          correlation: e.correlation,
          pValue: e.pValue,
          direction: e.direction,
        },
      })
    ),
  ]);
}

/**
 * Get all upstream edges for a given ticker (where ticker is the follower).
 */
export async function getUpstreamEdges(ticker: string): Promise<LeadLagEdge[]> {
  const edges = await prisma.leadLagEdge.findMany({
    where: { follower: ticker },
    orderBy: { correlation: 'desc' },
  });

  return edges.map(e => ({
    leader: e.leader,
    follower: e.follower,
    lag: e.lag,
    correlation: e.correlation,
    pValue: e.pValue,
    direction: e.direction as 'POSITIVE' | 'NEGATIVE',
  }));
}

/**
 * Get all edges in the graph (for display/analysis).
 */
export async function getAllEdges(): Promise<LeadLagEdge[]> {
  const edges = await prisma.leadLagEdge.findMany({
    orderBy: [{ follower: 'asc' }, { correlation: 'desc' }],
  });

  return edges.map(e => ({
    leader: e.leader,
    follower: e.follower,
    lag: e.lag,
    correlation: e.correlation,
    pValue: e.pValue,
    direction: e.direction as 'POSITIVE' | 'NEGATIVE',
  }));
}

// ── Live Signal Generation ───────────────────────────────────

/** NCS adjustment magnitude based on correlation strength and move size */
const MAX_BOOST = 10;    // max positive NCS adjustment
const MAX_PENALTY = -15; // max negative NCS adjustment
const SIGNIFICANT_MOVE_PCT = 1.5; // % move threshold to count as "significant"

/**
 * For a candidate ticker, check upstream leaders for recent moves.
 * Returns NCS adjustment and signal details.
 */
export async function computeLeadLagSignals(ticker: string): Promise<LeadLagSignalResult> {
  const edges = await getUpstreamEdges(ticker);

  if (edges.length === 0) {
    return { ticker, upstreamSignals: [], ncsAdjustment: 0 };
  }

  const signals: UpstreamSignal[] = [];
  let totalAdjustment = 0;

  for (const edge of edges) {
    // Get the leader's recent price change
    let recentMove = 0;
    try {
      const quote = await getStockQuote(edge.leader);
      if (quote) {
        recentMove = quote.changePercent;
      }
    } catch {
      continue;
    }

    const significant = Math.abs(recentMove) >= SIGNIFICANT_MOVE_PCT;

    // Compute NCS adjustment:
    // Positive correlation + positive move → boost
    // Positive correlation + negative move → penalty
    // Negative correlation → invert the signal
    let adjustment = 0;
    if (significant) {
      const corrStrength = Math.abs(edge.correlation);
      const moveDirection = recentMove > 0 ? 1 : -1;
      const edgeDirection = edge.direction === 'POSITIVE' ? 1 : -1;
      const effectiveDirection = moveDirection * edgeDirection;

      if (effectiveDirection > 0) {
        // Leader confirms — boost
        adjustment = Math.min(corrStrength * recentMove * 0.5, MAX_BOOST);
      } else {
        // Leader warns — penalty (larger magnitude)
        adjustment = Math.max(corrStrength * recentMove * 0.75, MAX_PENALTY);
      }

      adjustment = Math.round(adjustment * 10) / 10;
      totalAdjustment += adjustment;
    }

    signals.push({
      leader: edge.leader,
      lag: edge.lag,
      correlation: edge.correlation,
      direction: edge.direction,
      recentMove: Math.round(recentMove * 100) / 100,
      significant,
      adjustment,
    });
  }

  // Cap total adjustment
  totalAdjustment = Math.max(MAX_PENALTY, Math.min(MAX_BOOST, totalAdjustment));

  return {
    ticker,
    upstreamSignals: signals,
    ncsAdjustment: Math.round(totalAdjustment * 10) / 10,
  };
}

// ── Weekly Recomputation ─────────────────────────────────────

/**
 * Full weekly recomputation of the lead-lag graph.
 * Fetches active tickers from DB, computes edges, stores results.
 */
export async function recomputeLeadLagGraph(maxCandidates = 50): Promise<{
  edgesFound: number;
  tickersProcessed: number;
}> {
  // Get a sample of active tickers
  const stocks = await prisma.stock.findMany({
    where: { active: true },
    select: { ticker: true },
    orderBy: { ticker: 'asc' },
  });

  // Shuffle and sample for speed
  const shuffled = [...stocks].sort(() => Math.random() - 0.5);
  const tickers = shuffled.slice(0, maxCandidates).map(s => s.ticker);

  console.log(`[LeadLag] Computing edges for ${tickers.length} tickers + ${MACRO_PROXIES.length} proxies...`);
  const result = await computeLeadLagEdges(tickers, maxCandidates);

  if (result.edges.length > 0) {
    await saveLeadLagGraph(result.edges);
  }

  console.log(`[LeadLag] Found ${result.edges.length} significant edges across ${result.tickersProcessed} tickers`);

  // Store computation record as a signal snapshot
  if (result.edges.length > 0) {
    await prisma.leadLagSignal.create({
      data: {
        edgeCount: result.edges.length,
        tickersProcessed: result.tickersProcessed,
        topLeader: result.edges[0]?.leader ?? null,
        topFollower: result.edges[0]?.follower ?? null,
        topCorrelation: result.edges[0]?.correlation ?? null,
      },
    });
  }

  return {
    edgesFound: result.edges.length,
    tickersProcessed: result.tickersProcessed,
  };
}
