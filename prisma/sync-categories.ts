import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ── Path to Planning folder ──
const PLANNING_DIR = path.resolve(__dirname, '../../Planning');

// ── Parse a CSV into a map (col0 → col1). Skips comments & header. ──
function parseCsvMap(filename: string): Record<string, string> {
  const filepath = path.join(PLANNING_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`  ⚠ File not found: ${filename}`);
    return {};
  }
  const map: Record<string, string> = {};
  fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map((l: string) => l.trim())
    .filter((l: string) => l && !l.startsWith('#'))
    .forEach((line: string) => {
      if (line.toLowerCase().startsWith('ticker')) return;
      const parts = line.split(',').map((s: string) => s.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        map[parts[0]] = parts[1];
      }
    });
  return map;
}

async function main() {
  console.log('');
  console.log('  ===========================================================');
  console.log('   Syncing cluster & super-cluster categories...');
  console.log('  ===========================================================');
  console.log('');

  // Load the CSV maps
  const clusterMap = parseCsvMap('cluster_map.csv');
  const superClusterEnhanced = parseCsvMap('super_cluster_map_enhanced.csv');
  const superClusterBasic = parseCsvMap('super_cluster_map.csv');

  // Merge: enhanced takes priority, fallback to basic
  const superClusterMap: Record<string, string> = { ...superClusterBasic, ...superClusterEnhanced };

  const clusterCount = Object.keys(clusterMap).length;
  const superClusterCount = Object.keys(superClusterMap).length;
  console.log(`  Loaded ${clusterCount} cluster mappings`);
  console.log(`  Loaded ${superClusterCount} merged super-cluster mappings (enhanced + basic)`);

  // Get all stocks from DB
  const stocks = await prisma.stock.findMany({
    select: { id: true, ticker: true, cluster: true, superCluster: true },
  });
  console.log(`  Found ${stocks.length} stocks in database`);
  console.log('');

  let clusterUpdates = 0;
  let superClusterUpdates = 0;
  let unmatchedTickers: string[] = [];

  for (const stock of stocks) {
    const newCluster = clusterMap[stock.ticker] || null;
    const newSuperCluster = superClusterMap[stock.ticker] || null;

    // Update if we have a mapping and it's different (or currently empty)
    const clusterChanged = newCluster && newCluster !== stock.cluster;
    const scChanged = newSuperCluster && newSuperCluster !== stock.superCluster;

    if (clusterChanged || scChanged) {
      const data: Record<string, string> = {};
      if (clusterChanged) {
        data.cluster = newCluster;
        clusterUpdates++;
      }
      if (scChanged) {
        data.superCluster = newSuperCluster;
        superClusterUpdates++;
      }

      await prisma.stock.update({
        where: { id: stock.id },
        data,
      });

      const changes = [];
      if (data.cluster) changes.push(`cluster: ${stock.cluster || '(none)'} → ${data.cluster}`);
      if (data.superCluster) changes.push(`superCluster: ${stock.superCluster || '(none)'} → ${data.superCluster}`);
      console.log(`  ✓ ${stock.ticker.padEnd(12)} ${changes.join(' | ')}`);
    }

    if (!newCluster && !newSuperCluster) {
      unmatchedTickers.push(stock.ticker);
    }
  }

  console.log('');
  console.log('  ===========================================================');
  console.log(`   Done! Updated ${clusterUpdates} clusters, ${superClusterUpdates} super-clusters`);
  console.log('  ===========================================================');

  if (unmatchedTickers.length > 0) {
    console.log('');
    console.log(`  ⚠ ${unmatchedTickers.length} tickers not found in any CSV:`);
    console.log(`    ${unmatchedTickers.join(', ')}`);
  }

  // Summary: show distinct super-clusters
  const result = await prisma.stock.groupBy({
    by: ['superCluster'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  console.log('');
  console.log('  Super-cluster distribution:');
  for (const row of result) {
    const sc = row.superCluster || '(uncategorized)';
    console.log(`    ${sc.padEnd(25)} ${row._count.id} stocks`);
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
