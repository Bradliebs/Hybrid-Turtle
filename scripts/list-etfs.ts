import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const etfs = await p.stock.findMany({
    where: { active: true, sleeve: 'ETF' },
    select: { ticker: true, name: true, sector: true },
    orderBy: { ticker: 'asc' },
  });
  console.log(`Total ETFs: ${etfs.length}\n`);
  etfs.forEach((e) =>
    console.log(`${e.ticker.padEnd(12)} ${(e.sector || '(none)').padEnd(20)} ${e.name}`)
  );
}

main().finally(() => p.$disconnect());
