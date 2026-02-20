import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ── Path to Planning folder ──
// Check sibling folder first (dev layout), then local Planning/ (distribution zip)
const PLANNING_SIBLING = path.resolve(__dirname, '../../Planning');
const PLANNING_LOCAL = path.resolve(__dirname, '../Planning');
const PLANNING_DIR = fs.existsSync(PLANNING_SIBLING) ? PLANNING_SIBLING : PLANNING_LOCAL;

// ── Parse a .txt file into tickers (skip comments + blank lines) ──
function parseTxtTickers(filename: string): string[] {
  const filepath = path.join(PLANNING_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`  ⚠ File not found: ${filename}`);
    return [];
  }
  return fs
    .readFileSync(filepath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// ── Parse a CSV into a map (col0 → col1). Skips comments. ──
function parseCsvMap(filename: string): Record<string, string> {
  const filepath = path.join(PLANNING_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`  ⚠ File not found: ${filename}`);
    return {};
  }
  const map: Record<string, string> = {};
  fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .forEach((line) => {
      // skip header row if present
      if (line.toLowerCase().startsWith('ticker')) return;
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        map[parts[0]] = parts[1];
      }
    });
  return map;
}

// ── Parse region_map.csv → { ticker: { region, currency } } ──
function parseRegionMap(): Record<string, { region: string; currency: string }> {
  const filepath = path.join(PLANNING_DIR, 'region_map.csv');
  if (!fs.existsSync(filepath)) {
    console.warn('  ⚠ region_map.csv not found');
    return {};
  }
  const map: Record<string, { region: string; currency: string }> = {};
  fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .forEach((line) => {
      if (line.toLowerCase().startsWith('ticker')) return;
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length >= 3 && parts[0]) {
        map[parts[0]] = { region: parts[1], currency: parts[2] };
      }
    });
  return map;
}

// ── Build a reverse T212 ticker map: yahoo_ticker → t212_ticker ──
function parseTickerMap(): Record<string, string> {
  const filepath = path.join(PLANNING_DIR, 'ticker_map.csv');
  if (!fs.existsSync(filepath)) {
    console.warn('  ⚠ ticker_map.csv not found');
    return {};
  }
  // ticker_map.csv: ticker_t212, ticker_yf
  // We want: yahoo → t212
  const map: Record<string, string> = {};
  fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .forEach((line) => {
      if (line.toLowerCase().startsWith('ticker')) return;
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        // parts[0] = t212 ticker, parts[1] = yahoo ticker
        // Only store the first mapping (prefer the simpler T212 ticker)
        if (!map[parts[1]]) {
          map[parts[1]] = parts[0];
        }
      }
    });
  return map;
}

// ── Parse sector categories from stock_core_200.txt ──
function parseCoreWithSectors(): { ticker: string; sector: string }[] {
  const filepath = path.join(PLANNING_DIR, 'stock_core_200.txt');
  if (!fs.existsSync(filepath)) return [];
  const results: { ticker: string; sector: string }[] = [];
  let currentSector = 'UNKNOWN';

  fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Sector header like: # ========== MEGA CAP TECH ==========
      const sectorMatch = trimmed.match(/^#\s*=+\s*(.+?)\s*=+\s*$/);
      if (sectorMatch) {
        currentSector = sectorMatch[1].replace(/\(.*\)/, '').trim();
        return;
      }

      // Skip other comments
      if (trimmed.startsWith('#')) return;

      results.push({ ticker: trimmed, sector: currentSector });
    });

  return results;
}

// ── Friendly name for a ticker (we don't have a names file, so generate from ticker) ──
function tickerToName(ticker: string): string {
  // Remove exchange suffixes for display (.L, .SW, .DE, .PA, .MI, .MC)
  return ticker
    .replace(/\.(L|SW|DE|PA|MI|MC)$/i, '')
    .toUpperCase();
}

