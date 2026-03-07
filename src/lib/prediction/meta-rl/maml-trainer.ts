/**
 * DEPENDENCIES
 * Consumed by: nightly.ts (weekly), /api/prediction/trade-recommendation/route.ts
 * Consumes: policy-network.ts, episode-memory.ts, prisma.ts
 * Risk-sensitive: NO — offline training, no position changes
 * Last modified: 2026-03-07
 * Notes: Model-Agnostic Meta-Learning (MAML) trainer for trade management policy.
 *        Inner loop: fine-tune on one episode (5 gradient steps).
 *        Outer loop: update meta-weights so fine-tuning generalises.
 *        Uses numerical gradients (~1100 params, subset updated per step).
 *        Minimum 50 episodes before training activates.
 *        ⛔ Does NOT modify sacred files. Recommendations are suggestions only.
 */

import { prisma } from '@/lib/prisma';
import {
  initPolicyWeights,
  policyForward,
  serialisePolicyWeights,
  deserialisePolicyWeights,
  getPolicyParam,
  setPolicyParam,
  type PolicyWeights,
} from './policy-network';
import { loadEpisodes, countEpisodes, type TradeEpisodeData } from './episode-memory';
import { ACTIONS } from './trade-state-encoder';

// ── Constants ────────────────────────────────────────────────

const MIN_EPISODES = 50;
const INNER_LR = 0.005;
const OUTER_LR = 0.001;
const INNER_STEPS = 5;
const META_EPOCHS = 10;
const PARAM_BATCH_SIZE = 30;  // update random subset per step
const RETRAIN_INTERVAL_DAYS = 7;

// ── Types ────────────────────────────────────────────────────

export interface MAMLTrainingResult {
  trained: boolean;
  episodes: number;
  metaLoss: number;
  reason?: string;
}

// ── Loss Computation ─────────────────────────────────────────

/**
 * Compute policy gradient loss for one episode step.
 * Cross-entropy between policy output and the taken action,
 * weighted by the step reward.
 */
function stepLoss(
  obsVec: number[],
  actionIdx: number,
  reward: number,
  weights: PolicyWeights
): number {
  const output = policyForward(obsVec, weights);
  const prob = Math.max(1e-7, output.actionProbs[actionIdx]);
  // Policy gradient: -reward × log(prob(action))
  return -reward * Math.log(prob);
}

/**
 * Compute average loss over an entire episode.
 */
function episodeLoss(episode: TradeEpisodeData, weights: PolicyWeights): number {
  if (episode.steps.length === 0) return 0;

  let totalLoss = 0;
  for (const step of episode.steps) {
    const actionIdx = ACTIONS.indexOf(step.action);
    if (actionIdx < 0) continue;
    totalLoss += stepLoss(step.observation, actionIdx, step.reward, weights);
  }

  return totalLoss / episode.steps.length;
}

// ── MAML Inner Loop ──────────────────────────────────────────

/**
 * Fine-tune a copy of weights on a single episode (inner loop).
 * Returns the fine-tuned weights (does not modify original).
 */
function innerAdapt(
  weights: PolicyWeights,
  episode: TradeEpisodeData,
  nSteps: number
): PolicyWeights {
  // Deep copy weights
  const adapted: PolicyWeights = JSON.parse(JSON.stringify(weights));

  // Random param subset for inner loop updates
  const paramPaths = generateParamPaths(adapted);
  const batch = paramPaths.sort(() => Math.random() - 0.5).slice(0, PARAM_BATCH_SIZE);

  for (let step = 0; step < nSteps; step++) {
    for (const [path, idx] of batch) {
      const eps = 1e-4;
      const current = getPolicyParam(adapted, path, idx);

      // Numerical gradient
      setPolicyParam(adapted, path, idx, current + eps);
      const lossPlus = episodeLoss(episode, adapted);
      setPolicyParam(adapted, path, idx, current - eps);
      const lossMinus = episodeLoss(episode, adapted);
      setPolicyParam(adapted, path, idx, current); // restore

      const grad = (lossPlus - lossMinus) / (2 * eps);
      setPolicyParam(adapted, path, idx, current - INNER_LR * grad);
    }
  }

  return adapted;
}

// ── Parameter Enumeration ────────────────────────────────────

function generateParamPaths(w: PolicyWeights): Array<[string, number[]]> {
  const paths: Array<[string, number[]]> = [];
  for (let i = 0; i < w.W1.length; i++)
    for (let j = 0; j < w.W1[i].length; j++) paths.push(['W1', [i, j]]);
  for (let i = 0; i < w.b1.length; i++) paths.push(['b1', [i]]);
  for (let i = 0; i < w.W2.length; i++)
    for (let j = 0; j < w.W2[i].length; j++) paths.push(['W2', [i, j]]);
  for (let i = 0; i < w.b2.length; i++) paths.push(['b2', [i]]);
  for (let i = 0; i < w.W3.length; i++)
    for (let j = 0; j < w.W3[i].length; j++) paths.push(['W3', [i, j]]);
  for (let i = 0; i < w.b3.length; i++) paths.push(['b3', [i]]);
  return paths;
}

