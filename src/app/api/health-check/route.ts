import { NextRequest, NextResponse } from 'next/server';
import { runHealthCheck } from '@/lib/health-check';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const healthCheckBodySchema = z.object({
  userId: z.string().trim().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const report = await runHealthCheck(userId);

    return NextResponse.json(report);
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      { error: 'Health check failed', message: (error as Error).message },
      { status: 500 }
    );
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
    return NextResponse.json(
      { error: 'Health check failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}
