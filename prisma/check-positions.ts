import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const positions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    include: { stock: true },
  });

  console.log('Open positions in DB:');
  for (const p of positions) {
    console.log(`  ${p.stock.ticker} | entry: ${p.entryPrice} | stop: ${p.currentStop} | risk: ${p.initialRisk} | level: ${p.protectionLevel}`);
  }

  // Also check all stocks to see ticker naming
  const stocks = await prisma.stock.findMany({
    where: {
      ticker: {
        in: ['BATS.L', 'BATSl', 'BATS', 'GSK', 'GSK.L', 'GSKl', 'DVN'],
      },
    },
  });
  console.log('\nRelevant stocks in DB:');
  for (const s of stocks) {
    console.log(`  ${s.ticker} (${s.name}) — sleeve: ${s.sleeve}`);
  }
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
