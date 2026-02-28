/**
 * DEPENDENCIES
 * Consumed by: /api/scan/route.ts, /api/scan/snapshots/sync/route.ts, /api/modules/early-bird/route.ts
 * Consumes: prisma.ts
 * Risk-sensitive: NO
 * Last modified: 2026-02-28
 * Notes: Lightweight guard — checks if the nightly pipeline is actively running
 *        by reading the latest heartbeat status. Stale RUNNING (>60 min) is
 *        treated as a crashed pipeline and the guard allows the action.
 */

import prisma from '@/lib/prisma';

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Returns true if the nightly pipeline is currently running
 * (latest heartbeat is RUNNING and less than 60 minutes old).
 */
export async function isNightlyRunning(): Promise<boolean> {
  const latest = await prisma.heartbeat.findFirst({
    orderBy: { timestamp: 'desc' },
    select: { status: true, timestamp: true },
  });

  if (!latest || latest.status !== 'RUNNING') return false;

  // Stale guard: if RUNNING for > 60 minutes, treat as crashed
  const ageMs = Date.now() - latest.timestamp.getTime();
  return ageMs < STALE_THRESHOLD_MS;
}
