/**
 * DEPENDENCIES
 * Consumed by: OnboardingBanner.tsx (dashboard)
 * Consumes: prisma.ts, onboarding-steps.ts
 * Risk-sensitive: NO (read-only status check + dismiss flag)
 * Last modified: 2026-03-04
 * Notes: GET evaluates step completion against live DB state.
 *        POST records dismissal in User.onboardingDismissed.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { ONBOARDING_STEPS } from '@/lib/onboarding-steps';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const DEFAULT_USER_ID = 'default-user';

/**
 * GET /api/onboarding
 * Returns current completion status of all onboarding steps.
 */
export async function GET(_request: NextRequest) {
  try {
    await ensureDefaultUser();

    const user = await prisma.user.findUnique({
      where: { id: DEFAULT_USER_ID },
      select: {
        equity: true,
        t212Connected: true,
        t212IsaConnected: true,
        onboardingDismissed: true,
      },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Check each step's completion condition
    const completedIds: string[] = [];

    // Step 1: Equity set (changed from default 10000)
    if (user.equity !== 10000) {
      completedIds.push('set_equity');
    }

    // Step 2: T212 Invest connected
    if (user.t212Connected) {
      completedIds.push('connect_t212_invest');
    }

    // Step 3: T212 ISA connected
    if (user.t212IsaConnected) {
      completedIds.push('connect_t212_isa');
    }

    // Step 4: Telegram configured (env vars)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      completedIds.push('configure_telegram');
    }

    // Step 5: First scan run (within last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentScan = await prisma.scan.findFirst({
      where: { userId: DEFAULT_USER_ID, runDate: { gte: sevenDaysAgo } },
      select: { id: true },
    });
    if (recentScan) {
      completedIds.push('run_first_scan');
    }

    // Step 6: Nightly scheduled (heartbeat < 26h old)
    const twentySixHoursAgo = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const recentHeartbeat = await prisma.heartbeat.findFirst({
      where: { timestamp: { gte: twentySixHoursAgo }, status: { in: ['OK', 'SUCCESS'] } },
      select: { id: true },
    });
    if (recentHeartbeat) {
      completedIds.push('schedule_nightly');
    }

    // Build response
    const completedSet = new Set(completedIds);
    const steps = ONBOARDING_STEPS.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      href: step.href,
      hrefLabel: step.hrefLabel,
      required: step.required,
      completed: completedSet.has(step.id),
    }));

    const requiredRemaining = steps.filter((s) => s.required && !s.completed).length;
    const optionalRemaining = steps.filter((s) => !s.required && !s.completed).length;
    const isComplete = requiredRemaining === 0;

    return NextResponse.json({
      isComplete,
      isDismissed: user.onboardingDismissed,
      completedSteps: completedIds,
      steps,
      requiredRemaining,
      optionalRemaining,
    });
  } catch (error) {
    console.error('[onboarding] GET error:', error);
    return apiError(500, 'ONBOARDING_FETCH_FAILED', (error as Error).message, undefined, true);
  }
}

const dismissSchema = z.object({
  action: z.literal('dismiss'),
});

/**
 * POST /api/onboarding
 * Records dismissal of the onboarding banner.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, dismissSchema);
    if (!parsed.ok) return parsed.response;

    await prisma.user.update({
      where: { id: DEFAULT_USER_ID },
      data: { onboardingDismissed: true },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[onboarding] POST error:', error);
    return apiError(500, 'ONBOARDING_DISMISS_FAILED', (error as Error).message, undefined, true);
  }
}