async function main() {
  console.log('🐢 HybridTurtle Stock Universe Seed');
  console.log('───────────────────────────────────');
  console.log(`  Planning folder: ${PLANNING_DIR}`);

  // 1. Parse all source files
  console.log('\n📂 Parsing source files...');

  const coreStocksWithSectors = parseCoreWithSectors();
  const coreTickers = coreStocksWithSectors.map((s) => s.ticker);
  console.log(`  ✓ stock_core_200.txt: ${coreTickers.length} tickers`);

  const etfTickers = parseTxtTickers('etf_core.txt');
  console.log(`  ✓ etf_core.txt: ${etfTickers.length} tickers`);

  const highRiskTickers = parseTxtTickers('stock_high_risk.txt');
  console.log(`  ✓ stock_high_risk.txt: ${highRiskTickers.length} tickers`);

  const hedgeTickers = parseTxtTickers('hedge.txt');
  console.log(`  ✓ hedge.txt: ${hedgeTickers.length} tickers`);

  const clusterMap = parseCsvMap('cluster_map.csv');
  console.log(`  ✓ cluster_map.csv: ${Object.keys(clusterMap).length} entries`);

  const superClusterMap = parseCsvMap('super_cluster_map_enhanced.csv');
  console.log(`  ✓ super_cluster_map_enhanced.csv: ${Object.keys(superClusterMap).length} entries`);

  const regionMap = parseRegionMap();
  console.log(`  ✓ region_map.csv: ${Object.keys(regionMap).length} entries`);

  const tickerMap = parseTickerMap();
  console.log(`  ✓ ticker_map.csv: ${Object.keys(tickerMap).length} entries`);

  // Build a sector map from core stocks parsing
  const sectorMap: Record<string, string> = {};
  coreStocksWithSectors.forEach(({ ticker, sector }) => {
    sectorMap[ticker] = sector;
  });

  // 2. Build unified stock list
  console.log('\n🔧 Building unified stock list...');

  interface StockEntry {
    ticker: string;
    name: string;
    sleeve: string;
    sector: string | null;
    cluster: string | null;
    superCluster: string | null;
    region: string | null;
    currency: string | null;
    t212Ticker: string | null;
  }

  const allStocks = new Map<string, StockEntry>();

  // Helper to resolve a ticker to its lookup keys for maps
  // The maps use Yahoo-style tickers (e.g., ULVR.L, SAP.DE)
  // but stock_core_200.txt uses short tickers (ULVR, SAP)
  // We need to try both
  function findInMap(map: Record<string, string>, ticker: string): string | null {
    if (map[ticker]) return map[ticker];
    // Try with common suffixes (UK, Swiss, German, French, Italian, Spanish, Dutch, Danish, Swedish, Finnish)
    const suffixes = ['.L', '.SW', '.DE', '.PA', '.MI', '.MC', '.AS', '.CO', '.ST', '.HE'];
    for (const suffix of suffixes) {
      if (map[ticker + suffix]) return map[ticker + suffix];
    }
    return null;
  }

  function findRegion(ticker: string): { region: string; currency: string } | null {
    if (regionMap[ticker]) return regionMap[ticker];
    // Try with common suffixes (UK, Swiss, German, French, Italian, Spanish, Dutch, Danish, Swedish, Finnish)
    const suffixes = ['.L', '.SW', '.DE', '.PA', '.MI', '.MC', '.AS', '.CO', '.ST', '.HE'];
    for (const suffix of suffixes) {
      if (regionMap[ticker + suffix]) return regionMap[ticker + suffix];
    }
    return null;
  }

  // Add CORE stocks
  for (const ticker of coreTickers) {
    const region = findRegion(ticker);
    allStocks.set(ticker, {
      ticker,
      name: tickerToName(ticker),
      sleeve: 'CORE',
      sector: sectorMap[ticker] || null,
      cluster: findInMap(clusterMap, ticker),
      superCluster: findInMap(superClusterMap, ticker),
      region: region?.region || null,
      currency: region?.currency || null,
      t212Ticker: findInMap(tickerMap, ticker),
    });
  }

  // Add ETFs
  for (const ticker of etfTickers) {
    if (allStocks.has(ticker)) continue;
    const region = findRegion(ticker);
    allStocks.set(ticker, {
      ticker,
      name: tickerToName(ticker),
      sleeve: 'ETF',
      sector: null,
      cluster: findInMap(clusterMap, ticker),
      superCluster: findInMap(superClusterMap, ticker),
      region: region?.region || 'ETF',
      currency: region?.currency || null,
      t212Ticker: findInMap(tickerMap, ticker),
    });
  }

  // Add HIGH_RISK stocks
  for (const ticker of highRiskTickers) {
    if (allStocks.has(ticker)) continue;
    const region = findRegion(ticker);
    allStocks.set(ticker, {
      ticker,
      name: tickerToName(ticker),
      sleeve: 'HIGH_RISK',
      sector: null,
      cluster: findInMap(clusterMap, ticker),
      superCluster: findInMap(superClusterMap, ticker),
      region: region?.region || null,
      currency: region?.currency || null,
      t212Ticker: findInMap(tickerMap, ticker),
    });
  }

  // Add HEDGE stocks
  for (const ticker of hedgeTickers) {
    if (allStocks.has(ticker)) continue;
    const region = findRegion(ticker);
    allStocks.set(ticker, {
      ticker,
      name: tickerToName(ticker),
      sleeve: 'HEDGE',
      sector: null,
      cluster: findInMap(clusterMap, ticker),
      superCluster: findInMap(superClusterMap, ticker),
      region: region?.region || null,
      currency: region?.currency || null,
      t212Ticker: findInMap(tickerMap, ticker),
    });
  }

  console.log(`  Total unique tickers: ${allStocks.size}`);

  // Count by sleeve
  let coreCount = 0, etfCount = 0, hrCount = 0, hedgeCount = 0;
  allStocks.forEach((s) => {
    if (s.sleeve === 'CORE') coreCount++;
    else if (s.sleeve === 'ETF') etfCount++;
    else if (s.sleeve === 'HIGH_RISK') hrCount++;
    else if (s.sleeve === 'HEDGE') hedgeCount++;
  });
  console.log(`  CORE: ${coreCount} | ETF: ${etfCount} | HIGH_RISK: ${hrCount} | HEDGE: ${hedgeCount}`);

  // 3. Upsert into database
  console.log('\n💾 Seeding database...');

  let created = 0;
  let updated = 0;

  for (const [, stock] of Array.from(allStocks.entries())) {
    const result = await prisma.stock.upsert({
      where: { ticker: stock.ticker },
      update: {
        name: stock.name,
        sleeve: stock.sleeve,
        sector: stock.sector,
        cluster: stock.cluster,
        superCluster: stock.superCluster,
        region: stock.region,
        currency: stock.currency,
        t212Ticker: stock.t212Ticker,
        active: true,
      },
      create: {
        ticker: stock.ticker,
        name: stock.name,
        sleeve: stock.sleeve,
        sector: stock.sector,
        cluster: stock.cluster,
        superCluster: stock.superCluster,
        region: stock.region,
        currency: stock.currency,
        t212Ticker: stock.t212Ticker,
        active: true,
      },
    });

    // Check if it was a create or update by checking createdAt vs updatedAt
    if (
      result.createdAt.getTime() === result.updatedAt.getTime() ||
      Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 1000
    ) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`  ✓ Created: ${created}`);
  console.log(`  ✓ Updated: ${updated}`);

  // 4. Ensure default user exists
  console.log('\n👤 Ensuring default user...');
  await prisma.user.upsert({
    where: { id: 'default-user' },
    update: {},
    create: {
      id: 'default-user',
      email: 'turtle@hybridturtle.local',
      name: 'Turtle Trader',
      password: '$2a$10$placeholder',
      riskProfile: 'BALANCED',
      equity: 10000,
    },
  });
  console.log('  ✓ Default user ready');

  // 5. Summary
  const total = await prisma.stock.count();
  const bySleeveRaw = await prisma.stock.groupBy({
    by: ['sleeve'],
    _count: true,
  });

  console.log(`\n✅ Seed complete! ${total} stocks in database`);
  bySleeveRaw.forEach((g) => {
    console.log(`   ${g.sleeve}: ${g._count}`);
  });
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
