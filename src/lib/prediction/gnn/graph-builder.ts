/**
 * DEPENDENCIES
 * Consumed by: message-passing.ts, gnn-trainer.ts, gnn-inference.ts
 * Consumes: lead-lag-graph.ts (getAllEdges), prisma.ts
 * Risk-sensitive: NO — data conversion only
 * Last modified: 2026-03-07
 * Notes: Converts lead-lag edges + current ticker features into adjacency
 *        matrix and node feature matrix for GraphSAGE consumption.
 *        ⛔ Does NOT modify sacred files.
 */

import { getAllEdges } from '../lead-lag-graph';
import type { LeadLagEdge } from '../lead-lag-analyser';

// ── Types ────────────────────────────────────────────────────

/** Per-node features at scan time (7 dimensions) */
export interface NodeFeatures {
  ncs: number;              // 0–1 normalised NCS
  priceReturn1d: number;    // 1-day return (raw, not normalised)
  priceReturn5d: number;    // 5-day return
  volumeRatio: number;      // vs 20d avg
  atrPercentile: number;    // ATR percentile 0–1
  regimeScore: number;      // DRS output 0–1
  failureModeMax: number;   // highest FM score 0–1
}

export const NODE_FEATURE_DIM = 7;

/** Graph representation for GNN consumption */
export interface GraphData {
  /** Map: ticker → index in node arrays */
  tickerIndex: Map<string, number>;
  /** Reverse map: index → ticker */
  indexToTicker: string[];
  /** Node feature matrix: [numNodes × featureDim] */
  nodeFeatures: number[][];
  /** Adjacency list: for each node, list of (neighbour index, edge weight) */
  adjacencyList: Array<Array<{ neighbour: number; weight: number }>>;
  /** Number of nodes */
  numNodes: number;
}

// ── Feature Normalisation ────────────────────────────────────

function normalise01(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Normalise raw features to 0–1 range for GNN input.
 */
export function normaliseFeatures(raw: NodeFeatures): number[] {
  return [
    normalise01(raw.ncs, 0, 100),
    normalise01(raw.priceReturn1d, -10, 10),   // clamp ±10% returns
    normalise01(raw.priceReturn5d, -20, 20),
    normalise01(raw.volumeRatio, 0, 5),
    raw.atrPercentile,                          // already 0–1
    normalise01(raw.regimeScore, 0, 100),
    normalise01(raw.failureModeMax, 0, 100),
  ];
}

// ── Graph Builder ────────────────────────────────────────────

/**
 * Build graph from lead-lag edges and node feature map.
 * Nodes = all tickers appearing in edges + any extra tickers with features.
 * Edge weights = |correlation| from lead-lag analysis.
 *
 * @param edges - Lead-lag edges from DB
 * @param featureMap - Map of ticker → NodeFeatures (only tickers with features become nodes)
 */
export function buildGraph(
  edges: LeadLagEdge[],
  featureMap: Map<string, NodeFeatures>
): GraphData {
  // Collect unique tickers that have features
  const tickerSet = new Set<string>();
  for (const [ticker] of Array.from(featureMap.entries())) {
    tickerSet.add(ticker);
  }
  // Also add edge endpoints that have features
  for (const edge of edges) {
    if (featureMap.has(edge.leader)) tickerSet.add(edge.leader);
    if (featureMap.has(edge.follower)) tickerSet.add(edge.follower);
  }

  const indexToTicker = Array.from(tickerSet).sort();
  const tickerIndex = new Map<string, number>();
  indexToTicker.forEach((t, i) => tickerIndex.set(t, i));

  const numNodes = indexToTicker.length;

  // Node features — zero-fill for nodes without explicit features
  const defaultFeatures = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const nodeFeatures: number[][] = indexToTicker.map(ticker => {
    const raw = featureMap.get(ticker);
    return raw ? normaliseFeatures(raw) : [...defaultFeatures];
  });

  // Adjacency list (bidirectional — GNN aggregates in both directions)
  const adjacencyList: Array<Array<{ neighbour: number; weight: number }>> =
    Array.from({ length: numNodes }, () => []);

  for (const edge of edges) {
    const leaderIdx = tickerIndex.get(edge.leader);
    const followerIdx = tickerIndex.get(edge.follower);
    if (leaderIdx === undefined || followerIdx === undefined) continue;

    const weight = Math.abs(edge.correlation);

    // Leader → follower (directed edge)
    adjacencyList[leaderIdx].push({ neighbour: followerIdx, weight });
    // Follower → leader (reverse for undirected message passing)
    adjacencyList[followerIdx].push({ neighbour: leaderIdx, weight });
  }

  return {
    tickerIndex,
    indexToTicker,
    nodeFeatures,
    adjacencyList,
    numNodes,
  };
}

/**
 * Load graph from DB edges and a provided feature map.
 */
export async function loadGraphFromDB(
  featureMap: Map<string, NodeFeatures>
): Promise<GraphData> {
  const edges = await getAllEdges();
  return buildGraph(edges, featureMap);
}
