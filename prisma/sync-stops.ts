/**
 * Sync trailing stops from Planning/positions_state.csv into the database.
 * 
 * Usage: npx tsx prisma/sync-stops.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLANNING_DIR = path.resolve(__dirname, '../../Planning');
const CSV_FILE = path.join(PLANNING_DIR, 'positions_state.csv');

async function syncStops() {
  console.log('========================================');
  console.log('[SyncStops] Importing trailing stops from CSV');
  console.log(`  Source: ${CSV_FILE}`);
  console.log('========================================');

  if (!fs.existsSync(CSV_FILE)) {
    console.error('  ✗ positions_state.csv not found!');
    process.exit(1);
  }

  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');

  const tickerIdx = headers.indexOf('ticker');
  const activeStopIdx = headers.indexOf('active_stop');
  const entryPriceIdx = headers.indexOf('entry_price');
  const initialStopIdx = headers.indexOf('initial_stop');

  // Parse CSV rows
  const csvRows: { ticker: string; activeStop: number; entryPrice: number; initialStop: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const ticker = cols[tickerIdx]?.trim();
    const activeStop = parseFloat(cols[activeStopIdx]);
    const entryPrice = parseFloat(cols[entryPriceIdx]);
    const initialStop = parseFloat(cols[initialStopIdx]);
    if (ticker && !isNaN(activeStop) && activeStop > 0) {
      csvRows.push({ ticker, activeStop, entryPrice, initialStop });
    }
  }

  console.log(`  Found ${csvRows.length} tickers in CSV`);

  // Get all open positions from DB
  const positions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    include: { stock: true },
  });

  console.log(`  Found ${positions.length} open positions in DB`);
  console.log('');

  let updated = 0;
  let skipped = 0;

  for (const csvRow of csvRows) {
    // Match by ticker — handle .L suffix and T212 lowercase-l format
    const matched = positions.find((p) => {
      const dbTicker = p.stock.ticker;
      const csvTicker = csvRow.ticker;
      // Exact match
      if (dbTicker === csvTicker) return true;
      // Case-insensitive
      if (dbTicker.toUpperCase() === csvTicker.toUpperCase()) return true;
      // T212 format: BATSl → BATS.L
      if (dbTicker.endsWith('l') && csvTicker.endsWith('.L')) {
        const dbBase = dbTicker.slice(0, -1);
        const csvBase = csvTicker.replace('.L', '');
        if (dbBase.toUpperCase() === csvBase.toUpperCase()) return true;
      }
      // Reverse: BATS.L → BATSl
      if (csvTicker.endsWith('l') && dbTicker.endsWith('.L')) {
        const csvBase = csvTicker.slice(0, -1);
        const dbBase = dbTicker.replace('.L', '');
        if (csvBase.toUpperCase() === dbBase.toUpperCase()) return true;
      }
      // Strip .L from both
      if (dbTicker.replace('.L', '') === csvTicker.replace('.L', '')) return true;
      // GSK (csv) matches GSKl (db) — csv base matches db T212 base
      if (dbTicker.endsWith('l')) {
        const dbBase = dbTicker.slice(0, -1);
        if (dbBase.toUpperCase() === csvTicker.toUpperCase()) return true;
      }
      return false;
    });

    if (!matched) continue;

    const oldStop = matched.currentStop;
    const newStop = csvRow.activeStop;

    if (newStop > oldStop) {
      // Determine protection level based on position relative to entry
      const initialRisk = matched.initialRisk ?? (matched.entryPrice - newStop);
      if (!initialRisk || initialRisk <= 0) {
        console.log(`  ✗ ${matched.stock.ticker}: initialRisk=${initialRisk} invalid — skipped`);
        skipped++;
        continue;
      }
      let protectionLevel = 'INITIAL';
      if (initialRisk > 0) {
        const rMultiple = (newStop - matched.entryPrice) / initialRisk;
        if (rMultiple >= 3.0) protectionLevel = 'LOCK_1R_TRAIL';
        else if (rMultiple >= 2.5) protectionLevel = 'LOCK_08R';
        else if (rMultiple >= 1.5) protectionLevel = 'BREAKEVEN';
      }

      // Record stop history
      await prisma.stopHistory.create({
        data: {
          positionId: matched.id,
          oldStop,
          newStop,
          level: protectionLevel,
          reason: `CSV import: trailing ATR stop from external system (${newStop.toFixed(2)})`,
        },
      });

      // Update the position
      await prisma.position.update({
        where: { id: matched.id },
        data: {
          currentStop: newStop,
          stopLoss: newStop,
          protectionLevel,
        },
      });

      console.log(`  ✓ ${matched.stock.ticker}: ${oldStop.toFixed(2)} → ${newStop.toFixed(2)} (${protectionLevel})`);
      updated++;
    } else if (newStop === oldStop) {
      console.log(`  = ${matched.stock.ticker}: already at ${oldStop.toFixed(2)}`);
      skipped++;
    } else {
      console.log(`  ✗ ${matched.stock.ticker}: CSV stop ${newStop.toFixed(2)} < current ${oldStop.toFixed(2)} — skipped (monotonic)`);
      skipped++;
    }
  }

  console.log('');
  console.log('========================================');
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log('========================================');
}

syncStops()
  .catch((e) => {
    console.error('Sync failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
