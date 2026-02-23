import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const nulls = await prisma.stock.findMany({
    where: { currency: null },
    select: { ticker: true, yahooTicker: true },
  });
  console.log('NULL currency count:', nulls.length);
  for (const s of nulls) {
    console.log(`${s.ticker}|${s.yahooTicker}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
