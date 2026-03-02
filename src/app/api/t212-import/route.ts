/**
 * DEPENDENCIES
 * Consumed by: Settings page T212 Import UI component
 * Consumes: t212-history-importer.ts, default-user.ts, api-response.ts
 * Risk-sensitive: NO — imports historical data only
 * Last modified: 2026-03-02
 */

import { NextRequest, NextResponse } from 'next/server';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';
import { importT212History, type AccountFilter } from '@/lib/t212-history-importer';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
// Import can take time — allow up to 120 seconds
export const maxDuration = 120;

const importSchema = z.object({
  accountType: z.enum(['isa', 'invest', 'both']).default('both'),
  dryRun: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  try {
    const userId = await ensureDefaultUser();
    if (!userId) {
      return apiError(401, 'NO_USER', 'No user found');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, 'INVALID_REQUEST', 'Invalid request body', parsed.error.message);
    }

    const { accountType, dryRun } = parsed.data;

    const report = await importT212History({
      accountType: accountType as AccountFilter,
      dryRun,
    });

    if (report.errors.length > 0 && report.filledOrders === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'IMPORT_FAILED', message: report.errors.join('; ') },
          report,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error('T212 import failed:', err);
    return apiError(500, 'IMPORT_FAILED', (err as Error).message);
  }
}
