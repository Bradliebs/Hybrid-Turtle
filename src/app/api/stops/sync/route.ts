import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import {
  generateTrailingStopRecommendations,
  updateStopLoss,
  StopLossError,
} from '@/lib/stop-manager';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Trailing Stop Sync API
// ============================================================
// GET  — Generate trailing ATR stop recommendations for all open positions
// POST — Import active stops from positions_state.csv (external system)
// PUT  — Apply trailing stop recommendations (auto-update stops)
// ============================================================

/**
 * GET — Generate trailing ATR stop recommendations
 * Calculates where trailing stops SHOULD be based on price action + ATR
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const recommendations = await generateTrailingStopRecommendations(userId);

    return NextResponse.json({
      recommendations,
      count: recommendations.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Trailing stop sync error:', error);
    return NextResponse.json(
      { error: 'Failed to generate trailing stop recommendations' },
      { status: 500 }
    );
  }
}

/**
 * POST — Import active stops from Planning/positions_state.csv
 * Reads the external system's CSV and updates matching positions
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    // Find the CSV file
    const csvPaths = [
      path.join(process.cwd(), '..', 'Planning', 'positions_state.csv'),
      path.join(process.cwd(), 'Planning', 'positions_state.csv'),
    ];

    let csvContent = '';
    let csvPath = '';
    for (const p of csvPaths) {
      try {
        csvContent = fs.readFileSync(p, 'utf-8');
        csvPath = p;
        break;
      } catch {
        continue;
      }
    }

    if (!csvContent) {
      return NextResponse.json(
        { error: 'positions_state.csv not found in Planning folder' },
        { status: 404 }
      );
    }

    // Parse CSV
    const lines = csvContent.trim().split('\n');
    const headers = lines[0].split(',');
    const tickerIdx = headers.indexOf('ticker');
    const activeStopIdx = headers.indexOf('active_stop');
    const entryPriceIdx = headers.indexOf('entry_price');

    if (tickerIdx < 0 || activeStopIdx < 0) {
      return NextResponse.json(
        { error: 'CSV missing required columns: ticker, active_stop' },
        { status: 400 }
      );
    }

    const csvStops: { ticker: string; activeStop: number; entryPrice: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const ticker = cols[tickerIdx]?.trim();
      const activeStop = parseFloat(cols[activeStopIdx]);
      const entryPrice = entryPriceIdx >= 0 ? parseFloat(cols[entryPriceIdx]) : 0;

      if (ticker && !isNaN(activeStop) && activeStop > 0) {
        csvStops.push({ ticker, activeStop, entryPrice });
      }
    }

    // Match CSV tickers to open positions
    const positions = await prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: true },
    });

    const results: {
      ticker: string;
      action: string;
      oldStop: number;
      newStop: number;
    }[] = [];

    for (const csvRow of csvStops) {
      // Match by ticker — handle .L suffix and T212 lowercase-l format
      const matchedPosition = positions.find((p) => {
        const dbTicker = p.stock.ticker;
        const csv = csvRow.ticker;
        if (dbTicker === csv) return true;
        if (dbTicker.toUpperCase() === csv.toUpperCase()) return true;
        // T212: BATSl → BATS.L
        if (dbTicker.endsWith('l') && csv.endsWith('.L')) {
          if (dbTicker.slice(0, -1).toUpperCase() === csv.replace('.L', '').toUpperCase()) return true;
        }
        // Reverse
        if (csv.endsWith('l') && dbTicker.endsWith('.L')) {
          if (csv.slice(0, -1).toUpperCase() === dbTicker.replace('.L', '').toUpperCase()) return true;
        }
        // Strip .L
        if (dbTicker.replace('.L', '') === csv.replace('.L', '')) return true;
        // GSK (csv) matches GSKl (db)
        if (dbTicker.endsWith('l') && dbTicker.slice(0, -1).toUpperCase() === csv.toUpperCase()) return true;
        return false;
      });

      if (!matchedPosition) continue;

      const oldStop = matchedPosition.currentStop;
      const newStop = csvRow.activeStop;

      if (newStop > oldStop) {
        try {
          await updateStopLoss(
            matchedPosition.id,
            newStop,
            `CSV import: trailing ATR stop from external system (${csvRow.activeStop.toFixed(2)})`
          );
          results.push({
            ticker: matchedPosition.stock.ticker,
            action: 'UPDATED',
            oldStop,
            newStop,
          });
        } catch (error) {
          if (error instanceof StopLossError) {
            results.push({
              ticker: matchedPosition.stock.ticker,
              action: `BLOCKED: ${error.message}`,
              oldStop,
              newStop,
            });
          }
        }
      } else {
        results.push({
          ticker: matchedPosition.stock.ticker,
          action: newStop === oldStop ? 'NO_CHANGE' : 'SKIPPED_LOWER',
          oldStop,
          newStop,
        });
      }
    }

    return NextResponse.json({
      source: csvPath,
      csvRows: csvStops.length,
      matchedPositions: results.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('CSV stop import error:', error);
    return NextResponse.json(
      { error: 'Failed to import stops from CSV', message: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * PUT — Apply trailing ATR stop recommendations automatically
 * Generates recommendations then applies all valid ones
 */
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const recommendations = await generateTrailingStopRecommendations(userId);

    const results: {
      ticker: string;
      action: string;
      oldStop: number;
      newStop: number;
    }[] = [];

    for (const rec of recommendations) {
      try {
        await updateStopLoss(
          rec.positionId,
          rec.trailingStop,
          rec.reason
        );
        results.push({
          ticker: rec.ticker,
          action: 'UPDATED',
          oldStop: rec.currentStop,
          newStop: rec.trailingStop,
        });
      } catch (error) {
        if (error instanceof StopLossError) {
          results.push({
            ticker: rec.ticker,
            action: `BLOCKED: ${error.message}`,
            oldStop: rec.currentStop,
            newStop: rec.trailingStop,
          });
        }
      }
    }

    return NextResponse.json({
      applied: results.filter((r) => r.action === 'UPDATED').length,
      blocked: results.filter((r) => r.action !== 'UPDATED').length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Apply trailing stops error:', error);
    return NextResponse.json(
      { error: 'Failed to apply trailing stops' },
      { status: 500 }
    );
  }
}
