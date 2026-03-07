/**
 * DEPENDENCIES
 * Consumed by: nightly.ts (weekly), /api/prediction/gnn-score/route.ts (manual)
 * Consumes: graph-builder.ts, message-passing.ts, prisma.ts
 * Risk-sensitive: NO — offline training, no position changes
 * Last modified: 2026-03-07
 * Notes: Trains GNN on historical scan + outcome data.
 *        Target: did ticker achieve ≥ 1.5R within 15 days? (binary)
 *        Trains weekly (Sunday). Minimum 150 samples before activation.
 *        Uses numerical gradient descent (~200 params, trains in seconds).
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';
import {
  buildGraph,
  type NodeFeatures,
} from './graph-builder';
import {
  initWeights,
  forwardPass,
  binaryCrossEntropy,
  numericalGradient,
  iterParams,
  serialiseWeights,
  type GNNWeights,
} from './message-passing';
import { getAllEdges } from '../lead-lag-graph';

// ── Constants ────────────────────────────────────────────────

const MIN_TRAINING_SAMPLES = 150;
const LEARNING_RATE = 0.01;
const EPOCHS = 20;
const R_TARGET = 1.5;       // target R-multiple for binary label
const RETRAIN_INTERVAL_DAYS = 7;

// ── Types ────────────────────────────────────────────────────

export interface TrainingResult {
  trained: boolean;
  epochs: number;
  finalLoss: number;
  sampleSize: number;
  reason?: string;
}

// ── Training Data Loader ─────────────────────────────────────

interface TrainingSample {
  ticker: string;
  features: NodeFeatures;
  label: number;  // 1 if achieved ≥ 1.5R, 0 otherwise
}

async function loadTrainingData(): Promise<TrainingSample[]> {
  // Pull from CandidateOutcome where forward returns are enriched
  const outcomes = await prisma.candidateOutcome.findMany({
    where: {
      enrichedAt: { not: null },
      ncs: { not: null },
    },
    select: {
      ticker: true,
      ncs: true,
      adx: true,
      atrPct: true,
      volumeRatio: true,
      regime: true,
      mfeR: true,
      reached1R: true,
      reached2R: true,
      stopHit: true,
      fwdReturn10d: true,
    },
    orderBy: { scanDate: 'desc' },
    take: 2000,
  });

  return outcomes
    .filter(o => o.ncs !== null)
    .map(o => ({
      ticker: o.ticker,
      features: {
        ncs: o.ncs ?? 50,
        priceReturn1d: 0,          // not available in historical data
        priceReturn5d: (o.fwdReturn10d ?? 0) / 2, // rough proxy
        volumeRatio: o.volumeRatio,
        atrPercentile: Math.min(o.atrPct / 8, 1), // normalise ATR% to 0–1
        regimeScore: o.regime === 'BULLISH' ? 80 : o.regime === 'BEARISH' ? 20 : 50,
        failureModeMax: 0,         // not available historically
      },
      // Label: achieved ≥ 1.5R (use reached2R or mfeR as proxy)
      label: (o.reached2R === true || (o.mfeR !== null && o.mfeR >= R_TARGET)) ? 1 : 0,
    }));
}

// ── Training Loop ────────────────────────────────────────────

/**
 * Train the GNN using stochastic gradient descent with numerical gradients.
 * Returns trained weights and training metrics.
 */
async function trainModel(): Promise<{ weights: GNNWeights; loss: number; samples: number }> {
  const samples = await loadTrainingData();
  if (samples.length < MIN_TRAINING_SAMPLES) {
    throw new Error(`Insufficient training data: ${samples.length} < ${MIN_TRAINING_SAMPLES}`);
  }

  // Build feature map from samples
  const featureMap = new Map<string, NodeFeatures>();
  const labelMap = new Map<string, number>();
  for (const s of samples) {
    featureMap.set(s.ticker, s.features);
    labelMap.set(s.ticker, s.label);
  }

  // Load graph edges and build graph
  const edges = await getAllEdges();
  const graph = buildGraph(edges, featureMap);

  // Create target array (aligned with graph node indices, -1 = no label)
  const targets = graph.indexToTicker.map(t => labelMap.get(t) ?? -1);

  // Initialise weights
  const weights = initWeights(Date.now() % 100000);

  // Training loop — SGD with numerical gradients
  let bestLoss = Infinity;

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    // Forward pass
    const scores = forwardPass(graph, weights);

    // Compute loss (only on labelled nodes)
    let loss = 0;
    let count = 0;
    for (let i = 0; i < targets.length; i++) {
      if (targets[i] >= 0) {
        loss += binaryCrossEntropy(scores[i], targets[i]);
        count++;
      }
    }
    loss = count > 0 ? loss / count : 0;

    if (loss < bestLoss) bestLoss = loss;

    // Gradient descent on all parameters
    // For efficiency, only update a random subset of params per epoch
    const allParams = Array.from(iterParams(weights));
    const batchSize = Math.min(allParams.length, 50); // update 50 random params per epoch
    const shuffled = allParams.sort(() => Math.random() - 0.5).slice(0, batchSize);

    for (const [path, idx] of shuffled) {
      const grad = numericalGradient(graph, weights, targets, path, idx);
      const current = getParamValue(weights, path, idx);
      setParamValue(weights, path, idx, current - LEARNING_RATE * grad);
    }
  }

  return { weights, loss: bestLoss, samples: samples.length };
}

// ── Param Helpers (mirror message-passing.ts) ────────────────

function getParamValue(w: GNNWeights, path: string, idx: number[]): number {
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

function setParamValue(w: GNNWeights, path: string, idx: number[], val: number): void {
  switch (path) {
    case 'W1': w.W1[idx[0]][idx[1]] = val; break;
    case 'b1': w.b1[idx[0]] = val; break;
    case 'W2': w.W2[idx[0]][idx[1]] = val; break;
    case 'b2': w.b2[idx[0]] = val; break;
    case 'Wout': w.Wout[idx[0]] = val; break;
    case 'bout': w.bout = val; break;
  }
}

// ── Public Entry Points ──────────────────────────────────────

/**
 * Check if retraining is needed (weekly cadence).
 */
export async function shouldRetrain(): Promise<boolean> {
  const latest = await prisma.gNNModelWeights.findFirst({
    orderBy: { trainedAt: 'desc' },
  });
  if (!latest) return true;

  const ageMs = Date.now() - latest.trainedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays >= RETRAIN_INTERVAL_DAYS;
}

/**
 * Run the full training pipeline: load data, train, save weights.
 */
export async function runGNNTraining(force = false): Promise<TrainingResult> {
  if (!force) {
    const eligible = await shouldRetrain();
    if (!eligible) {
      return { trained: false, epochs: 0, finalLoss: 0, sampleSize: 0, reason: 'Retrain interval not reached' };
    }
  }

  try {
    const { weights, loss, samples } = await trainModel();

    // Save weights to DB
    await prisma.gNNModelWeights.create({
      data: {
        weightsJson: serialiseWeights(weights),
        trainingLoss: loss,
        sampleSize: samples,
        epochs: EPOCHS,
      },
    });

    console.log(`[GNN] Training complete: loss=${loss.toFixed(4)}, samples=${samples}, epochs=${EPOCHS}`);

    return { trained: true, epochs: EPOCHS, finalLoss: loss, sampleSize: samples };
  } catch (error) {
    const msg = (error as Error).message;
    console.warn(`[GNN] Training skipped: ${msg}`);
    return { trained: false, epochs: 0, finalLoss: 0, sampleSize: 0, reason: msg };
  }
}
