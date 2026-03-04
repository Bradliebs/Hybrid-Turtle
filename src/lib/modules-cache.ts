/**
 * DEPENDENCIES
 * Consumed by: /api/modules/route.ts, cache-warmup.ts
 * Consumes: cache-persistence.ts, cache-keys.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-04
 * Notes: Extracted from inline caching in /api/modules/route.ts.
 *        Persists to disk so module results survive server restarts.
 */

import type { AllModulesResult } from '@/types';
import { persistCache, rehydrateCache, invalidateCache } from './cache-persistence';
import { CACHE_KEYS } from './cache-keys';

// ── In-memory cache (same structure as was inline in route.ts) ──

interface ModulesCacheEntry {
  json: AllModulesResult;
  expiry: number;
  userId: string;
}

const globalForModules = globalThis as unknown as {
  __modulesCache: ModulesCacheEntry | null;
};

if (!globalForModules.__modulesCache) {
  globalForModules.__modulesCache = null;
}

const MODULES_CACHE_TTL = 5 * 60_000; // 5 minutes

export { MODULES_CACHE_TTL };

/** Get cached module results if still valid. */
export function getModulesCache(userId: string): AllModulesResult | null {
  const c = globalForModules.__modulesCache;
  if (c && c.userId === userId && c.expiry > Date.now()) {
    return c.json;
  }
  return null;
}

/** Store module results. Also persists to disk (fire-and-forget). */
export function setModulesCache(userId: string, result: AllModulesResult): void {
  globalForModules.__modulesCache = {
    json: result,
    expiry: Date.now() + MODULES_CACHE_TTL,
    userId,
  };
  // Persist to disk asynchronously
  persistCache(CACHE_KEYS.MODULE_RESULTS, {
    result,
    userId,
    cachedAtMs: Date.now(),
  }).catch((err) => {
    console.warn('[modules-cache] Failed to persist to disk:', (err as Error).message);
  });
}

/** Clear the modules cache. */
export function clearModulesCache(): void {
  globalForModules.__modulesCache = null;
  invalidateCache(CACHE_KEYS.MODULE_RESULTS).catch(() => {});
}

/**
 * Attempt to rehydrate the modules cache from disk.
 * Called once at server startup by cache-warmup.ts.
 */
export async function rehydrateModulesCacheFromDisk(): Promise<boolean> {
  if (globalForModules.__modulesCache && globalForModules.__modulesCache.expiry > Date.now()) {
    return true; // Already warm
  }
  try {
    const persisted = await rehydrateCache<{
      result: AllModulesResult;
      userId: string;
      cachedAtMs: number;
    }>(CACHE_KEYS.MODULE_RESULTS);
    if (persisted) {
      const age = persisted.age;
      globalForModules.__modulesCache = {
        json: persisted.data.result,
        expiry: Date.now() + MODULES_CACHE_TTL - age, // Preserve remaining TTL
        userId: persisted.data.userId,
      };
      console.log(`[modules-cache] Rehydrated from disk (age: ${Math.round(age / 1000)}s)`);
      return true;
    }
  } catch {
    // Silent
  }
  return false;
}
