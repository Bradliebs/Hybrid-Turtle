export const dynamic = 'force-dynamic';

/**
 * DEPENDENCIES
 * Consumed by: Dashboard equity milestone banner
 * Consumes: prisma.ts
 * Risk-sensitive: NO — advisory only, never changes risk profile
 * Last modified: 2026-03-04
 * Notes: Dismisses equity milestone notifications so they don't repeat.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { apiError } from '@/lib/api-response';

const dismissSchema = z.object({
  userId: z.string().default('default-user'),
  threshold: z.number().positive(),
});

export async function POST(request: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    const parsed = dismissSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(400, 'INVALID_REQUEST', 'Invalid dismiss payload');
    }

    const { userId, threshold } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const dismissed: number[] = user.dismissedEquityThresholds
      ? JSON.parse(user.dismissedEquityThresholds) as number[]
      : [];

    if (!dismissed.includes(threshold)) {
      dismissed.push(threshold);
      await prisma.user.update({
        where: { id: userId },
        data: { dismissedEquityThresholds: JSON.stringify(dismissed) },
      });
    }

    return NextResponse.json({ dismissed });
  } catch (error) {
    console.error('[API] Dismiss equity threshold error:', (error as Error).message);
    return apiError(500, 'DISMISS_FAILED', 'Failed to dismiss threshold');
  }
}
