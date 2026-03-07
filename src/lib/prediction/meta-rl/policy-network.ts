/**
 * DEPENDENCIES
 * Consumed by: maml-trainer.ts, /api/prediction/trade-recommendation/route.ts
 * Consumes: trade-state-encoder.ts (OBSERVATION_DIM, ACTION_DIM)
 * Risk-sensitive: NO — pure math, no side effects
 * Last modified: 2026-03-07
 * Notes: Small MLP policy network (pure TS, no deps).
 *        Architecture: 14 → 32 → 16 → 7 (softmax output over actions).
 *        Total params: ~1100. Trains on CPU in seconds.
 *        ⛔ Does NOT modify sacred files.
 */

import { OBSERVATION_DIM, ACTION_DIM } from './trade-state-encoder';

// ── Types ────────────────────────────────────────────────────

export interface PolicyWeights {
  W1: number[][];  // [32 × 14]
  b1: number[];    // [32]
  W2: number[][];  // [16 × 32]
  b2: number[];    // [16]
  W3: number[][];  // [7 × 16]
  b3: number[];    // [7]
}

export interface PolicyOutput {
  /** Action probabilities (softmax output, sum = 1) */
  actionProbs: number[];
  /** Index of recommended action (argmax) */
  bestAction: number;
  /** Confidence of best action (its probability) */
  confidence: number;
}

// ── Constants ────────────────────────────────────────────────

const HIDDEN_1 = 32;
const HIDDEN_2 = 16;

// ── Initialisation ───────────────────────────────────────────

function xavierInit(rows: number, cols: number, seed: number): number[][] {
  const scale = Math.sqrt(2 / (rows + cols));
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return ((s / 0x7fffffff) - 0.5) * 2 * scale; };
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => rand()));
}

export function initPolicyWeights(seed = 42): PolicyWeights {
  return {
    W1: xavierInit(HIDDEN_1, OBSERVATION_DIM, seed),
    b1: new Array(HIDDEN_1).fill(0),
    W2: xavierInit(HIDDEN_2, HIDDEN_1, seed + 1000),
    b2: new Array(HIDDEN_2).fill(0),
    W3: xavierInit(ACTION_DIM, HIDDEN_2, seed + 2000),
    b3: new Array(ACTION_DIM).fill(0),
  };
}

// ── Activation Functions ─────────────────────────────────────

function relu(x: number): number { return x > 0 ? x : 0; }

function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sum = exps.reduce((s, e) => s + e, 0);
  return exps.map(e => e / sum);
}

// ── Forward Pass ─────────────────────────────────────────────

function matVecMul(mat: number[][], vec: number[]): number[] {
  return mat.map(row => {
    let sum = 0;
    for (let j = 0; j < row.length; j++) sum += row[j] * (vec[j] ?? 0);
    return sum;
  });
}

function vecAddBias(vec: number[], bias: number[]): number[] {
  return vec.map((v, i) => v + (bias[i] ?? 0));
}

/**
 * Forward pass: observation → action probabilities.
 */
export function policyForward(obs: number[], weights: PolicyWeights): PolicyOutput {
  // Layer 1: 14 → 32 (ReLU)
  const h1 = vecAddBias(matVecMul(weights.W1, obs), weights.b1).map(relu);
  // Layer 2: 32 → 16 (ReLU)
  const h2 = vecAddBias(matVecMul(weights.W2, h1), weights.b2).map(relu);
  // Layer 3: 16 → 7 (softmax)
  const logits = vecAddBias(matVecMul(weights.W3, h2), weights.b3);
  const probs = softmax(logits);

  let bestAction = 0;
  let bestProb = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > bestProb) { bestProb = probs[i]; bestAction = i; }
  }

  return {
    actionProbs: probs.map(p => Math.round(p * 1000) / 1000),
    bestAction,
    confidence: Math.round(bestProb * 1000) / 1000,
  };
}

// ── Serialisation ────────────────────────────────────────────

export function serialisePolicyWeights(w: PolicyWeights): string {
  return JSON.stringify({ W1: w.W1, b1: w.b1, W2: w.W2, b2: w.b2, W3: w.W3, b3: w.b3 });
}

export function deserialisePolicyWeights(json: string): PolicyWeights {
  const p = JSON.parse(json);
  return { W1: p.W1, b1: p.b1, W2: p.W2, b2: p.b2, W3: p.W3, b3: p.b3 };
}

// ── Parameter Access (for gradient computation) ──────────────

export function getPolicyParam(w: PolicyWeights, path: string, idx: number[]): number {
  switch (path) {
    case 'W1': return w.W1[idx[0]][idx[1]];
    case 'b1': return w.b1[idx[0]];
    case 'W2': return w.W2[idx[0]][idx[1]];
    case 'b2': return w.b2[idx[0]];
    case 'W3': return w.W3[idx[0]][idx[1]];
    case 'b3': return w.b3[idx[0]];
    default: return 0;
  }
}

export function setPolicyParam(w: PolicyWeights, path: string, idx: number[], val: number): void {
  switch (path) {
    case 'W1': w.W1[idx[0]][idx[1]] = val; break;
    case 'b1': w.b1[idx[0]] = val; break;
    case 'W2': w.W2[idx[0]][idx[1]] = val; break;
    case 'b2': w.b2[idx[0]] = val; break;
    case 'W3': w.W3[idx[0]][idx[1]] = val; break;
    case 'b3': w.b3[idx[0]] = val; break;
  }
}
