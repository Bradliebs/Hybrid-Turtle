/**
 * DEPENDENCIES
 * Consumed by: SystemPanel (settings page)
 * Consumes: cache-persistence.ts, scan-cache.ts, modules-cache.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-04
 * Notes: GET returns persisted cache status. POST clears all caches.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { listPersistedCaches, invalidateAllCaches } from '@/lib/cache-persistence';
import { clearScanCache } from '@/lib/scan-cache';
import { clearModulesCache } from '@/lib/modules-cache';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { CACHE_KEYS } from '@/lib/cache-keys';

const CACHE_LABELS: Record<string, string> = {
  'scan-results': 'Scan Results',
  'module-results': 'Module Results',
  'yahoo-quotes': 'Yahoo Quotes',
};

export async function GET(_request: NextRequest) {
  try {
    const persisted = await listPersistedCaches();

    const caches: Array<{
      name: string;
      cacheKey: string;
      status: 'WARM' | 'STALE' | 'EMPTY';
      ageMinutes: number | null;
      ttlMinutes: number;
      sizeBytes: number | null;
      persistedAt: string | null;
    }> = persisted.map((c) => ({
      name: CACHE_LABELS[c.cacheKey] ?? c.cacheKey,
      cacheKey: c.cacheKey,
      status: c.expired ? 'STALE' as const : 'WARM' as const,
      ageMinutes: Math.round(c.ageMs / 60_000),
      ttlMinutes: Math.round(c.ttlMs / 60_000),
      sizeBytes: c.sizeBytes,
      persistedAt: c.cachedAt > 0 ? new Date(c.cachedAt).toISOString() : null,
    }));

    // Add entries for caches that don't have a persisted file yet
    for (const key of Object.values(CACHE_KEYS)) {
      if (!caches.some((c) => c.cacheKey === key.cacheKey)) {
        caches.push({
          name: CACHE_LABELS[key.cacheKey] ?? key.cacheKey,
          cacheKey: key.cacheKey,
          status: 'EMPTY' as const,
          ageMinutes: null as unknown as number,
          ttlMinutes: Math.round(key.ttlMs / 60_000),
          sizeBytes: null as unknown as number,
          persistedAt: null,
        });
      }
    }

    return NextResponse.json({ caches });
  } catch (error) {
    console.error('[cache-status] GET error:', error);
    return apiError(500, 'CACHE_STATUS_FAILED', (error as Error).message, undefined, true);
  }
}

const clearSchema = z.object({
  action: z.literal('clear_all'),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, clearSchema);
    if (!parsed.ok) return parsed.response;

    // Clear in-memory caches
    clearScanCache();
    clearModulesCache();

    // Clear all persisted files
    await invalidateAllCaches();

    return NextResponse.json({ ok: true, message: 'All caches cleared' });
  } catch (error) {
    console.error('[cache-status] POST error:', error);
    return apiError(500, 'CACHE_CLEAR_FAILED', (error as Error).message, undefined, true);
  }
}
