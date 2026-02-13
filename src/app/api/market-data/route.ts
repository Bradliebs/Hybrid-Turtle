import { NextRequest, NextResponse } from 'next/server';
import {
  getStockQuote,
  getBatchQuotes,
  getMarketIndices,
  getFearGreedIndex,
  getMarketRegime,
  getBatchPrices,
  getDailyPrices,
} from '@/lib/market-data';

// GET /api/market-data?action=quote&ticker=AAPL
// GET /api/market-data?action=quotes&tickers=AAPL,MSFT,NVDA
// GET /api/market-data?action=indices
// GET /api/market-data?action=fear-greed
// GET /api/market-data?action=regime
// GET /api/market-data?action=prices&tickers=AAPL,MSFT
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'quote';
    const ticker = searchParams.get('ticker');
    const tickersParam = searchParams.get('tickers');

    switch (action) {
      case 'quote': {
        if (!ticker) {
          return NextResponse.json({ error: 'ticker parameter required' }, { status: 400 });
        }
        const quote = await getStockQuote(ticker);
        if (!quote) {
          return NextResponse.json({ error: `No data for ${ticker}` }, { status: 404 });
        }
        return NextResponse.json(quote);
      }

      case 'quotes': {
        if (!tickersParam) {
          return NextResponse.json({ error: 'tickers parameter required (comma-separated)' }, { status: 400 });
        }
        const tickers = tickersParam.split(',').map((t) => t.trim()).filter(Boolean);
        const quotes = await getBatchQuotes(tickers);
        // Convert Map to object for JSON
        const obj: Record<string, any> = {};
        quotes.forEach((v, k) => { obj[k] = v; });
        return NextResponse.json({ quotes: obj, count: quotes.size });
      }

      case 'prices': {
        if (!tickersParam) {
          return NextResponse.json({ error: 'tickers parameter required' }, { status: 400 });
        }
        const tickers = tickersParam.split(',').map((t) => t.trim()).filter(Boolean);
        const prices = await getBatchPrices(tickers);
        return NextResponse.json({ prices });
      }

      case 'indices': {
        const indices = await getMarketIndices();
        return NextResponse.json({ indices });
      }

      case 'fear-greed': {
        const fg = await getFearGreedIndex();
        return NextResponse.json(fg);
      }

      case 'regime': {
        const regime = await getMarketRegime();
        return NextResponse.json({ regime });
      }

      case 'historical': {
        if (!ticker) {
          return NextResponse.json({ error: 'ticker parameter required' }, { status: 400 });
        }
        const bars = await getDailyPrices(ticker, 'full');
        return NextResponse.json({ ticker, bars, count: bars.length });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Market data API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data', message: (error as Error).message },
      { status: 500 }
    );
  }
}
