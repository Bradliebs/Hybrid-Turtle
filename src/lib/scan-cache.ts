// ============================================================
// Scan Result Cache
// ============================================================
// Holds the last scan result in memory so the UI can display
// it across page navigations without re-hitting Yahoo Finance.
// Uses globalThis to survive Next.js hot-reloads in dev mode
// (same pattern as Prisma singleton).
// Clears automatically on server restart or when a new scan runs.

export interface CachedScanResult {
  regime: string;
  candidates: unknown[];
  readyCount: number;
  watchCount: number;
  farCount: number;
  totalScanned: number;
  passedFilters: number;
  passedRiskGates: number;
  passedAntiChase: number;
  // metadata
  cachedAt: string;       // ISO timestamp
  userId: string;
  riskProfile: string;
  equity: number;
}

// Persist cache on globalThis so Next.js hot-reloads don't wipe it
const globalForScan = globalThis as unknown as {
  __scanCache: CachedScanResult | null;
};

if (!globalForScan.__scanCache) {
  globalForScan.__scanCache = null;
}

/** Store the latest scan result. */
export function setScanCache(
  result: Omit<CachedScanResult, 'cachedAt'>,
): CachedScanResult {
  globalForScan.__scanCache = {
    ...result,
    cachedAt: new Date().toISOString(),
  };
  return globalForScan.__scanCache;
}

/** Retrieve the cached scan result (or null if none). */
export function getScanCache(): CachedScanResult | null {
  return globalForScan.__scanCache;
}

/** Clear the cache (e.g. before a new scan). */
export function clearScanCache(): void {
  globalForScan.__scanCache = null;
}
