import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET /api/stocks — List all stocks. Optional filters: ?sleeve=CORE&active=true&search=AAPL
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sleeve = searchParams.get('sleeve');
    const active = searchParams.get('active');
    const search = searchParams.get('search');
    const cluster = searchParams.get('cluster');
    const superCluster = searchParams.get('superCluster');
    const region = searchParams.get('region');

    const where: Record<string, unknown> = {};

    if (sleeve) where.sleeve = sleeve;
    if (active !== null && active !== undefined && active !== '') {
      where.active = active === 'true';
    }
    if (cluster) where.cluster = cluster;
    if (superCluster) where.superCluster = superCluster;
    if (region) where.region = region;
    if (search) {
      where.OR = [
        { ticker: { contains: search } },
        { name: { contains: search } },
        { sector: { contains: search } },
      ];
    }

    const stocks = await prisma.stock.findMany({
      where,
      orderBy: [{ sleeve: 'asc' }, { sector: 'asc' }, { ticker: 'asc' }],
    });

    // Build summary stats
    const summary = {
      total: stocks.length,
      core: stocks.filter((s) => s.sleeve === 'CORE').length,
      etf: stocks.filter((s) => s.sleeve === 'ETF').length,
      highRisk: stocks.filter((s) => s.sleeve === 'HIGH_RISK').length,
      hedge: stocks.filter((s) => s.sleeve === 'HEDGE').length,
    };

    return NextResponse.json({ stocks, summary });
  } catch (error) {
    console.error('GET /api/stocks error:', error);
    return NextResponse.json({ error: 'Failed to fetch stocks' }, { status: 500 });
  }
}

// POST /api/stocks — Add a new stock or bulk-add
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Bulk add: { stocks: [...] }
    if (Array.isArray(body.stocks)) {
      const results = [];
      for (const stock of body.stocks) {
        const result = await prisma.stock.upsert({
          where: { ticker: stock.ticker },
          update: {
            name: stock.name || stock.ticker,
            sleeve: stock.sleeve || 'CORE',
            sector: stock.sector || null,
            cluster: stock.cluster || null,
            superCluster: stock.superCluster || null,
            region: stock.region || null,
            currency: stock.currency || null,
            t212Ticker: stock.t212Ticker || null,
            active: stock.active !== undefined ? stock.active : true,
          },
          create: {
            ticker: stock.ticker,
            name: stock.name || stock.ticker,
            sleeve: stock.sleeve || 'CORE',
            sector: stock.sector || null,
            cluster: stock.cluster || null,
            superCluster: stock.superCluster || null,
            region: stock.region || null,
            currency: stock.currency || null,
            t212Ticker: stock.t212Ticker || null,
            active: stock.active !== undefined ? stock.active : true,
          },
        });
        results.push(result);
      }
      return NextResponse.json({
        message: `Upserted ${results.length} stocks`,
        count: results.length,
      });
    }

    // Single add
    if (!body.ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }

    const stock = await prisma.stock.upsert({
      where: { ticker: body.ticker },
      update: {
        name: body.name || body.ticker,
        sleeve: body.sleeve || 'CORE',
        sector: body.sector || null,
        cluster: body.cluster || null,
        superCluster: body.superCluster || null,
        region: body.region || null,
        currency: body.currency || null,
        t212Ticker: body.t212Ticker || null,
        active: body.active !== undefined ? body.active : true,
      },
      create: {
        ticker: body.ticker,
        name: body.name || body.ticker,
        sleeve: body.sleeve || 'CORE',
        sector: body.sector || null,
        cluster: body.cluster || null,
        superCluster: body.superCluster || null,
        region: body.region || null,
        currency: body.currency || null,
        t212Ticker: body.t212Ticker || null,
        active: body.active !== undefined ? body.active : true,
      },
    });

    return NextResponse.json({ stock });
  } catch (error) {
    console.error('POST /api/stocks error:', error);
    return NextResponse.json({ error: 'Failed to add stock' }, { status: 500 });
  }
}

// DELETE /api/stocks?ticker=AAPL — Remove a stock (soft-delete by setting active=false)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const hard = searchParams.get('hard') === 'true';

    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }

    if (hard) {
      // Check for positions first
      const positionCount = await prisma.position.count({
        where: { stock: { ticker } },
      });
      if (positionCount > 0) {
        return NextResponse.json(
          { error: `Cannot delete ${ticker} — has ${positionCount} positions. Use soft delete.` },
          { status: 409 }
        );
      }
      await prisma.stock.delete({ where: { ticker } });
    } else {
      await prisma.stock.update({
        where: { ticker },
        data: { active: false },
      });
    }

    return NextResponse.json({ message: `${ticker} ${hard ? 'deleted' : 'deactivated'}` });
  } catch (error) {
    console.error('DELETE /api/stocks error:', error);
    return NextResponse.json({ error: 'Failed to delete stock' }, { status: 500 });
  }
}
