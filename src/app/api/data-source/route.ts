export const dynamic = 'force-dynamic';

/**
 * DEPENDENCIES
 * Consumed by: DataSourceTile.tsx (dashboard)
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only reporting
 * Last modified: 2026-03-01
 * Notes: Returns data source health from the latest heartbeat.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

interface DataSourceResponse {
  health: 'LIVE' | 'PARTIAL' | 'DEGRADED' | 'UNKNOWN';
  staleTickers: string[];
  maxStalenessHours: number;
  summary: string;
  lastYahooSuccess: string | null;
}

export async function GET() {
  try {
    // Find the most recent heartbeat with details
    const heartbeat = await prisma.heartbeat.findFirst({
      where: { status: { in: ['SUCCESS', 'FAILED'] } },
      orderBy: { timestamp: 'desc' },
    });

    if (!heartbeat?.details) {
      return NextResponse.json<DataSourceResponse>({
        health: 'UNKNOWN',
        staleTickers: [],
        maxStalenessHours: 0,
        summary: 'No heartbeat data available',
        lastYahooSuccess: null,
      });
    }

    let details: Record<string, unknown>;
    try {
      details = JSON.parse(heartbeat.details) as Record<string, unknown>;
    } catch {
      return NextResponse.json<DataSourceResponse>({
        health: 'UNKNOWN',
        staleTickers: [],
        maxStalenessHours: 0,
        summary: 'Heartbeat details unparseable',
        lastYahooSuccess: null,
      });
    }

    const ds = details.dataSource as {
      health?: string;
      staleTickers?: string[];
      maxStalenessHours?: number;
      summary?: string;
    } | undefined;

    if (!ds || !ds.health) {
      // Pre-upgrade heartbeat — assume live data
      return NextResponse.json<DataSourceResponse>({
        health: 'LIVE',
        staleTickers: [],
        maxStalenessHours: 0,
        summary: 'Pre-upgrade heartbeat — assumed live',
        lastYahooSuccess: heartbeat.timestamp.toISOString(),
      });
    }

    // Find the last heartbeat where data was LIVE (all Yahoo)
    let lastYahooSuccess: string | null = null;
    try {
      const successHeartbeats = await prisma.heartbeat.findMany({
        where: { status: 'SUCCESS' },
        orderBy: { timestamp: 'desc' },
        take: 10,
        select: { details: true, timestamp: true },
      });
      for (const hb of successHeartbeats) {
        if (!hb.details) continue;
        try {
          const d = JSON.parse(hb.details) as Record<string, unknown>;
          const hbDs = d.dataSource as { health?: string } | undefined;
          // Pre-upgrade heartbeats or LIVE health both count as Yahoo success
          if (!hbDs || hbDs.health === 'LIVE') {
            lastYahooSuccess = hb.timestamp.toISOString();
            break;
          }
        } catch { continue; }
      }
    } catch {
      // Non-critical — last Yahoo timestamp just won't show
    }

    const health = (['LIVE', 'PARTIAL', 'DEGRADED'].includes(ds.health)
      ? ds.health
      : 'UNKNOWN') as DataSourceResponse['health'];

    return NextResponse.json<DataSourceResponse>({
      health,
      staleTickers: ds.staleTickers ?? [],
      maxStalenessHours: ds.maxStalenessHours ?? 0,
      summary: ds.summary ?? '',
      lastYahooSuccess,
    });
  } catch (error) {
    console.error('[API] Data source status error:', (error as Error).message);
    return NextResponse.json<DataSourceResponse>({
      health: 'UNKNOWN',
      staleTickers: [],
      maxStalenessHours: 0,
      summary: 'API error',
      lastYahooSuccess: null,
    });
  }
}
