export const dynamic = 'force-dynamic';

import { subscribeScanProgress, getScanProgress } from '@/lib/scan-progress';

/**
 * SSE endpoint for real-time scan progress.
 * The client opens an EventSource here and receives progress events
 * as the scan engine processes batches.
 */
export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current progress immediately if a scan is already running
      const current = getScanProgress();
      if (current) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(current)}\n\n`));
      }

      const unsubscribe = subscribeScanProgress((progress) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        } catch {
          // Client disconnected
          unsubscribe();
        }
      });

      // Clean up when client disconnects (controller close or error)
      const cleanup = () => { unsubscribe(); };
      // The stream will be closed when the client disconnects;
      // ReadableStream doesn't have a direct "onclose" but the
      // enqueue will throw when the stream is cancelled.
      void Promise.resolve().then(() => {
        // Store cleanup ref so cancel() can call it
        (stream as unknown as { _cleanup?: () => void })._cleanup = cleanup;
      });
    },
    cancel() {
      // Client disconnected — no-op, unsubscribe handled by enqueue error
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
