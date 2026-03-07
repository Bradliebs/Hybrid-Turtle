/**
 * DEPENDENCIES
 * Consumed by: threat-library.ts, /api/prediction/danger-level/route.ts
 * Consumes: environment-encoder.ts (types only)
 * Risk-sensitive: NO — pure math, no DB or position changes
 * Last modified: 2026-03-07
 * Notes: Cosine similarity between environment vectors.
 *        Danger score = max similarity across top-K closest threats,
 *        weighted by threat severity.
 */

import type { EnvironmentVector } from './environment-encoder';

// ── Cosine Similarity ────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns value in [-1, 1], where 1 = identical direction.
 */
export function cosineSimilarity(a: EnvironmentVector, b: EnvironmentVector): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dotProduct / denom;
}

// ── Danger Score Computation ─────────────────────────────────

export interface ThreatMatch {
  threatId: number;
  label: string;
  similarity: number;
  severity: number;
  /** Weighted score = similarity × severity_weight */
  weightedScore: number;
}

export interface DangerResult {
  dangerScore: number;        // 0–100: overall danger level
  immuneAlert: boolean;       // true if dangerScore > 75
  riskTightening: number;     // 0–0.2: fraction to reduce max open risk by
  topMatches: ThreatMatch[];  // top-5 closest threats
}

/** Threshold above which immune alert fires */
export const IMMUNE_ALERT_THRESHOLD = 0.75;

/** Top-K threats to consider for danger scoring */
const TOP_K = 5;

/**
 * Compute danger score from current environment vs threat library entries.
 *
 * @param currentVec - Normalised environment vector for current conditions
 * @param threats - Array of { id, label, vector, severity } from threat library
 * @returns DangerResult with score, alert status, and matches
 */
export function computeDangerScore(
  currentVec: EnvironmentVector,
  threats: Array<{ id: number; label: string; vector: EnvironmentVector; severity: number }>
): DangerResult {
  if (threats.length === 0) {
    return { dangerScore: 0, immuneAlert: false, riskTightening: 0, topMatches: [] };
  }

  // Compute similarity with each threat
  const matches: ThreatMatch[] = threats.map(t => {
    const similarity = cosineSimilarity(currentVec, t.vector);
    // Severity weights the match: a high-severity threat matching at 0.6 is worse
    // than a low-severity threat matching at 0.8
    const severityWeight = 0.5 + (t.severity / 100) * 0.5; // range 0.5–1.0
    const weightedScore = Math.max(0, similarity) * severityWeight;

    return {
      threatId: t.id,
      label: t.label,
      similarity: Math.round(similarity * 1000) / 1000,
      severity: t.severity,
      weightedScore: Math.round(weightedScore * 1000) / 1000,
    };
  });

  // Sort by weighted score descending, take top-K
  matches.sort((a, b) => b.weightedScore - a.weightedScore);
  const topMatches = matches.slice(0, TOP_K);

  // Danger score = max weighted score across top threats, scaled to 0–100
  const dangerScore = Math.round(Math.min(topMatches[0].weightedScore, 1) * 100);

  // Immune alert at threshold
  const immuneAlert = dangerScore > IMMUNE_ALERT_THRESHOLD * 100;

  // Risk tightening: linear from 0% at score=50 to 20% at score=100
  const riskTightening = dangerScore > 50
    ? Math.min(((dangerScore - 50) / 50) * 0.2, 0.2)
    : 0;

  return {
    dangerScore,
    immuneAlert,
    riskTightening: Math.round(riskTightening * 1000) / 1000,
    topMatches,
  };
}
