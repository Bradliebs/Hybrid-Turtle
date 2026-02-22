/**
 * Assign sectors to ETF tickers that are currently missing them.
 * Uses theme-based sector groupings for ETFs.
 * Run: npx tsx scripts/assign-etf-sectors.ts
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const SECTOR_MAP: Record<string, string> = {
  // ── Equity — US Broad ──
  VUSA:    'EQUITY — US BROAD',
  SQQQ:    'EQUITY — US BROAD',
  SH:      'EQUITY — US BROAD',
  SPXS:    'EQUITY — US BROAD',

  // ── Equity — US Tech ──
  'EQQQ.L': 'EQUITY — US TECH',
  CNDX:     'EQUITY — US TECH',
  XLK:      'EQUITY — US TECH',

  // ── Equity — US Factor ──
  IWMO:    'EQUITY — US FACTOR',
  MTUM:    'EQUITY — US FACTOR',
  WSML:    'EQUITY — US FACTOR',

  // ── Equity — Global ──
  'HMWO.L': 'EQUITY — GLOBAL',
  'XDWD.L': 'EQUITY — GLOBAL',
  'VUAG.L': 'EQUITY — GLOBAL',

  // ── Equity — Emerging ──
  EIMI:     'EQUITY — EMERGING',
  VWO:      'EQUITY — EMERGING',
  'IIND.L': 'EQUITY — EMERGING',

  // ── Equity — Sector ──
  XLE:     'EQUITY — SECTOR',
  XLF:     'EQUITY — SECTOR',
  XLV:     'EQUITY — SECTOR',

  // ── Thematic — AI / Robotics ──
  AIAI:    'THEMATIC — AI / ROBOTICS',
  RBOT:    'THEMATIC — AI / ROBOTICS',
  BTEE:    'THEMATIC — AI / ROBOTICS',

  // ── Thematic — Clean Energy ──
  INRG:    'THEMATIC — CLEAN ENERGY',

  // ── Commodities ──
  SGLN:     'COMMODITIES',
  SSLN:     'COMMODITIES',
  REMX:     'COMMODITIES',
  PICK:     'COMMODITIES',
  'CMOD.L': 'COMMODITIES',
  'COMF.L': 'COMMODITIES',

  // ── Bonds ──
  TLT:      'BONDS',
  'IGLT.L': 'BONDS',
  'VAGS.L': 'BONDS',

  // ── Volatility ──
  VXX:     'VOLATILITY',
};

async function main() {
  const tickers = Object.keys(SECTOR_MAP);
  console.log(`Updating ${tickers.length} ETF tickers with sector assignments...\n`);

  let updated = 0;
  let skipped = 0;

  for (const ticker of tickers) {
    const sector = SECTOR_MAP[ticker];
    const stock = await p.stock.findFirst({
      where: { ticker, active: true },
      select: { id: true, ticker: true, sector: true },
    });

    if (!stock) {
      console.log(`  SKIP  ${ticker.padEnd(12)} — not found or inactive`);
      skipped++;
      continue;
    }

    if (stock.sector && stock.sector.length > 0) {
      console.log(`  SKIP  ${ticker.padEnd(12)} — already has sector: ${stock.sector}`);
      skipped++;
      continue;
    }

    await p.stock.update({
      where: { id: stock.id },
      data: { sector },
    });
    console.log(`  SET   ${ticker.padEnd(12)} → ${sector}`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);

  // Verify: any remaining missing?
  const remaining = await p.stock.count({
    where: { active: true, OR: [{ sector: null }, { sector: '' }] },
  });
  console.log(`Remaining tickers without sector: ${remaining}`);
}

main().finally(() => p.$disconnect());
