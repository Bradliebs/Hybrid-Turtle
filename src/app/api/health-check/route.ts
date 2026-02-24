export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runHealthCheck } from '@/lib/health-check';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';

const healthCheckBodySchema = z.object({
  userId: z.string().trim().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    
    if (!userId) {
      return apiError(400, 'MISSING_USER_ID', 'userId is required');
    }

    const report = await runHealthCheck(userId);

    return NextResponse.json(report);
  } catch (error) {
    console.error('Health check error:', error);
    return apiError(500, 'HEALTH_CHECK_FAILED', 'Health check failed', (error as Error).message, true);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, healthCheckBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { userId } = parsed.data;

    const report = await runHealthCheck(userId);

    return NextResponse.json(report);
  } catch (error) {
    console.error('Health check error:', error);
    return apiError(500, 'HEALTH_CHECK_FAILED', 'Health check failed', (error as Error).message, true);
  }
}
