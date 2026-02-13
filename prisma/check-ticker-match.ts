import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSV_FILE = path.resolve(__dirname, '../../Planning/positions_state.csv');

function matchTicker(dbTicker: string, csvTicker: string): boolean {
  if (dbTicker === csvTicker) return true;
  if (dbTicker.toUpperCase() === csvTicker.toUpperCase()) return true;
  // T212: BATSl ↔ BATS.L
  if (dbTicker.endsWith('l') && csvTicker.endsWith('.L')) {
    if (dbTicker.slice(0, -1).toUpperCase() === csvTicker.replace('.L', '').toUpperCase()) return true;
  }
  if (csvTicker.endsWith('l') && dbTicker.endsWith('.L')) {
    if (csvTicker.slice(0, -1).toUpperCase() === dbTicker.replace('.L', '').toUpperCase()) return true;
  }
  // Strip .L from both
  if (dbTicker.replace('.L', '') === csvTicker.replace('.L', '')) return true;
  // GSK (csv) matches GSKl (db)
  if (dbTicker.endsWith('l') && dbTicker.slice(0, -1).toUpperCase() === csvTicker.toUpperCase()) return true;
  if (csvTicker.endsWith('l') && csvTicker.slice(0, -1).toUpperCase() === dbTicker.toUpperCase()) return true;
  return false;
}

async function check() {
  // Parse CSV
  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  const tickerIdx = headers.indexOf('ticker');
  const activeStopIdx = headers.indexOf('active_stop');
  const entryPriceIdx = headers.indexOf('entry_price');

  const csvRows: { ticker: string; activeStop: number; entryPrice: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    csvRows.push({
      ticker: cols[tickerIdx]?.trim(),
      activeStop: parseFloat(cols[activeStopIdx]),
      entryPrice: parseFloat(cols[entryPriceIdx]),
    });
  }

  // Get ALL stocks and positions from DB
  const allStocks = await prisma.stock.findMany({ orderBy: { ticker: 'asc' } });
  const allPositions = await prisma.position.findMany({
    include: { stock: true },
    orderBy: { updatedAt: 'desc' },
  });
  const openPositions = allPositions.filter(p => p.status === 'OPEN');

  console.log('=== CSV Tickers vs DB ===');
  console.log(`CSV rows: ${csvRows.length} | DB stocks: ${allStocks.length} | Open positions: ${openPositions.length}\n`);

  // Check each CSV ticker
  for (const row of csvRows) {
    const dbStockMatches = allStocks.filter(s => matchTicker(s.ticker, row.ticker));
    const dbPositionMatches = openPositions.filter(p => matchTicker(p.stock.ticker, row.ticker));

    const stockMatch = dbStockMatches.length > 0 ? dbStockMatches.map(s => s.ticker).join(', ') : '✗ NO MATCH';
    const posMatch = dbPositionMatches.length > 0
      ? dbPositionMatches.map(p => `${p.stock.ticker} stop=${p.currentStop.toFixed(2)}`).join(', ')
      : '— no open position';

    const stopMatch = dbPositionMatches.length > 0
      ? Math.abs(dbPositionMatches[0].currentStop - row.activeStop) < 0.01 ? '✓' : `✗ MISMATCH (db=${dbPositionMatches[0].currentStop.toFixed(2)} csv=${row.activeStop.toFixed(2)})`
      : '';

    console.log(`  ${row.ticker.padEnd(10)} → Stock: ${stockMatch.padEnd(25)} | Position: ${posMatch.padEnd(40)} ${stopMatch}`);
  }

  // Check reverse: DB open positions not in CSV
  console.log('\n=== DB Open Positions not in CSV ===');
  for (const pos of openPositions) {
    const csvMatch = csvRows.find(r => matchTicker(pos.stock.ticker, r.ticker));
    if (!csvMatch) {
      console.log(`  ✗ ${pos.stock.ticker} (stop=${pos.currentStop.toFixed(2)}) — NOT in CSV`);
    }
  }

  // Summary of DB stocks that aren't in universe
  console.log('\n=== DB Stocks without CSV entry ===');
  let missing = 0;
  for (const stock of allStocks) {
    const csvMatch = csvRows.find(r => matchTicker(stock.ticker, r.ticker));
    if (!csvMatch) missing++;
  }
  console.log(`  ${missing} of ${allStocks.length} DB stocks have no CSV row (expected — CSV only tracks active/recent positions)`);
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
