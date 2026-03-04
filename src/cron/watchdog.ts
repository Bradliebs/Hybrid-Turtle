/**
 * DEPENDENCIES
 * Consumed by: watchdog-task.bat, Task Scheduler
 * Consumes: prisma.ts, telegram.ts
 * Risk-sensitive: NO — monitoring only
 * Last modified: 2026-03-04
 * Notes: Lightweight watchdog that checks for missed nightly/midday heartbeats
 *        and sends a Telegram alert if the nightly hasn't run in 26+ hours.
 *        Runs daily at 10:00 AM via Task Scheduler.
 */

import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';

const NIGHTLY_STALE_HOURS = 26;

async function runWatchdog(): Promise<void> {
  console.log('🐕 Watchdog check starting...');

  const alerts: string[] = [];

  // Check nightly heartbeat
  const latestNightly = await prisma.heartbeat.findFirst({
    where: {
      status: { in: ['SUCCESS', 'FAILED', 'PARTIAL', 'OK'] },
    },
    orderBy: { timestamp: 'desc' },
  });

  if (!latestNightly) {
    alerts.push('🚨 WATCHDOG: No nightly heartbeat found at all. Has the nightly pipeline ever run?');
  } else {
    const hoursSince = (Date.now() - latestNightly.timestamp.getTime()) / (1000 * 60 * 60);
    if (hoursSince > NIGHTLY_STALE_HOURS) {
      const lastRun = latestNightly.timestamp.toISOString().replace('T', ' ').slice(0, 19);
      alerts.push(
        `🚨 WATCHDOG: No nightly heartbeat in ${Math.round(hoursSince)}+ hours. Last run: ${lastRun}. Check Task Scheduler.`
      );
    }
  }

  // Check midday sync on weekdays (Mon-Fri = 1-5)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  if (isWeekday) {
    // Check for a midday heartbeat today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const middayHeartbeat = await prisma.heartbeat.findFirst({
      where: {
        timestamp: { gte: todayStart },
        details: { contains: 'midday' },
      },
      orderBy: { timestamp: 'desc' },
    });

    // Also check for SKIPPED status (intentional skip, e.g. market closed)
    const skippedHeartbeat = await prisma.heartbeat.findFirst({
      where: {
        timestamp: { gte: todayStart },
        status: 'SKIPPED',
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!middayHeartbeat && !skippedHeartbeat && now.getHours() >= 13) {
      // Only alert after 1 PM — midday sync runs at noon
      alerts.push(
        '⚠️ WATCHDOG: No midday sync heartbeat found for today. Check Task Scheduler or midday-sync-task.bat.'
      );
    }
  }

  if (alerts.length === 0) {
    console.log('✅ All heartbeats within expected window. No alerts needed.');
    return;
  }

  // Send Telegram alert
  const message = alerts.join('\n\n');
  console.log('Sending watchdog alert:', message);

  const sent = await sendTelegramMessage({
    text: message,
    parseMode: 'HTML',
  });

  if (sent) {
    console.log('✅ Watchdog alert sent via Telegram.');
  } else {
    console.error('❌ Failed to send watchdog Telegram alert.');
  }
}

runWatchdog()
  .catch((err) => {
    console.error('Watchdog error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
