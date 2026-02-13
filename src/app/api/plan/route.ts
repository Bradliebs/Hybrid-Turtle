import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { WeeklyPhase } from '@/types';
import { getCurrentWeeklyPhase } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const currentPhase = getCurrentWeeklyPhase();

    // Get the latest plan for this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const plan = await prisma.executionPlan.findFirst({
      where: {
        userId,
        weekOf: { gte: weekStart },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      currentPhase,
      plan,
      weekStart,
    });
  } catch (error) {
    console.error('Plan error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch plan' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, candidates, notes } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const plan = await prisma.executionPlan.create({
      data: {
        userId,
        weekOf: weekStart,
        phase: getCurrentWeeklyPhase() as WeeklyPhase,
        candidates: candidates || [],
        notes,
      },
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    console.error('Create plan error:', error);
    return NextResponse.json(
      { error: 'Failed to create plan', message: (error as Error).message },
      { status: 500 }
    );
  }
}
