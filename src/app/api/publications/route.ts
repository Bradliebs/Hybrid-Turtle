import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';

interface PublicationItem {
  date: string;
  title: string;
  type: 'summary' | 'scan' | 'alert' | 'trade';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const [latestHealth, latestHeartbeat, latestStop, latestPosition] = await Promise.all([
      prisma.healthCheck.findFirst({
        where: { userId },
        orderBy: { runDate: 'desc' },
      }),
      prisma.heartbeat.findFirst({
        orderBy: { timestamp: 'desc' },
      }),
      prisma.stopHistory.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { position: { include: { stock: true } } },
      }),
      prisma.position.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { stock: true },
      }),
    ]);

    const publications: Array<{ date: Date; item: PublicationItem }> = [];

    if (latestHeartbeat) {
      publications.push({
        date: latestHeartbeat.timestamp,
        item: {
          date: latestHeartbeat.timestamp.toISOString(),
          title: `Nightly Summary — ${latestHeartbeat.status}`,
          type: 'summary',
        },
      });
    }

    if (latestHealth) {
      publications.push({
        date: latestHealth.runDate,
        item: {
          date: latestHealth.runDate.toISOString(),
          title: `Health Check — ${latestHealth.overall}`,
          type: 'summary',
        },
      });
    }

    if (latestStop?.position?.stock) {
      publications.push({
        date: latestStop.createdAt,
        item: {
          date: latestStop.createdAt.toISOString(),
          title: `Stop-loss updated: ${latestStop.position.stock.ticker}`,
          type: 'alert',
        },
      });
    }

    if (latestPosition?.stock) {
      const verb = latestPosition.status === 'CLOSED' ? 'Position closed' : 'Position opened';
      publications.push({
        date: latestPosition.createdAt,
        item: {
          date: latestPosition.createdAt.toISOString(),
          title: `${verb}: ${latestPosition.stock.ticker}`,
          type: 'trade',
        },
      });
    }

    const sorted = publications
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 6)
      .map((entry) => entry.item);

    return NextResponse.json({ publications: sorted });
  } catch (error) {
    console.error('Publications fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch publications' },
      { status: 500 }
    );
  }
}
