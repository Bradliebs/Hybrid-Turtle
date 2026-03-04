/**
 * DEPENDENCIES
 * Consumed by: scan-cache.ts, modules-cache.ts, market-data.ts, cache-warmup.ts
 * Consumes: fs (Node built-in)
 * Risk-sensitive: NO (optimisation layer only — never a source of truth)
 * Last modified: 2026-03-04
 * Notes: Generic file-based cache persistence. Never throws — all errors
 *        are caught and logged. Writes are atomic (temp file + rename).
 */

import fs from 'fs';
import path from 'path';

// ── Types ──

export interface PersistedCache<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
  version: string;
}

export interface CachePersistenceOptions {
  cacheKey: string;
  ttlMs: number;
  version: string;
}

// ── Constants ──

const CACHE_DIR = path.join(process.cwd(), 'prisma', 'cache');
const MAX_CACHE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function ensureCacheDir(): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    // Already exists or permission issue — ignore
  }
}

function cacheFilePath(cacheKey: string): string {
  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

// ── Persist ──

export async function persistCache<T>(
  options: CachePersistenceOptions,
  data: T
): Promise<void> {
  try {
    const payload: PersistedCache<T> = {
      data,
      cachedAt: Date.now(),
      ttlMs: options.ttlMs,
      version: options.version,
    };

    const serialised = JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(serialised, 'utf-8');

    if (sizeBytes > MAX_CACHE_SIZE_BYTES) {
      console.warn(
        `[cache-persistence] Cache '${options.cacheKey}' is ${sizeBytes} bytes — ` +
        `exceeds ${MAX_CACHE_SIZE_BYTES / 1024 / 1024}MB limit, skipping persistence`
      );
      return;
    }

    ensureCacheDir();

    const filepath = cacheFilePath(options.cacheKey);
    const tempPath = `${filepath}.tmp`;

    // Atomic write: temp file → rename
    fs.writeFileSync(tempPath, serialised, 'utf-8');
    fs.renameSync(tempPath, filepath);
  } catch (err) {
    console.warn(`[cache-persistence] Failed to persist '${options.cacheKey}':`, (err as Error).message);
  }
}

// ── Rehydrate ──

export async function rehydrateCache<T>(
  options: CachePersistenceOptions
): Promise<{ data: T; age: number } | null> {
  try {
    const filepath = cacheFilePath(options.cacheKey);

    if (!fs.existsSync(filepath)) return null;

    const raw = fs.readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedCache<T>;

    // Validate structure
    if (!parsed || typeof parsed.cachedAt !== 'number' || parsed.data === undefined) {
      console.warn(`[cache-persistence] Invalid structure in '${options.cacheKey}' — ignoring`);
      return null;
    }

    // Version check
    if (parsed.version !== options.version) {
      console.log(`[cache-persistence] Version mismatch for '${options.cacheKey}': ` +
        `file=${parsed.version}, expected=${options.version} — invalidating`);
      await invalidateCache(options);
      return null;
    }

    // TTL check
    const now = Date.now();
    const age = now - parsed.cachedAt;
    if (age > parsed.ttlMs) {
      return null; // Expired
    }

    return { data: parsed.data, age };
  } catch (err) {
    console.warn(`[cache-persistence] Failed to rehydrate '${options.cacheKey}':`, (err as Error).message);
    return null;
  }
}

// ── Invalidate ──

export async function invalidateCache(
  options: Pick<CachePersistenceOptions, 'cacheKey'>
): Promise<void> {
  try {
    const filepath = cacheFilePath(options.cacheKey);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch {
    // Silent
  }
}

// ── List all persisted caches ──

export async function listPersistedCaches(): Promise<Array<{
  cacheKey: string;
  cachedAt: number;
  ageMs: number;
  ttlMs: number;
  expired: boolean;
  sizeBytes: number;
}>> {
  try {
    if (!fs.existsSync(CACHE_DIR)) return [];

    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
    const now = Date.now();

    return files.map((filename) => {
      const filepath = path.join(CACHE_DIR, filename);
      const stats = fs.statSync(filepath);
      const cacheKey = filename.replace('.json', '');

      try {
        const raw = fs.readFileSync(filepath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedCache<unknown>;
        const age = now - parsed.cachedAt;
        return {
          cacheKey,
          cachedAt: parsed.cachedAt,
          ageMs: age,
          ttlMs: parsed.ttlMs,
          expired: age > parsed.ttlMs,
          sizeBytes: stats.size,
        };
      } catch {
        return {
          cacheKey,
          cachedAt: 0,
          ageMs: 0,
          ttlMs: 0,
          expired: true,
          sizeBytes: stats.size,
        };
      }
    });
  } catch {
    return [];
  }
}

// ── Invalidate all ──

export async function invalidateAllCaches(): Promise<void> {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* skip */ }
    }
  } catch {
    // Silent
  }
}
