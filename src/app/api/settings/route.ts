import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';

// GET /api/settings?userId=default-user
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'default-user';

    await ensureDefaultUser();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        riskProfile: true,
        equity: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT /api/settings — save risk profile and equity
export async function PUT(request: NextRequest) {
  try {
    const { userId, riskProfile, equity } = await request.json();
    const id = userId || 'default-user';

    const validProfiles = ['CONSERVATIVE', 'BALANCED', 'SMALL_ACCOUNT'];
    if (riskProfile && !validProfiles.includes(riskProfile)) {
      return NextResponse.json({ error: 'Invalid risk profile' }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (riskProfile) data.riskProfile = riskProfile;
    if (equity !== undefined && equity > 0) data.equity = equity;

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        riskProfile: true,
        equity: true,
      },
    });

    await recordEquitySnapshot(id, user.equity);

    return NextResponse.json(user);
  } catch (error) {
    console.error('PUT /api/settings error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
