/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (client fetch on plan page)
 * Consumes: ev-tracker.ts, ev-modifier.ts, scan cache / DB, api-response.ts
 * Risk-sensitive: NO — read-only advisory data
 * Last modified: 2026-03-01
 * Notes: Returns a map of ticker → EVModifierResult for current READY/WATCH candidates.
 *        Queries the EV tracker for each candidate's sleeve + ATR bucket + regime combo.
 *        Gracefully returns empty map if no scan data or no EV records exist.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getExpectancyForCombination, classifyAtrBucket } from '@/lib/ev-tracker';
import { getEVModifier, classifyAtrBucket as classifyAtrBucketPure, type EVModifierResult } from '@/lib/ev-modifier';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const regime = searchParams.get('regime')?.trim().toUpperCase() || 'UNKNOWN';

    // Fetch latest scan results with stock data (sleeve, atrPercent)
    const latestScan = await prisma.scan.findFirst({
      orderBy: { runDate: 'desc' },
      include: {
        results: {
          where: {
            status: { in: ['READY', 'WATCH'] },
          },
          include: { stock: true },
        },
      },
    });

    if (!latestScan || latestScan.results.length === 0) {
      return NextResponse.json({ ok: true, modifiers: {} });
    }

    // Build EV modifier for each candidate
    const modifiers: Record<string, EVModifierResult> = {};

    // Batch: collect unique combinations to avoid duplicate DB queries
    const comboMap = new Map<string, { sleeve: string; atrBucket: string; regime: string; tickers: string[] }>();

    for (const result of latestScan.results) {
      const sleeve = result.stock?.sleeve || 'CORE';
      const atrBucket = classifyAtrBucketPure(result.atrPercent);
      const comboKey = `${sleeve}|${atrBucket}|${regime}`;

      if (!comboMap.has(comboKey)) {
        comboMap.set(comboKey, { sleeve, atrBucket, regime, tickers: [] });
      }
      comboMap.get(comboKey)!.tickers.push(result.stock?.ticker || result.stockId);
    }

    // Query each unique combination once
    const combos = Array.from(comboMap.values());
    for (const combo of combos) {
      const slice = await getExpectancyForCombination(combo.sleeve, combo.atrBucket, combo.regime);
      const result = getEVModifier(slice);

      for (const ticker of combo.tickers) {
        modifiers[ticker] = result;
      }
    }

    return NextResponse.json({ ok: true, modifiers, regime, candidateCount: latestScan.results.length });
  } catch (error) {
    console.error('[EV Modifiers] Error:', error);
    return apiError(500, 'EV_MODIFIERS_FAILED', 'Failed to compute EV modifiers', (error as Error).message, true);
  }
}
