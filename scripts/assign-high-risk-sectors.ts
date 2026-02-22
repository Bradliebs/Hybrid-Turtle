/**
 * Assign sectors to HIGH_RISK tickers that are currently missing them.
 * Uses existing sector names from the database where possible.
 * Run: npx tsx scripts/assign-high-risk-sectors.ts
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

// Mapping: ticker → sector (using existing sector names where they exist)
const SECTOR_MAP: Record<string, string> = {
  // ── Crypto / Bitcoin Mining ──
  MSTR:  'SPECULATIVE',
  RIOT:  'SPECULATIVE',
  CLSK:  'SPECULATIVE',
  IREN:  'SPECULATIVE',

  // ── Space / Aerospace ──
  RKLB:  'DEFENSE/AEROSPACE',
  ASTS:  'DEFENSE/AEROSPACE',
  LUNR:  'DEFENSE/AEROSPACE',
  RDW:   'DEFENSE/AEROSPACE',

  // ── Air Mobility / eVTOL ──
  JOBY:  'DEFENSE/AEROSPACE',
  ACHR:  'DEFENSE/AEROSPACE',

  // ── Nuclear / Uranium ──
  OKLO:  'ENERGY',
  UUUU:  'ENERGY',
  UEC:   'ENERGY',
  DNN:   'ENERGY',

  // ── Quantum Computing ──
  QBTS:  'TECH GROWTH',
  IONQ:  'TECH GROWTH',
  RGTI:  'TECH GROWTH',
  QUBT:  'TECH GROWTH',

  // ── Clean Energy / EV ──
  RUN:   'BATCH 2 — ENERGY TRANSITION / CLEAN',
  PLUG:  'BATCH 2 — ENERGY TRANSITION / CLEAN',
  CHPT:  'BATCH 2 — ENERGY TRANSITION / CLEAN',
  BLNK:  'BATCH 2 — ENERGY TRANSITION / CLEAN',
  LCID:  'BATCH 2 — ENERGY TRANSITION / CLEAN',
  WOLF:  'BATCH 2 — ENERGY TRANSITION / CLEAN',

  // ── Biotech / Genomics ──
  RXRX:  'PHARMA / BIOTECH',
  CRSP:  'PHARMA / BIOTECH',
  BEAM:  'PHARMA / BIOTECH',
  NVAX:  'PHARMA / BIOTECH',
  EDIT:  'PHARMA / BIOTECH',

  // ── MedTech ──
  TMDX:  'BATCH 2 — HEALTHCARE / MEDTECH',

  // ── AI / Software ──
  SOUN:  'TECH GROWTH',
  BBAI:  'TECH GROWTH',
  UPST:  'FINTECH',
  NBIS:  'TECH GROWTH',

  // ── Semiconductors ──
  SMTC:  'SEMICONDUCTORS',
  APLD:  'SEMICONDUCTORS',

  // ── Real Estate Tech ──
  OPEN:  'REITS & INFRASTRUCTURE',

  // ── Mining ──
  HYMC:  'MATERIALS',

  // ── Other ──
  CRWV:  'TECH GROWTH',
  RZLV:  'TECH GROWTH',
  PTON:  'CONSUMER DISCRETIONARY',
};

async function main() {
  const tickers = Object.keys(SECTOR_MAP);
  console.log(`Updating ${tickers.length} HIGH_RISK tickers with sector assignments...\n`);

  let updated = 0;
  let skipped = 0;

  for (const ticker of tickers) {
    const sector = SECTOR_MAP[ticker];
    const stock = await p.stock.findFirst({
      where: { ticker, active: true },
      select: { id: true, ticker: true, sector: true },
    });

    if (!stock) {
      console.log(`  SKIP  ${ticker.padEnd(8)} — not found or inactive`);
      skipped++;
      continue;
    }

    if (stock.sector && stock.sector.length > 0) {
      console.log(`  SKIP  ${ticker.padEnd(8)} — already has sector: ${stock.sector}`);
      skipped++;
      continue;
    }

    await p.stock.update({
      where: { id: stock.id },
      data: { sector },
    });
    console.log(`  SET   ${ticker.padEnd(8)} → ${sector}`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);

  // Verify: any remaining missing?
  const remaining = await p.stock.count({
    where: { active: true, sleeve: 'HIGH_RISK', OR: [{ sector: null }, { sector: '' }] },
  });
  console.log(`Remaining HIGH_RISK without sector: ${remaining}`);
}

main().finally(() => p.$disconnect());
