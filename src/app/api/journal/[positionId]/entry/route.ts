export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

/**
 * DEPENDENCIES
 * Consumed by: /journal page (entry note form)
 * Consumes: prisma.ts, api-response.ts, request-validation.ts
 * Risk-sensitive: NO — journal notes only, no position/stop changes
 * Last modified: 2026-03-01
 */

const entryNoteSchema = z.object({
  entryNote: z.string().trim().min(1, 'Entry note cannot be empty'),
  entryConfidence: z.number().int().min(1).max(5),
});

// POST /api/journal/[positionId]/entry — create or update entry note
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ positionId: string }> }
) {
  try {
    const { positionId } = await params;

    // Verify position exists
    const position = await prisma.position.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      return apiError(404, 'POSITION_NOT_FOUND', `Position ${positionId} not found`);
    }

    const parsed = await parseJsonBody(request, entryNoteSchema);
    if (!parsed.ok) return parsed.response;

    const { entryNote, entryConfidence } = parsed.data;

    const journal = await prisma.tradeJournal.upsert({
      where: { positionId },
      create: {
        positionId,
        entryNote,
        entryConfidence,
        entryNoteAt: new Date(),
      },
      update: {
        entryNote,
        entryConfidence,
        entryNoteAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, journal });
  } catch (err) {
    console.error('POST /api/journal/[positionId]/entry error:', err);
    return apiError(500, 'JOURNAL_ENTRY_ERROR', 'Failed to save entry note');
  }
}
