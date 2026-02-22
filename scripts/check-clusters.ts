import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const total = await p.stock.count({ where: { active: true } });
  
  const noCluster = await p.stock.findMany({
    where: { active: true, OR: [{ cluster: null }, { cluster: '' }] },
    select: { ticker: true, name: true, sector: true, sleeve: true },
    orderBy: { sleeve: 'asc' },
  });

  const noSector = await p.stock.findMany({
    where: { active: true, OR: [{ sector: null }, { sector: '' }] },
    select: { ticker: true, name: true, sleeve: true },
    orderBy: { sleeve: 'asc' },
  });

  console.log(`Total active tickers: ${total}`);
  console.log(`\nMissing cluster (${noCluster.length}):`);
  noCluster.forEach((t) =>
    console.log(`  ${t.ticker.padEnd(12)} ${(t.sleeve || '').padEnd(12)} sector: ${t.sector || 'NONE'}  ${t.name}`)
  );
  console.log(`\nMissing sector (${noSector.length}):`);
  noSector.forEach((t) =>
    console.log(`  ${t.ticker.padEnd(12)} ${(t.sleeve || '').padEnd(12)} ${t.name}`)
  );
}

main().finally(() => p.$disconnect());
