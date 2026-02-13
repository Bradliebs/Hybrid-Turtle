import prisma from './prisma';
import { getWeekStart } from './utils';

export async function recordEquitySnapshot(
  userId: string,
  equity: number,
  openRiskPercent?: number
): Promise<void> {
  const latest = await prisma.equitySnapshot.findFirst({
    where: { userId },
    orderBy: { capturedAt: 'desc' },
  });

  if (latest) {
    const minutesSince = (Date.now() - latest.capturedAt.getTime()) / (1000 * 60);
    if (minutesSince < 360) {
      return;
    }
  }

  await prisma.equitySnapshot.create({
    data: {
      userId,
      equity,
      openRiskPercent: openRiskPercent ?? null,
    },
  });
}

export async function getWeeklyEquityChangePercent(
  userId: string
): Promise<{
  weeklyChangePercent: number | null;
  maxOpenRiskUsedPercent: number | null;
}> {
  const weekStart = getWeekStart(new Date());

  const startSnapshot = await prisma.equitySnapshot.findFirst({
    where: { userId, capturedAt: { gte: weekStart } },
    orderBy: { capturedAt: 'asc' },
  });

  const latestSnapshot = await prisma.equitySnapshot.findFirst({
    where: { userId },
    orderBy: { capturedAt: 'desc' },
  });

  const snapshotsThisWeek = await prisma.equitySnapshot.findMany({
    where: {
      userId,
      capturedAt: { gte: weekStart },
      openRiskPercent: { not: null },
    },
    select: { openRiskPercent: true },
  });

  const maxOpenRiskUsedPercent = snapshotsThisWeek.length > 0
    ? Math.max(...snapshotsThisWeek.map((s) => s.openRiskPercent || 0))
    : null;

  if (!startSnapshot || !latestSnapshot || startSnapshot.equity <= 0) {
    return { weeklyChangePercent: null, maxOpenRiskUsedPercent };
  }

  const weeklyChangePercent = ((latestSnapshot.equity - startSnapshot.equity) / startSnapshot.equity) * 100;

  return { weeklyChangePercent, maxOpenRiskUsedPercent };
}
