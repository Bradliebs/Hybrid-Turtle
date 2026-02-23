/**
 * Backfill NULL currencies in the Stock table.
 * Logic:
 *   - .L suffix → GBP (London Stock Exchange)
 *   - .DE suffix → EUR (Germany)
 *   - .PA suffix → EUR (France)
 *   - .AS suffix → EUR (Netherlands)
 *   - .MI suffix → EUR (Italy)
 *   - .MC suffix → EUR (Spain)
 *   - .SW suffix → CHF (Switzerland)
 *   - .CO suffix → DKK (Denmark)
 *   - .ST suffix → SEK (Sweden)
 *   - .HE suffix → EUR (Finland)
 *   - .AX suffix → AUD (Australia)
 *   - No suffix / everything else → USD (US exchanges)
 *
 * Run: npx tsx scripts/backfill-currencies.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function inferCurrency(ticker: string): string {
  if (ticker.endsWith('.L')) return 'GBP';
  if (ticker.endsWith('.DE')) return 'EUR';
  if (ticker.endsWith('.PA')) return 'EUR';
  if (ticker.endsWith('.AS')) return 'EUR';
  if (ticker.endsWith('.MI')) return 'EUR';
  if (ticker.endsWith('.MC')) return 'EUR';
  if (ticker.endsWith('.SW')) return 'CHF';
  if (ticker.endsWith('.CO')) return 'DKK';
  if (ticker.endsWith('.ST')) return 'SEK';
  if (ticker.endsWith('.HE')) return 'EUR';
  if (ticker.endsWith('.AX')) return 'AUD';
  return 'USD'; // US exchanges — no suffix
}

async function main() {
  const nullCurrencyStocks = await prisma.stock.findMany({
    where: { currency: null },
    select: { id: true, ticker: true },
  });

  console.log(`Found ${nullCurrencyStocks.length} stocks with NULL currency`);

  let updated = 0;
  for (const stock of nullCurrencyStocks) {
    const currency = inferCurrency(stock.ticker);
    await prisma.stock.update({
      where: { id: stock.id },
      data: { currency },
    });
    console.log(`  ${stock.ticker} → ${currency}`);
    updated++;
  }

  console.log(`\nUpdated ${updated} stocks.`);

  // Verify — should be zero nulls remaining
  const remaining = await prisma.stock.count({ where: { currency: null } });
  console.log(`Remaining NULL currencies: ${remaining}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
