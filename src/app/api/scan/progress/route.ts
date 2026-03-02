export const dynamic = 'force-dynamic';

import { getScanProgress } from '@/lib/scan-progress';

/**
 * Polling endpoint for scan progress.
 * Returns current progress as JSON. The client polls this every ~800ms
 * while a scan is running. Simpler and more reliable than SSE in Next.js dev mode.
 */
export async function GET(): Promise<Response> {
  const current = getScanProgress();
  if (!current) {
    return Response.json({ stage: null, processed: 0, total: 0 }, { status: 200 });
  }
  return Response.json(current, { status: 200 });
}
