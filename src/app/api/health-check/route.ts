import { NextRequest, NextResponse } from 'next/server';
import { runHealthCheck } from '@/lib/health-check';

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
    const { userId } = await request.json();
    
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
