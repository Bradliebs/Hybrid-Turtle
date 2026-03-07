/**
 * DEPENDENCIES
 * Consumed by: maml-trainer.ts, /api/prediction/trade-recommendation/route.ts
 * Consumes: trade-state-encoder.ts (types), prisma.ts
 * Risk-sensitive: NO — stores and queries episode data only
 * Last modified: 2026-03-07
 * Notes: Stores trade episodes (entry → exit sequences) for RL training.
 *        Each episode = sequence of (observation, action, reward) tuples.
 *        Populated from real trades + synthetic episodes from adversarial sim.
 *        ⛔ Does NOT modify sacred files.
 */

import { prisma } from '@/lib/prisma';
import type { TradeAction } from './trade-state-encoder';

// ── Types ────────────────────────────────────────────────────

export interface EpisodeStep {
  observation: number[];   // normalised observation vector
  action: TradeAction;
  reward: number;
}

export interface TradeEpisodeData {
  ticker: string;
  regime: string;
  steps: EpisodeStep[];
  totalReward: number;
  finalRMultiple: number;
  daysHeld: number;
}

// ── Reward Function ──────────────────────────────────────────

/**
 * Compute step reward for the MAML training loop.
 * Reward function per spec:
 *   +R_multiple_at_exit (final outcome)
 *   +0.1 per day in profitable trade (reward patience)
 *   -0.5 for stop hit within 3 days
 *   -0.2 for unnecessary churn
 */
export function computeStepReward(
  rMultiple: number,
  daysInTrade: number,
  action: TradeAction,
  isFinalStep: boolean,
  stopHitEarly: boolean
): number {
  let reward = 0;

  if (isFinalStep) {
    reward += rMultiple;
  }

  // Patience bonus for holding profitable trades
  if (rMultiple > 0 && action === 'HOLD') {
    reward += 0.1;
  }

  // Penalty for early stop hit
  if (stopHitEarly && daysInTrade <= 3) {
    reward -= 0.5;
  }

  // Churn penalty for exiting early without clear reason
  if (action === 'FULL_EXIT' && rMultiple > 0.5 && daysInTrade < 5) {
    reward -= 0.2;
  }

  return reward;
}

// ── Episode Storage ──────────────────────────────────────────

/**
 * Save a trade episode to the database.
 */
export async function saveEpisode(episode: TradeEpisodeData): Promise<void> {
  await prisma.tradeEpisode.create({
    data: {
      ticker: episode.ticker,
      regime: episode.regime,
      stepsJson: JSON.stringify(episode.steps),
      totalReward: episode.totalReward,
      finalRMultiple: episode.finalRMultiple,
      daysHeld: episode.daysHeld,
      stepCount: episode.steps.length,
    },
  });
}

/**
 * Load episodes for training. Returns most recent episodes.
 */
export async function loadEpisodes(limit = 500): Promise<TradeEpisodeData[]> {
  const rows = await prisma.tradeEpisode.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map(r => ({
    ticker: r.ticker,
    regime: r.regime,
    steps: JSON.parse(r.stepsJson) as EpisodeStep[],
    totalReward: r.totalReward,
    finalRMultiple: r.finalRMultiple,
    daysHeld: r.daysHeld,
  }));
}

/**
 * Count available episodes.
 */
export async function countEpisodes(): Promise<number> {
  return prisma.tradeEpisode.count();
}

// ── Synthetic Episode Generation ─────────────────────────────

/**
 * Generate a synthetic episode from an adversarial price path.
 * Uses a simple rule-based policy to generate (obs, action, reward) tuples.
 * These bootstrap the training data before real trade history accumulates.
 */
export function generateSyntheticEpisode(
  ticker: string,
  regime: string,
  pricePath: number[],
  entryPrice: number,
  stopPrice: number,
  atr: number
): TradeEpisodeData {
  const steps: EpisodeStep[] = [];
  let currentR = 0;
  const initialRisk = entryPrice - stopPrice;

  for (let day = 0; day < pricePath.length; day++) {
    const price = pricePath[day];
    currentR = initialRisk > 0 ? (price - entryPrice) / initialRisk : 0;
    const stopHit = price <= stopPrice;
    const isFinal = day === pricePath.length - 1 || stopHit;

    // Simple rule-based action selection for synthetic data
    let action: TradeAction = 'HOLD';
    if (stopHit) action = 'FULL_EXIT';
    else if (currentR >= 3 && day > 5) action = 'TRAIL_STOP_ATR';
    else if (currentR >= 2) action = 'TIGHTEN_STOP';
    else if (currentR < -0.5 && day > 3) action = 'FULL_EXIT';

    const obs: number[] = [
      Math.max(-3, Math.min(5, currentR)) / 8 + 0.375, // normalised R
      day / 60,
      atr > 0 ? Math.abs(price - stopPrice) / atr / 5 : 0.5,
      0, // pyramid level
      regime === 'BULLISH' ? 0.8 : 0.4,
      0.5, // vix percentile default
      0.5, // volume trend default
      ((price - entryPrice) / entryPrice * 100 + 20) / 50,
      0.5, 0.5, 0.3, 0.3, 0.5, 0.3,
    ];

    const reward = computeStepReward(currentR, day, action, isFinal, stopHit && day <= 3);
    steps.push({ observation: obs, action, reward });

    if (stopHit) break;
  }

  const totalReward = steps.reduce((s, st) => s + st.reward, 0);

  return {
    ticker,
    regime,
    steps,
    totalReward,
    finalRMultiple: currentR,
    daysHeld: steps.length,
  };
}
