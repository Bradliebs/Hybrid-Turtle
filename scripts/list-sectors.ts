import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const sectors = await p.stock.groupBy({
    by: ['sector'],
    where: { active: true, sector: { not: null } },
    _count: true,
    orderBy: { _count: { sector: 'desc' } },
  });
  sectors.forEach((s) => console.log((s.sector || '(empty)').padEnd(30), s._count));
}

main().finally(() => p.$disconnect());
