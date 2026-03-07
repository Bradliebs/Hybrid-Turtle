/**
 * DEPENDENCIES
 * Consumed by: gnn-trainer.ts, gnn-inference.ts
 * Consumes: graph-builder.ts (types only)
 * Risk-sensitive: NO — pure math, no side effects
 * Last modified: 2026-03-07
 * Notes: Pure TypeScript 2-layer GraphSAGE implementation.
 *        No external ML dependencies — uses basic matrix ops.
 *        Layer 1: 7 → 16 (node features → hidden)
 *        Layer 2: 16 → 8 (hidden → embedding)
 *        Output:  8 → 1 (embedding → scalar score)
 *        Total params: ~200. Trains on CPU in seconds.
 *        ⛔ Does NOT modify sacred files.
 */

import type { GraphData } from './graph-builder';
import { NODE_FEATURE_DIM } from './graph-builder';

// ── Constants ────────────────────────────────────────────────

export const HIDDEN_DIM_1 = 16;
export const HIDDEN_DIM_2 = 8;
export const OUTPUT_DIM = 1;

// ── Model Weights ────────────────────────────────────────────

export interface GNNWeights {
  /** Layer 1: [HIDDEN_DIM_1 × (NODE_FEATURE_DIM + NODE_FEATURE_DIM)] — self + neighbour concat */
  W1: number[][];
  b1: number[];
  /** Layer 2: [HIDDEN_DIM_2 × (HIDDEN_DIM_1 + HIDDEN_DIM_1)] */
  W2: number[][];
  b2: number[];
  /** Output: [1 × HIDDEN_DIM_2] */
  Wout: number[];
  bout: number;
}

// ── Random Weight Initialisation (Xavier) ────────────────────

function xavierInit(rows: number, cols: number, seed: number): number[][] {
  const scale = Math.sqrt(2 / (rows + cols));
  let s = seed;
  const nextRand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return ((s / 0x7fffffff) - 0.5) * 2 * scale;
  };

  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => nextRand())
  );
}

function zerosVec(n: number): number[] {
  return new Array(n).fill(0);
}

export function initWeights(seed = 42): GNNWeights {
  // Layer 1 input = self features concat neighbour aggregate = 2 × featureDim
  const inputDim1 = NODE_FEATURE_DIM * 2;
  // Layer 2 input = self hidden concat neighbour aggregate = 2 × hiddenDim1
  const inputDim2 = HIDDEN_DIM_1 * 2;

  return {
    W1: xavierInit(HIDDEN_DIM_1, inputDim1, seed),
    b1: zerosVec(HIDDEN_DIM_1),
    W2: xavierInit(HIDDEN_DIM_2, inputDim2, seed + 1000),
    b2: zerosVec(HIDDEN_DIM_2),
    Wout: zerosVec(HIDDEN_DIM_2),
    bout: 0,
  };
}

// ── Activation Functions ─────────────────────────────────────

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function sigmoid(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

// ── Matrix / Vector Operations ───────────────────────────────

/** Matrix × vector: [rows × cols] × [cols] → [rows] */
function matVecMul(mat: number[][], vec: number[]): number[] {
  return mat.map(row => {
    let sum = 0;
    for (let j = 0; j < row.length; j++) {
      sum += row[j] * (vec[j] ?? 0);
    }
    return sum;
  });
}

/** Element-wise vector addition */
function vecAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + (b[i] ?? 0));
}

/** Element-wise apply function */
function vecApply(vec: number[], fn: (x: number) => number): number[] {
  return vec.map(fn);
}

/** Concatenate two vectors */
function vecConcat(a: number[], b: number[]): number[] {
  return [...a, ...b];
}

/** Element-wise mean of multiple vectors */
function vecMean(vecs: number[][]): number[] {
  if (vecs.length === 0) return [];
  const dim = vecs[0].length;
  const result = new Array(dim).fill(0);
  for (const vec of vecs) {
    for (let i = 0; i < dim; i++) {
      result[i] += vec[i] ?? 0;
    }
  }
  for (let i = 0; i < dim; i++) {
    result[i] /= vecs.length;
  }
  return result;
}

/** Dot product */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

// ── GraphSAGE Forward Pass ───────────────────────────────────

/**
 * Run full 2-layer GraphSAGE forward pass on the graph.
 * Returns a scalar score per node (0–1 via sigmoid).
 *
 * @param graph - Graph with node features and adjacency
 * @param weights - Learned GNN weights
 * @returns Array of scores, one per node (aligned with graph.indexToTicker)
 */
