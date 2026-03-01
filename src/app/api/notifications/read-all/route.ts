/**
 * DEPENDENCIES
 * Consumed by: /notifications page
 * Consumes: prisma.ts
 * Risk-sensitive: NO
 * Last modified: 2026-02-28
 * Notes: POST marks ALL unread notifications as read.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST() {
  try {
    const result = await prisma.notification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });

    return NextResponse.json({ markedRead: result.count });
  } catch (error) {
    console.error('[POST /api/notifications/read-all] Error:', (error as Error).message);
    return NextResponse.json({ error: 'Failed to mark all as read' }, { status: 500 });
  }
}
