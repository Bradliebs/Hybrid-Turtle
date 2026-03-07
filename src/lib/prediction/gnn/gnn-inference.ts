/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/gnn-score/route.ts, GraphScorePanel
 * Consumes: graph-builder.ts, message-passing.ts, prisma.ts
 * Risk-sensitive: NO — read-only scoring, no position changes
 * Last modified: 2026-03-07
 * Notes: At scan time, loads latest trained weights, builds graph from
 *        current features, runs forward pass, returns per-ticker GNN score.
 *        GNN adjustment = (gnnScore - 0.5) × GNN_WEIGHT_FACTOR × 100
 *        Applied as a POST-PROCESSING NCS adjustment, logged separately.
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';
import {
  loadGraphFromDB,
  type NodeFeatures,
} from './graph-builder';
import {
  forwardPass,
  deserialiseWeights,
  initWeights,
  type GNNWeights,
} from './message-passing';

// ── Constants ────────────────────────────────────────────────

/** GNN influence on final NCS: 10% initially, increase as model matures */
export const GNN_WEIGHT_FACTOR = 0.10;

// ── Types ────────────────────────────────────────────────────

export interface GNNScoreResult {
  ticker: string;
  /** Raw GNN output 0–1 (probability of achieving ≥ 1.5R) */
  gnnScore: number;
  /** NCS adjustment derived from GNN: (score - 0.5) × FACTOR × 100 */
  ncsAdjustment: number;
  /** Whether a trained model was used (vs. random init fallback) */
  modelTrained: boolean;
  /** Upstream influence: top-3 neighbours contributing to this score */
  topInfluencers: Array<{ ticker: string; weight: number }>;
}

export interface BatchGNNResult {
  scores: Map<string, GNNScoreResult>;
  modelVersion: string | null;
  nodesInGraph: number;
}

// ── Model Loading ────────────────────────────────────────────

let cachedWeights: GNNWeights | null = null;
let cachedModelId: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function loadLatestWeights(): Promise<{ weights: GNNWeights; trained: boolean; modelId: string | null }> {
  // Check memory cache
  if (cachedWeights && cacheExpiry > Date.now() && cachedModelId) {
    return { weights: cachedWeights, trained: true, modelId: cachedModelId };
  }

  const latest = await prisma.gNNModelWeights.findFirst({
    orderBy: { trainedAt: 'desc' },
  });

  if (latest) {
    const weights = deserialiseWeights(latest.weightsJson);
    cachedWeights = weights;
    cachedModelId = String(latest.id);
    cacheExpiry = Date.now() + CACHE_TTL;
    return { weights, trained: true, modelId: String(latest.id) };
  }

  // No trained model — use random init (untrained baseline)
  return { weights: initWeights(42), trained: false, modelId: null };
}

// ── Single Ticker Inference ──────────────────────────────────

/**
 * Get GNN-enhanced score for a single ticker.
 * Builds the full graph (needed for message passing), returns just this ticker's score.
 */
export async function getGNNScore(
  ticker: string,
  featureMap: Map<string, NodeFeatures>
): Promise<GNNScoreResult> {
  const { weights, trained, modelId } = await loadLatestWeights();
  const graph = await loadGraphFromDB(featureMap);

  const nodeIdx = graph.tickerIndex.get(ticker);
  if (nodeIdx === undefined) {
    // Ticker not in graph — return neutral score
    return {
      ticker,
      gnnScore: 0.5,
      ncsAdjustment: 0,
      modelTrained: trained,
      topInfluencers: [],
    };
  }

  const scores = forwardPass(graph, weights);
  const gnnScore = scores[nodeIdx];
  const ncsAdjustment = Math.round((gnnScore - 0.5) * GNN_WEIGHT_FACTOR * 100 * 10) / 10;

  // Find top influencers (neighbours with highest edge weight)
  const neighbours = graph.adjacencyList[nodeIdx];
  const topInfluencers = neighbours
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(n => ({
      ticker: graph.indexToTicker[n.neighbour],
      weight: Math.round(n.weight * 1000) / 1000,
    }));

  // Log inference
  try {
    await prisma.gNNInferenceLog.create({
      data: {
        ticker,
        gnnScore: Math.round(gnnScore * 1000) / 1000,
        ncsAdjustment,
        modelId: modelId ? parseInt(modelId) : null,
        graphNodes: graph.numNodes,
      },
    });
  } catch {
    // Non-critical logging — skip on error
  }

  return {
    ticker,
    gnnScore: Math.round(gnnScore * 1000) / 1000,
    ncsAdjustment,
    modelTrained: trained,
    topInfluencers,
  };
}

/**
 * Batch inference: compute GNN scores for multiple tickers at once.
 * More efficient than single-ticker calls (builds graph once).
 */
export async function getBatchGNNScores(
  featureMap: Map<string, NodeFeatures>
): Promise<BatchGNNResult> {
  const { weights, trained, modelId } = await loadLatestWeights();
  const graph = await loadGraphFromDB(featureMap);

  const allScores = forwardPass(graph, weights);
  const scores = new Map<string, GNNScoreResult>();

  for (let i = 0; i < graph.numNodes; i++) {
    const ticker = graph.indexToTicker[i];
    const gnnScore = allScores[i];
    const ncsAdjustment = Math.round((gnnScore - 0.5) * GNN_WEIGHT_FACTOR * 100 * 10) / 10;

    const neighbours = graph.adjacencyList[i];
    const topInfluencers = neighbours
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map(n => ({
        ticker: graph.indexToTicker[n.neighbour],
        weight: Math.round(n.weight * 1000) / 1000,
      }));

    scores.set(ticker, {
      ticker,
      gnnScore: Math.round(gnnScore * 1000) / 1000,
      ncsAdjustment,
      modelTrained: trained,
      topInfluencers,
    });
  }

  return {
    scores,
    modelVersion: modelId,
    nodesInGraph: graph.numNodes,
  };
}