export function forwardPass(graph: GraphData, weights: GNNWeights): number[] {
  const { nodeFeatures, adjacencyList, numNodes } = graph;

  // ── Layer 1: aggregate 1-hop neighbours, concat with self, transform ──
  const h1: number[][] = new Array(numNodes);

  for (let v = 0; v < numNodes; v++) {
    const selfFeat = nodeFeatures[v];
    const neighbours = adjacencyList[v];

    // Weighted mean aggregation of neighbour features
    let neighbourAgg: number[];
    if (neighbours.length === 0) {
      neighbourAgg = selfFeat; // self-loop fallback
    } else {
      const weightedFeats = neighbours.map(n => {
        return nodeFeatures[n.neighbour].map(f => f * n.weight);
      });
      const totalWeight = neighbours.reduce((s, n) => s + n.weight, 0);
      neighbourAgg = vecMean(weightedFeats).map(f =>
        totalWeight > 0 ? (f * neighbours.length) / totalWeight : f
      );
    }

    // Concat self + neighbour aggregate → linear transform → ReLU
    const concat = vecConcat(selfFeat, neighbourAgg);
    const linear = vecAdd(matVecMul(weights.W1, concat), weights.b1);
    h1[v] = vecApply(linear, relu);
  }

  // ── Layer 2: same pattern on updated embeddings ──
  const h2: number[][] = new Array(numNodes);

  for (let v = 0; v < numNodes; v++) {
    const selfEmb = h1[v];
    const neighbours = adjacencyList[v];

    let neighbourAgg: number[];
    if (neighbours.length === 0) {
      neighbourAgg = selfEmb;
    } else {
      const weightedEmbs = neighbours.map(n => {
        return h1[n.neighbour].map(f => f * n.weight);
      });
      const totalWeight = neighbours.reduce((s, n) => s + n.weight, 0);
      neighbourAgg = vecMean(weightedEmbs).map(f =>
        totalWeight > 0 ? (f * neighbours.length) / totalWeight : f
      );
    }

    const concat = vecConcat(selfEmb, neighbourAgg);
    const linear = vecAdd(matVecMul(weights.W2, concat), weights.b2);
    h2[v] = vecApply(linear, relu);
  }

  // ── Output layer: embedding → scalar score ──
  const scores: number[] = new Array(numNodes);
  for (let v = 0; v < numNodes; v++) {
    scores[v] = sigmoid(dot(weights.Wout, h2[v]) + weights.bout);
  }

  return scores;
}

// ── Gradient Computation (for training) ──────────────────────

/**
 * Compute binary cross-entropy loss.
 */
export function binaryCrossEntropy(predicted: number, target: number): number {
  const p = Math.max(1e-7, Math.min(1 - 1e-7, predicted));
  return -(target * Math.log(p) + (1 - target) * Math.log(1 - p));
}

/**
 * Compute numerical gradient of loss w.r.t. a weight parameter.
 * Used for training — simple finite differences (no autograd needed for ~200 params).
 */
export function numericalGradient(
  graph: GraphData,
  weights: GNNWeights,
  targets: number[],
  paramPath: string,
  paramIdx: number[],
  epsilon = 1e-4
): number {
  // Forward pass with weight + epsilon
  setParam(weights, paramPath, paramIdx, getParam(weights, paramPath, paramIdx) + epsilon);
  const scoresPlus = forwardPass(graph, weights);
  let lossPlus = 0;
  for (let i = 0; i < targets.length; i++) {
    if (targets[i] >= 0) lossPlus += binaryCrossEntropy(scoresPlus[i], targets[i]);
  }

  // Forward pass with weight - epsilon
  setParam(weights, paramPath, paramIdx, getParam(weights, paramPath, paramIdx) - 2 * epsilon);
  const scoresMinus = forwardPass(graph, weights);
  let lossMinus = 0;
  for (let i = 0; i < targets.length; i++) {
    if (targets[i] >= 0) lossMinus += binaryCrossEntropy(scoresMinus[i], targets[i]);
  }

  // Restore original
  setParam(weights, paramPath, paramIdx, getParam(weights, paramPath, paramIdx) + epsilon);

  return (lossPlus - lossMinus) / (2 * epsilon);
}

// ── Parameter Accessors ──────────────────────────────────────

function getParam(w: GNNWeights, path: string, idx: number[]): number {
  switch (path) {
    case 'W1': return w.W1[idx[0]][idx[1]];
    case 'b1': return w.b1[idx[0]];
    case 'W2': return w.W2[idx[0]][idx[1]];
    case 'b2': return w.b2[idx[0]];
    case 'Wout': return w.Wout[idx[0]];
    case 'bout': return w.bout;
    default: return 0;
  }
}

function setParam(w: GNNWeights, path: string, idx: number[], val: number): void {
  switch (path) {
    case 'W1': w.W1[idx[0]][idx[1]] = val; break;
    case 'b1': w.b1[idx[0]] = val; break;
    case 'W2': w.W2[idx[0]][idx[1]] = val; break;
    case 'b2': w.b2[idx[0]] = val; break;
    case 'Wout': w.Wout[idx[0]] = val; break;
    case 'bout': w.bout = val; break;
  }
}

/**
 * Iterate all parameters for gradient computation.
 * Yields [paramPath, paramIndices] tuples.
 */
export function* iterParams(w: GNNWeights): Generator<[string, number[]]> {
  for (let i = 0; i < w.W1.length; i++)
    for (let j = 0; j < w.W1[i].length; j++)
      yield ['W1', [i, j]];
  for (let i = 0; i < w.b1.length; i++)
    yield ['b1', [i]];
  for (let i = 0; i < w.W2.length; i++)
    for (let j = 0; j < w.W2[i].length; j++)
      yield ['W2', [i, j]];
  for (let i = 0; i < w.b2.length; i++)
    yield ['b2', [i]];
  for (let i = 0; i < w.Wout.length; i++)
    yield ['Wout', [i]];
  yield ['bout', [0]];
}

/**
 * Serialise weights to a flat JSON-safe object.
 */
export function serialiseWeights(w: GNNWeights): string {
  return JSON.stringify({ W1: w.W1, b1: w.b1, W2: w.W2, b2: w.b2, Wout: w.Wout, bout: w.bout });
}

/**
 * Deserialise weights from JSON string.
 */
export function deserialiseWeights(json: string): GNNWeights {
  const parsed = JSON.parse(json);
  return {
    W1: parsed.W1,
    b1: parsed.b1,
    W2: parsed.W2,
    b2: parsed.b2,
    Wout: parsed.Wout,
    bout: parsed.bout,
  };
}
