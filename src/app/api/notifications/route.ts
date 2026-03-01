/**
 * DEPENDENCIES
 * Consumed by: Navbar bell, /notifications page
 * Consumes: prisma.ts
 * Risk-sensitive: NO
 * Last modified: 2026-02-28
 * Notes: GET returns notifications (unread first, most recent first).
 *        Query param ?unreadOnly=true filters to unread only.
 *        Query param ?limit=N limits count (default 50).
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    const where = unreadOnly ? { readAt: null } : {};

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [
          { readAt: 'asc' },      // unread (null) first — SQLite sorts nulls first in asc
          { createdAt: 'desc' },  // most recent first within each group
        ],
        take: limit,
      }),
      prisma.notification.count({ where: { readAt: null } }),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error('[GET /api/notifications] Error:', (error as Error).message);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
