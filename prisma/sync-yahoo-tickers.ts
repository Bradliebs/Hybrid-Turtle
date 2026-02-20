// ============================================================
// Sync Yahoo Ticker Mappings → Stock.yahooTicker column
// ============================================================
// Run: npx tsx prisma/sync-yahoo-tickers.ts
// Populates the yahooTicker column for non-US stocks that need
// an explicit Yahoo Finance symbol different from their DB ticker.
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Same map as src/lib/market-data.ts YAHOO_TICKER_MAP
const YAHOO_TICKER_MAP: Record<string, string> = {
  // UK / LSE
  AIAI: 'AIAI.L',
  AZN: 'AZN.L',
  BTEE: 'BTEE.L',
  CNDX: 'CNDX.L',
  DGE: 'DGE.L',
  EIMI: 'EIMI.L',
  GSK: 'GSK.L',
  HSBA: 'HSBA.L',
  INRG: 'INRG.L',
  IWMO: 'IWMO.L',
  NG: 'NG.L',
  RBOT: 'RBOT.L',
  REL: 'REL.L',
  RIO: 'RIO.L',
  SGLN: 'SGLN.L',
  SHEL: 'SHEL.L',
  SSE: 'SSE.L',
  SSLN: 'SSLN.L',
  ULVR: 'ULVR.L',
  VUSA: 'VUSA.L',
  WSML: 'WSML.L',
  // Germany / XETRA
  ALV: 'ALV.DE',
  SAP: 'SAP.DE',
  SIE: 'SIE.DE',
  // Netherlands / Euronext Amsterdam
  ASML: 'ASML.AS',
  MT: 'MT.AS',
  // France / Euronext Paris
  MC: 'MC.PA',
  OR: 'OR.PA',
  SU: 'SU.PA',
  TTE: 'TTE.PA',
  // Switzerland / SIX
  NOVN: 'NOVN.SW',
  ROG: 'ROG.SW',
  // Denmark / Copenhagen
  NVO: 'NOVO-B.CO',
  // Germany / XETRA additions (Feb 2026)
  DBK: 'DBK.DE',
  IFX: 'IFX.DE',
  HLAG: 'HLAG.DE',
  // Italy / Milan additions (Feb 2026)
  UCG: 'UCG.MI',
};

async function main() {
  console.log('Syncing Yahoo ticker mappings...\n');

  let updated = 0;
  let skipped = 0;

  for (const [dbTicker, yahooTicker] of Object.entries(YAHOO_TICKER_MAP)) {
    const stock = await prisma.stock.findUnique({ where: { ticker: dbTicker } });
    if (!stock) {
      console.log(`  SKIP  ${dbTicker} — not in database`);
      skipped++;
      continue;
    }

    if (stock.yahooTicker === yahooTicker) {
      console.log(`  OK    ${dbTicker} → ${yahooTicker} (already set)`);
      continue;
    }

    await prisma.stock.update({
      where: { ticker: dbTicker },
      data: { yahooTicker },
    });
    console.log(`  SET   ${dbTicker} → ${yahooTicker}`);
    updated++;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (not in DB)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
