/**
 * DEPENDENCIES
 * Consumed by: /api/scan/route.ts, /api/scan/progress/route.ts
 * Consumes: nothing
 * Risk-sensitive: NO
 * Last modified: 2026-03-02
 * Notes: In-memory progress store for scan SSE streaming
 */

export interface ScanProgress {
  stage: string;
  processed: number;
  total: number;
  timestamp: number;
}

let currentProgress: ScanProgress | null = null;
const listeners = new Set<(progress: ScanProgress) => void>();

export function updateScanProgress(stage: string, processed: number, total: number): void {
  currentProgress = { stage, processed, total, timestamp: Date.now() };
  listeners.forEach((listener) => listener(currentProgress!));
}

export function getScanProgress(): ScanProgress | null {
  return currentProgress;
}

export function clearScanProgress(): void {
  currentProgress = null;
}

export function subscribeScanProgress(listener: (progress: ScanProgress) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
