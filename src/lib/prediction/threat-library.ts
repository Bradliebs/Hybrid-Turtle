/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/danger-level/route.ts, nightly.ts (future)
 * Consumes: environment-encoder.ts, danger-matcher.ts, prisma.ts
 * Risk-sensitive: NO — stores and queries threat fingerprints only
 * Last modified: 2026-03-07
 * Notes: Maintains a rolling threat library of dangerous market environments.
 *        Pre-populated with known historical crises (March 2020, Aug 2015, Oct 2022).
 *        As real losses accumulate, they are automatically added.
 *        ⛔ Does NOT modify risk-gates.ts — tightening is applied at the API layer.
 */

import { prisma } from '@/lib/prisma';
import {
  encodeEnvironment,
  buildCurrentEnvironment,
  type MarketEnvironment,
  type EnvironmentVector,
} from './environment-encoder';
import { computeDangerScore, type DangerResult } from './danger-matcher';

// ── Types ────────────────────────────────────────────────────

export interface ThreatEntry {
  id: number;
  label: string;
  vector: EnvironmentVector;
  severity: number;
  source: string;
  createdAt: Date;
}

// ── Bootstrap Threat Entries ─────────────────────────────────
// Pre-populated from known historical crisis environments.
// Vectors are manually encoded from public data.

const BOOTSTRAP_THREATS: Array<{
  label: string;
  environment: MarketEnvironment;
  severity: number;
  source: string;
}> = [
  {
    label: 'March 2020 — COVID crash',
    environment: {
      vix: 65,
      vixChange5d: 80,
      spyMomentum20d: -15,
      spyVolatilityRealised10d: 4.5,
      drsScore: 15,
      averagePortfolioCorrelation: 0.85,
      daysInCurrentRegime: 1,
    },
    severity: 95,
    source: 'bootstrap_historical',
  },
  {
    label: 'August 2015 — Flash crash',
    environment: {
      vix: 40,
      vixChange5d: 60,
      spyMomentum20d: -8,
      spyVolatilityRealised10d: 3.0,
      drsScore: 25,
      averagePortfolioCorrelation: 0.70,
      daysInCurrentRegime: 2,
    },
    severity: 75,
    source: 'bootstrap_historical',
  },
  {
    label: 'October 2022 — Rate shock drawdown',
    environment: {
      vix: 33,
      vixChange5d: 20,
      spyMomentum20d: -12,
      spyVolatilityRealised10d: 2.5,
      drsScore: 20,
      averagePortfolioCorrelation: 0.65,
      daysInCurrentRegime: 8,
    },
    severity: 70,
    source: 'bootstrap_historical',
  },
  {
    label: 'December 2018 — Fed tightening selloff',
    environment: {
      vix: 36,
      vixChange5d: 40,
      spyMomentum20d: -10,
      spyVolatilityRealised10d: 2.8,
      drsScore: 18,
      averagePortfolioCorrelation: 0.60,
      daysInCurrentRegime: 3,
    },
    severity: 65,
    source: 'bootstrap_historical',
  },
  {
    label: 'VIX term structure inversion (generic)',
    environment: {
      vix: 28,
      vixChange5d: 30,
      spyMomentum20d: -5,
      spyVolatilityRealised10d: 2.0,
      drsScore: 30,
      averagePortfolioCorrelation: 0.55,
      daysInCurrentRegime: 4,
    },
    severity: 55,
    source: 'bootstrap_pattern',
  },
];

// ── Persistence ──────────────────────────────────────────────

/**
 * Seed the threat library with bootstrap entries if empty.
 */
export async function seedThreatLibrary(): Promise<number> {
  const existingCount = await prisma.threatLibraryEntry.count();
  if (existingCount > 0) return 0;

  let seeded = 0;
  for (const threat of BOOTSTRAP_THREATS) {
    const vector = encodeEnvironment(threat.environment);
    await prisma.threatLibraryEntry.create({
      data: {
        label: threat.label,
        vector: JSON.stringify(vector),
        severity: threat.severity,
        source: threat.source,
      },
    });
    seeded++;
  }

  return seeded;
}

/**
 * Add a new threat entry from a real trading loss.
 * Called when a trade results in stop hit within 3 days or -2R outcome.
 */
export async function addThreatFromLoss(params: {
  label: string;
  environment: MarketEnvironment;
  severity: number;
}): Promise<void> {
  const vector = encodeEnvironment(params.environment);

  await prisma.threatLibraryEntry.create({
    data: {
      label: params.label,
      vector: JSON.stringify(vector),
      severity: params.severity,
      source: 'live_loss',
    },
  });
}

/**
 * Load all threat entries from the database.
 */
export async function loadThreats(): Promise<ThreatEntry[]> {
  const entries = await prisma.threatLibraryEntry.findMany({
    orderBy: { severity: 'desc' },
  });

  return entries.map(e => ({
    id: e.id,
    label: e.label,
    vector: JSON.parse(e.vector) as EnvironmentVector,
    severity: e.severity,
    source: e.source,
    createdAt: e.createdAt,
  }));
}

// ── Main Danger Assessment ───────────────────────────────────

/**
 * Assess current market danger by comparing live environment to threat library.
 * Seeds the library with bootstrap entries if empty.
 */
export async function assessDangerLevel(): Promise<DangerResult & { environment: MarketEnvironment }> {
  // Ensure threat library is populated
  await seedThreatLibrary();

  // Build current environment
  const environment = await buildCurrentEnvironment();
  const currentVec = encodeEnvironment(environment);

  // Load all threats
  const threats = await loadThreats();

  // Compute danger score
  const result = computeDangerScore(
    currentVec,
    threats.map(t => ({
      id: t.id,
      label: t.label,
      vector: t.vector,
      severity: t.severity,
    }))
  );

  return { ...result, environment };
}
