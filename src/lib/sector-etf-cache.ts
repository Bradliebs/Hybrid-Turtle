/**
 * DEPENDENCIES
 * Consumed by: breakout-probability.ts, nightly.ts (Step 5)
 * Consumes: market-data.ts (getDailyPrices — for ETF price fetch)
 * Risk-sensitive: NO — read-only cache, advisory data only
 * Last modified: 2026-02-28
 * Notes: In-memory cache of sector ETF 20-day returns. Refreshed nightly.
 *        Failure to refresh is non-blocking — BPS factor 4 returns 0.
 *        One Yahoo call per sector ETF (~11 calls total).
 */

// ── Sector → ETF Mapping ────────────────────────────────────
// Standard sector SPDR ETFs for US sectors. For UK/EU sectors without
// a direct ETF, we map to the closest US sector proxy.

const SECTOR_ETF_MAP: Record<string, string> = {
  // GICS sectors → SPDR Select Sector ETFs
  'Technology': 'XLK',
  'Healthcare': 'XLV',
  'Financials': 'XLF',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  'Industrials': 'XLI',
  'Energy': 'XLE',
  'Utilities': 'XLU',
  'Materials': 'XLB',
  'Real Estate': 'XLRE',
  'Communication Services': 'XLC',
  // Common aliases / shorthand used in cluster/sector fields
  'Tech': 'XLK',
  'Health Care': 'XLV',
  'Finance': 'XLF',
  'Consumer': 'XLY',
  'Industrial': 'XLI',
  'Oil & Gas': 'XLE',
  'Mining': 'XLB',
  'Telecom': 'XLC',
  'Media': 'XLC',
  'Retail': 'XLY',
  'Pharma': 'XLV',
  'Biotech': 'XLV',
  'Banks': 'XLF',
  'Insurance': 'XLF',
  'Aerospace': 'XLI',
  'Defence': 'XLI',
  'Semi': 'XLK',
  'Semiconductors': 'XLK',
  'Software': 'XLK',
};

// ── In-memory Cache ──────────────────────────────────────────

interface SectorMomentumEntry {
  /** ETF ticker */
  etf: string;
  /** 20-day return as percentage (e.g. 2.5 = +2.5%) */
  returnPct: number;
  /** When this was last refreshed */
  updatedAt: Date;
}

/** Maps normalised sector name → momentum data */
const sectorMomentumCache = new Map<string, SectorMomentumEntry>();

/** Cache TTL: 24 hours — refreshed by nightly pipeline */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── Public API ───────────────────────────────────────────────

/**
 * Get the 20-day return for a sector's ETF from cache.
 * Returns null if no data available (cache miss or expired).
 *
 * Tries to match the sector name case-insensitively against known mappings.
 */
export function getSectorMomentum(sector: string): number | null {
  if (!sector) return null;

  // Try direct lookup (normalised to lowercase)
  const normalised = sector.trim();
  const cached = sectorMomentumCache.get(normalised);
  if (cached && (Date.now() - cached.updatedAt.getTime()) < CACHE_TTL_MS) {
    return cached.returnPct;
  }

  // Try case-insensitive match against all cached keys
  const lower = normalised.toLowerCase();
  for (const [key, entry] of Array.from(sectorMomentumCache.entries())) {
    if (key.toLowerCase() === lower) {
      if ((Date.now() - entry.updatedAt.getTime()) < CACHE_TTL_MS) {
        return entry.returnPct;
      }
    }
  }

  return null;
}

/**
 * Get the ETF ticker for a given sector name.
 * Returns null if no mapping exists.
 */
export function getETFForSector(sector: string): string | null {
  if (!sector) return null;
  
  // Direct match
  const direct = SECTOR_ETF_MAP[sector];
  if (direct) return direct;

  // Case-insensitive match
  const lower = sector.toLowerCase();
  for (const [key, etf] of Object.entries(SECTOR_ETF_MAP)) {
    if (key.toLowerCase() === lower) return etf;
  }

  // Substring match — e.g. "Consumer Discretionary & Retail" matches "Consumer Discretionary"
  for (const [key, etf] of Object.entries(SECTOR_ETF_MAP)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return etf;
    }
  }

  return null;
}

/**
 * Refresh the sector momentum cache. Called from nightly.ts Step 5.
 *
 * Fetches 20-day returns for each unique sector ETF (deduplicated).
 * Non-blocking — failures are logged, not thrown.
 *
 * @returns Number of sectors successfully cached
 */
export async function refreshSectorMomentumCache(): Promise<{
  cached: number;
  failed: string[];
}> {
  // Lazy import to avoid circular dependency at module load time
  const { getDailyPrices } = await import('./market-data');

  // Deduplicate ETFs — multiple sectors may map to the same ETF
  const uniqueETFs = Array.from(new Set(Object.values(SECTOR_ETF_MAP)));
  const etfReturns = new Map<string, number>();
  const failed: string[] = [];

  for (const etf of uniqueETFs) {
    try {
      // compact = ~100 days — more than enough for a 20-day return
      const prices = await getDailyPrices(etf, 'compact');
      if (prices.length < 20) {
        failed.push(etf);
        continue;
      }

      // prices are newest-first. 20-day return = (newest close / close 20 bars ago - 1) * 100
      const recentClose = prices[0].close;
      const olderClose = prices[Math.min(19, prices.length - 1)].close;

      if (olderClose <= 0) {
        failed.push(etf);
        continue;
      }

      const returnPct = ((recentClose - olderClose) / olderClose) * 100;
      etfReturns.set(etf, Math.round(returnPct * 100) / 100);
    } catch (err) {
      console.warn(`[SectorETF] Failed to fetch ${etf}:`, (err as Error).message);
      failed.push(etf);
    }
  }

  // Populate cache for all sectors that map to a successfully fetched ETF
  let cached = 0;
  const now = new Date();
  for (const [sector, etf] of Object.entries(SECTOR_ETF_MAP)) {
    const returnPct = etfReturns.get(etf);
    if (returnPct != null) {
      sectorMomentumCache.set(sector, { etf, returnPct, updatedAt: now });
      cached++;
    }
  }

  return { cached, failed };
}

/**
 * Manually set sector momentum (for testing or manual override).
 */
export function setSectorMomentum(sector: string, returnPct: number): void {
  const etf = getETFForSector(sector) ?? 'MANUAL';
  sectorMomentumCache.set(sector, {
    etf,
    returnPct,
    updatedAt: new Date(),
  });
}

/**
 * Clear all cached data (for testing).
 */
export function clearSectorMomentumCache(): void {
  sectorMomentumCache.clear();
}
