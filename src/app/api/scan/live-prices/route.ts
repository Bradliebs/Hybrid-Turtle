/**
 * DEPENDENCIES
 * Consumed by: src/app/scan/page.tsx (live price overlay for READY/WATCH candidates)
 * Consumes: src/lib/market-data.ts (getBatchQuotes)
 * Risk-sensitive: NO
 * Last modified: 2026-02-23
 * Notes: Returns live Yahoo Finance quotes for a list of tickers.
 *        Uses the 30-min quote cache so repeated calls within that window are free.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBatchQuotes } from '@/lib/market-data';
import { apiError } from '@/lib/api-response';
import { parseJsonBody } from '@/lib/request-validation';

const livePricesSchema = z.object({
  tickers: z.array(z.string().trim().min(1)).min(1).max(50),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, livePricesSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const { tickers } = parsed.data;
    const quotes = await getBatchQuotes(tickers);

    // Return a lightweight map: ticker → { price, change, changePercent }
    const prices: Record<string, { price: number; change: number; changePercent: number }> = {};
    quotes.forEach((quote, ticker) => {
      prices[ticker] = {
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
      };
    });

    return NextResponse.json({
      prices,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[LivePrices] Error:', error);
    return apiError(
      500,
      'LIVE_PRICES_FAILED',
      'Failed to fetch live prices',
      (error as Error).message,
      true
    );
  }
}
