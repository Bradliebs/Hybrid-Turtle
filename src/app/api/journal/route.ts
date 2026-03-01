export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';

/**
 * DEPENDENCIES
 * Consumed by: /journal page
 * Consumes: prisma.ts, api-response.ts
 * Risk-sensitive: NO — read-only
 * Last modified: 2026-03-01
 */

// GET /api/journal — list all journal entries with position data
export async function GET() {
  try {
    const entries = await prisma.tradeJournal.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        position: {
          include: {
            stock: { select: { ticker: true, name: true } },
          },
        },
      },
    });

    const result = entries.map((e) => {
      const pos = e.position;
      const gainLoss =
        pos.status === 'CLOSED' && pos.exitPrice != null
          ? (pos.exitPrice - pos.entryPrice) * pos.shares
          : null;

      return {
        id: e.id,
        positionId: e.positionId,
        ticker: pos.stock.ticker,
        companyName: pos.stock.name,
        entryDate: pos.entryDate,
        exitDate: pos.exitDate,
        status: pos.status,
        entryPrice: pos.entryPrice,
        exitPrice: pos.exitPrice,
        shares: pos.shares,
        gainLoss,
        entryNote: e.entryNote,
        entryConfidence: e.entryConfidence,
        closeNote: e.closeNote,
        learnedNote: e.learnedNote,
        entryNoteAt: e.entryNoteAt,
        closeNoteAt: e.closeNoteAt,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      };
    });

    return NextResponse.json({ ok: true, entries: result });
  } catch (err) {
    console.error('GET /api/journal error:', err);
    return apiError(500, 'JOURNAL_FETCH_ERROR', 'Failed to fetch journal entries');
  }
}
