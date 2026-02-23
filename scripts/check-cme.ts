import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // 1. Check stock config
  const stock = await p.stock.findFirst({ where: { ticker: 'CME' } });
  console.log('=== Stock Config ===');
  console.log(JSON.stringify(stock, null, 2));

  // 2. Check latest snapshot data
  const snap = await p.snapshotTicker.findFirst({
    where: { ticker: 'CME' },
    orderBy: { createdAt: 'desc' },
  });
  console.log('\n=== Latest Snapshot ===');
  console.log(JSON.stringify(snap, null, 2));

  // 3. Check latest scan result
  const scanResult = await p.scanResult.findFirst({
    where: { stock: { ticker: 'CME' } },
    orderBy: { scan: { runDate: 'desc' } },
    include: { stock: { select: { ticker: true, yahooTicker: true, currency: true } } },
  });
  console.log('\n=== Latest Scan Result ===');
  console.log(JSON.stringify(scanResult, null, 2));

  await p.$disconnect();
}

main().catch(console.error);
