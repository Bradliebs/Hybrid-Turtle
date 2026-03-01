export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

/**
 * DEPENDENCIES
 * Consumed by: /journal page (close note form)
 * Consumes: prisma.ts, api-response.ts, request-validation.ts
 * Risk-sensitive: NO — journal notes only, no position/stop changes
 * Last modified: 2026-03-01
 */

const closeNoteSchema = z.object({
  closeNote: z.string().trim().min(1, 'Close note cannot be empty'),
  learnedNote: z.string().trim().optional(),
});

// POST /api/journal/[positionId]/close — update close note (position must be CLOSED)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ positionId: string }> }
) {
  try {
    const { positionId } = await params;

    // Verify position exists and is CLOSED
    const position = await prisma.position.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      return apiError(404, 'POSITION_NOT_FOUND', `Position ${positionId} not found`);
    }

    if (position.status !== 'CLOSED') {
      return apiError(
        400,
        'POSITION_NOT_CLOSED',
        'Close notes can only be added to closed positions'
      );
    }

    const parsed = await parseJsonBody(request, closeNoteSchema);
    if (!parsed.ok) return parsed.response;

    const { closeNote, learnedNote } = parsed.data;

    const journal = await prisma.tradeJournal.upsert({
      where: { positionId },
      create: {
        positionId,
        closeNote,
        learnedNote: learnedNote ?? null,
        closeNoteAt: new Date(),
      },
      update: {
        closeNote,
        learnedNote: learnedNote ?? null,
        closeNoteAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, journal });
  } catch (err) {
    console.error('POST /api/journal/[positionId]/close error:', err);
    return apiError(500, 'JOURNAL_CLOSE_ERROR', 'Failed to save close note');
  }
}
