/**
 * DEPENDENCIES
 * Consumed by: /api/scan/route.ts, /api/scan/progress/route.ts
 * Consumes: nothing
 * Risk-sensitive: NO
 * Last modified: 2026-03-02
 * Notes: In-memory progress store for scan SSE streaming.
 *        Uses globalThis to survive Next.js dev-mode module reloads
 *        so the SSE GET handler and scan POST handler share state.
 */

export interface ScanProgress {
  stage: string;
  processed: number;
  total: number;
  timestamp: number;
}

interface ScanProgressStore {
  currentProgress: ScanProgress | null;
  listeners: Set<(progress: ScanProgress) => void>;
}

// globalThis survives HMR — ensures SSE handler and scan handler share the same store
const globalForProgress = globalThis as unknown as { __scanProgressStore?: ScanProgressStore };
if (!globalForProgress.__scanProgressStore) {
  globalForProgress.__scanProgressStore = {
    currentProgress: null,
    listeners: new Set(),
  };
}
const store = globalForProgress.__scanProgressStore;

export function updateScanProgress(stage: string, processed: number, total: number): void {
  store.currentProgress = { stage, processed, total, timestamp: Date.now() };
  store.listeners.forEach((listener) => listener(store.currentProgress!));
}

export function getScanProgress(): ScanProgress | null {
  return store.currentProgress;
}

export function clearScanProgress(): void {
  store.currentProgress = null;
}

export function subscribeScanProgress(listener: (progress: ScanProgress) => void): () => void {
  store.listeners.add(listener);
  return () => { store.listeners.delete(listener); };
}