// ── MAML Outer Loop ──────────────────────────────────────────

/**
 * Full MAML training: meta-learn a policy that adapts quickly to new trade episodes.
 */
async function trainMAML(): Promise<{ weights: PolicyWeights; metaLoss: number; episodes: number }> {
  const episodes = await loadEpisodes(200);
  if (episodes.length < MIN_EPISODES) {
    throw new Error(`Insufficient episodes: ${episodes.length} < ${MIN_EPISODES}`);
  }

  let metaWeights = initPolicyWeights(Date.now() % 100000);
  let bestMetaLoss = Infinity;

  const paramPaths = generateParamPaths(metaWeights);

  for (let epoch = 0; epoch < META_EPOCHS; epoch++) {
    // Sample a batch of episodes (tasks)
    const taskBatch = episodes.sort(() => Math.random() - 0.5).slice(0, 10);
    let epochLoss = 0;

    // Outer loop: for each task, adapt then evaluate
    const outerBatch = paramPaths.sort(() => Math.random() - 0.5).slice(0, PARAM_BATCH_SIZE);

    for (const [path, idx] of outerBatch) {
      let gradAccum = 0;

      for (const task of taskBatch) {
        // Inner adapt on this task
        const adapted = innerAdapt(metaWeights, task, INNER_STEPS);
        // Evaluate adapted policy on same task (meta-gradient)
        const eps = 1e-4;
        const current = getPolicyParam(metaWeights, path, idx);

        setPolicyParam(metaWeights, path, idx, current + eps);
        const adaptedPlus = innerAdapt(metaWeights, task, INNER_STEPS);
        const lossPlus = episodeLoss(task, adaptedPlus);

        setPolicyParam(metaWeights, path, idx, current - eps);
        const adaptedMinus = innerAdapt(metaWeights, task, INNER_STEPS);
        const lossMinus = episodeLoss(task, adaptedMinus);

        setPolicyParam(metaWeights, path, idx, current);

        gradAccum += (lossPlus - lossMinus) / (2 * eps);
        epochLoss += episodeLoss(task, adapted);
      }

      // Outer update
      const current = getPolicyParam(metaWeights, path, idx);
      setPolicyParam(metaWeights, path, idx, current - OUTER_LR * (gradAccum / taskBatch.length));
    }

    epochLoss /= taskBatch.length;
    if (epochLoss < bestMetaLoss) bestMetaLoss = epochLoss;
  }

  return { weights: metaWeights, metaLoss: bestMetaLoss, episodes: episodes.length };
}

// ── Public Entry Points ──────────────────────────────────────

export async function shouldRetrain(): Promise<boolean> {
  const latest = await prisma.policyVersion.findFirst({
    orderBy: { trainedAt: 'desc' },
  });
  if (!latest) return true;
  const ageDays = (Date.now() - latest.trainedAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= RETRAIN_INTERVAL_DAYS;
}

export async function runMAMLTraining(force = false): Promise<MAMLTrainingResult> {
  if (!force) {
    const eligible = await shouldRetrain();
    if (!eligible) {
      return { trained: false, episodes: 0, metaLoss: 0, reason: 'Retrain interval not reached' };
    }
  }

  const episodeCount = await countEpisodes();
  if (episodeCount < MIN_EPISODES) {
    return { trained: false, episodes: episodeCount, metaLoss: 0, reason: `Need ${MIN_EPISODES} episodes, have ${episodeCount}` };
  }

  try {
    const { weights, metaLoss, episodes } = await trainMAML();

    await prisma.policyVersion.create({
      data: {
        weightsJson: serialisePolicyWeights(weights),
        metaLoss,
        episodeCount: episodes,
      },
    });

    return { trained: true, episodes, metaLoss };
  } catch (error) {
    return { trained: false, episodes: 0, metaLoss: 0, reason: (error as Error).message };
  }
}

/**
 * Load the latest trained policy weights, or init if none exists.
 */
export async function loadLatestPolicy(): Promise<{ weights: PolicyWeights; trained: boolean }> {
  const latest = await prisma.policyVersion.findFirst({
    orderBy: { trainedAt: 'desc' },
  });

  if (latest) {
    return { weights: deserialisePolicyWeights(latest.weightsJson), trained: true };
  }

  return { weights: initPolicyWeights(42), trained: false };
}
