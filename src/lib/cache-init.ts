/**
 * Cache initialisation — imported by root layout.tsx to warm caches on server start.
 * Fire-and-forget — never blocks rendering or throws.
 */

import { warmCachesOnStartup } from './cache-warmup';

// Fire-and-forget — warm caches in the background on first import
warmCachesOnStartup().catch((err) => {
  console.warn('[cache-init] Warmup failed:', (err as Error).message);
});
