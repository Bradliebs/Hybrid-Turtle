// ============================================================
// Market Data Service — Yahoo Finance (yahoo-finance2)
// ============================================================
//
// Replaces Alpha Vantage with yahoo-finance2 for:
// • Live stock quotes (no API key needed)
// • Historical OHLCV data for technical calculations
// • Market indices (SPY, QQQ, DIA, IWM)
// • Batch quotes for scan engine + portfolio
// ============================================================

import 'server-only';
import YahooFinance from 'yahoo-finance2';
import type { StockQuote, TechnicalData, MarketIndex, FearGreedData } from '@/types';

// yahoo-finance2 v3 requires instantiation
const yf = new (YahooFinance as unknown as new (opts: { suppressNotices: string[] }) => YahooFinanceInstance)({ suppressNotices: ['yahooSurvey'] });

/** Minimal shape returned by yf.quote() */
interface YahooQuoteResult {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  regularMarketPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketOpen?: number;
}

/** Minimal shape returned by yf.historical() */
interface YahooHistoricalBar {
  date: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose?: number;
  volume: number;
}

/** Shape of the yahoo-finance2 instance */
interface YahooFinanceInstance {
  quote(ticker: string): Promise<YahooQuoteResult | null>;
  historical(ticker: string, opts: { period1: string; period2: string; interval: string }): Promise<YahooHistoricalBar[]>;
}

// ── In-memory cache to avoid hammering Yahoo ──
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const quoteCache = new Map<string, CacheEntry<StockQuote>>();
const historicalCache = new Map<string, CacheEntry<DailyBar[]>>();
const QUOTE_TTL = 60_000;       // 1 minute
const HISTORICAL_TTL = 3600_000; // 1 hour
const FX_TTL = 300_000;         // 5 minutes

// ── FX rate cache ──
const fxCache = new Map<string, CacheEntry<number>>();

interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Ticker translation: T212 format → Yahoo Finance format ──
// Trading 212 uses e.g. "GSKl" for London, Yahoo Finance uses "GSK.L"
function toYahooTicker(ticker: string): string {
  // UK stocks: T212 appends lowercase 'l' for London exchange
  // Common UK tickers ending in 'l' that are NOT US stocks
  if (/^[A-Z]{2,5}l$/.test(ticker)) {
    return ticker.slice(0, -1) + '.L';
  }
  return ticker;
}

// ────────────────────────────────────────────────────
// Stock Quote — live price via yahoo-finance2
// ────────────────────────────────────────────────────
export async function getStockQuote(ticker: string): Promise<StockQuote | null> {
  // Check cache (use original ticker as key)
  const cached = quoteCache.get(ticker);
  if (cached && cached.expiry > Date.now()) return cached.data;

  const yahooTicker = toYahooTicker(ticker);

  try {
    const result = await yf.quote(yahooTicker);
    if (!result || !result.regularMarketPrice) return null;

    const quote: StockQuote = {
      ticker: result.symbol || ticker,
      name: result.shortName || result.longName || ticker,
      price: result.regularMarketPrice,
      change: result.regularMarketChange || 0,
      changePercent: result.regularMarketChangePercent || 0,
      volume: result.regularMarketVolume || 0,
      previousClose: result.regularMarketPreviousClose || 0,
      high: result.regularMarketDayHigh || result.regularMarketPrice,
      low: result.regularMarketDayLow || result.regularMarketPrice,
      open: result.regularMarketOpen || result.regularMarketPrice,
    };

    quoteCache.set(ticker, { data: quote, expiry: Date.now() + QUOTE_TTL });
    return quote;
  } catch (error) {
    console.error(`[YF] Quote failed for ${ticker}:`, (error as Error).message);
    return null;
  }
}

// ────────────────────────────────────────────────────
// Historical OHLCV — for technical indicator calcs
// ────────────────────────────────────────────────────
export async function getDailyPrices(
  ticker: string,
  outputSize: 'compact' | 'full' = 'compact'
): Promise<DailyBar[]> {
  const cacheKey = `${ticker}:${outputSize}`;
  const cached = historicalCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.data;

  try {
    // compact = ~100 days, full = ~400 days (need 200+ for MA200)
    const period1 = new Date();
    period1.setDate(period1.getDate() - (outputSize === 'full' ? 400 : 120));

    const yahooTicker = toYahooTicker(ticker);
    const result = await yf.historical(yahooTicker, {
      period1: period1.toISOString().split('T')[0],
      period2: new Date().toISOString().split('T')[0],
      interval: '1d',
    });

    if (!result || result.length === 0) return [];

    // Sort newest first (scan-engine expects this order)
    const bars: DailyBar[] = result
      .sort((a: YahooHistoricalBar, b: YahooHistoricalBar) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((bar: YahooHistoricalBar) => ({
        date: new Date(bar.date).toISOString().split('T')[0],
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.adjClose ?? bar.close,
        volume: bar.volume,
      }));

    historicalCache.set(cacheKey, { data: bars, expiry: Date.now() + HISTORICAL_TTL });
    return bars;
  } catch (error) {
    console.error(`[YF] Historical failed for ${ticker}:`, (error as Error).message);
    return [];
  }
}

// ---- Technical Indicators ----
export function calculateMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const slice = prices.slice(0, period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

export function calculateATR(
  data: { high: number; low: number; close: number }[],
  period: number = 14
): number {
  if (data.length < period + 1) return 0;

  const trs: number[] = [];
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(
      data[i - 1].high - data[i - 1].low,
      Math.abs(data[i - 1].high - data[i].close),
      Math.abs(data[i - 1].low - data[i].close)
    );
    trs.push(tr);
  }
  return trs.reduce((sum, tr) => sum + tr, 0) / period;
}

export function calculateADX(
  data: { high: number; low: number; close: number }[],
  period: number = 14
): { adx: number; plusDI: number; minusDI: number } {
  if (data.length < period * 2) return { adx: 20, plusDI: 25, minusDI: 20 };

  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trs: number[] = [];

  for (let i = 0; i < data.length - 1; i++) {
    const plusDM = data[i].high - data[i + 1].high;
    const minusDM = data[i + 1].low - data[i].low;

    plusDMs.push(plusDM > minusDM && plusDM > 0 ? plusDM : 0);
    minusDMs.push(minusDM > plusDM && minusDM > 0 ? minusDM : 0);

    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i + 1].close),
      Math.abs(data[i].low - data[i + 1].close)
    );
    trs.push(tr);
  }

  // Smoothed averages
  let smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);

  for (let i = period; i < plusDMs.length; i++) {
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];
    smoothTR = smoothTR - smoothTR / period + trs[i];
  }

  const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

  const diSum = plusDI + minusDI;
  const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

  return { adx: dx, plusDI, minusDI };
}

export function calculateTrendEfficiency(prices: number[], period: number = 20): number {
  if (prices.length < period) return 0;
  const netMove = Math.abs(prices[0] - prices[period - 1]);
  let totalPath = 0;
  for (let i = 0; i < period - 1; i++) {
    totalPath += Math.abs(prices[i] - prices[i + 1]);
  }
  return totalPath > 0 ? (netMove / totalPath) * 100 : 0;
}

export function calculate20DayHigh(data: { high: number }[]): number {
  const highs = data.slice(0, 20).map((d) => d.high);
  return Math.max(...highs);
}

// ---- Full Technical Data ----
export async function getTechnicalData(ticker: string): Promise<TechnicalData | null> {
  const dailyData = await getDailyPrices(ticker, 'full');
  if (dailyData.length < 200) {
    console.warn(`[YF] Insufficient data for ${ticker}: ${dailyData.length} bars (need 200+)`);
    return null;
  }

  const closes = dailyData.map((d) => d.close);
  const ma200 = calculateMA(closes, 200);
  const atr = calculateATR(dailyData, 14);
  const atr20DayAgo = dailyData.length >= 34
    ? calculateATR(dailyData.slice(20), 14)
    : 0;
  const atrSpiking = atr20DayAgo > 0 ? atr >= atr20DayAgo * 1.3 : false;
  const atrPercent = closes[0] > 0 ? (atr / closes[0]) * 100 : 0;
  const { adx, plusDI, minusDI } = calculateADX(dailyData, 14);
  const efficiency = calculateTrendEfficiency(closes, 20);
  const twentyDayHigh = calculate20DayHigh(dailyData);

  // Relative strength vs SPY
  let relativeStrength = 50;
  try {
    const spyData = await getDailyPrices('SPY', 'compact');
    if (spyData.length >= 20 && closes.length >= 20) {
      const stockReturn = (closes[0] - closes[19]) / closes[19];
      const spyReturn = (spyData[0].close - spyData[19].close) / spyData[19].close;
      relativeStrength = spyReturn !== 0
        ? Math.min(100, Math.max(0, 50 + ((stockReturn - spyReturn) / Math.abs(spyReturn)) * 25))
        : 50;
    }
  } catch {
    // SPY fetch failed; use default
  }

  const volumeRatio = dailyData[0]?.volume && dailyData.length > 20
    ? dailyData[0].volume / (dailyData.slice(0, 20).reduce((s, d) => s + d.volume, 0) / 20)
    : 1;

  return {
    ma200,
    adx,
    plusDI,
    minusDI,
    atr,
    atr20DayAgo,
    atrSpiking,
    atrPercent,
    twentyDayHigh,
    efficiency,
    relativeStrength,
    volumeRatio,
  };
}

// ── Market Indices — live from Yahoo Finance ──
const INDEX_MAP: { name: string; ticker: string }[] = [
  { name: 'S&P 500', ticker: '^GSPC' },
  { name: 'NASDAQ 100', ticker: '^NDX' },
  { name: 'DOW 30', ticker: '^DJI' },
  { name: 'Russell 2000', ticker: '^RUT' },
  { name: 'FTSE 100', ticker: '^FTSE' },
  { name: 'VIX', ticker: '^VIX' },
];

export async function getMarketIndices(): Promise<MarketIndex[]> {
  const results: MarketIndex[] = [];

  for (const idx of INDEX_MAP) {
    try {
      const q = await yf.quote(idx.ticker);
      if (q && q.regularMarketPrice) {
        results.push({
          name: idx.name,
          ticker: idx.ticker,
          value: q.regularMarketPrice,
          change: q.regularMarketChange || 0,
          changePercent: q.regularMarketChangePercent || 0,
        });
      }
    } catch (error) {
      console.warn(`[YF] Index ${idx.ticker} failed:`, (error as Error).message);
      results.push({ name: idx.name, ticker: idx.ticker, value: 0, change: 0, changePercent: 0 });
    }
  }

  return results;
}

// ── Fear & Greed — approximation from VIX ──
export async function getFearGreedIndex(): Promise<FearGreedData> {
  try {
    const vix = await yf.quote('^VIX');
    const vixPrice = vix?.regularMarketPrice || 20;

    let value: number;
    if (vixPrice < 12) value = 90;
    else if (vixPrice < 16) value = 75;
    else if (vixPrice < 20) value = 60;
    else if (vixPrice < 25) value = 40;
    else if (vixPrice < 30) value = 25;
    else value = 10;

    const label =
      value >= 75 ? 'Extreme Greed' :
      value >= 55 ? 'Greed' :
      value >= 45 ? 'Neutral' :
      value >= 25 ? 'Fear' :
      'Extreme Fear';

    return { value, label, previousClose: value, oneWeekAgo: value, oneMonthAgo: value };
  } catch {
    return { value: 50, label: 'Neutral', previousClose: 50, oneWeekAgo: 50, oneMonthAgo: 50 };
  }
}

// ── Batch Quotes — efficient multi-ticker fetch ──
// ── FX Rate fetch (e.g. USDGBP=X) ──
export async function getFXRate(fromCurrency: string, toCurrency: string): Promise<number> {
  if (fromCurrency === toCurrency) return 1;
  const pair = `${fromCurrency}${toCurrency}`;
  const cacheKey = pair;
  const cached = fxCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.data;

  try {
    const result = await yf.quote(`${pair}=X`);
    const rate = result?.regularMarketPrice;
    if (rate && rate > 0) {
      fxCache.set(cacheKey, { data: rate, expiry: Date.now() + FX_TTL });
      return rate;
    }
  } catch (error) {
    console.warn(`[YF] FX rate failed for ${pair}:`, (error as Error).message);
  }

  // Hardcoded fallbacks (approximate)
  const fallbacks: Record<string, number> = {
    USDGBP: 0.79,
    GBPUSD: 1.27,
    EURGBP: 0.86,
    GBPEUR: 1.16,
    CHFGBP: 0.89,
    DKKGBP: 0.115,
  };
  return fallbacks[pair] ?? 1;
}

// ── UK Ticker Detection ──
// Matches both Yahoo Finance format (GSK.L) and Trading 212 format (GSKl)
function isUKTicker(ticker: string): boolean {
  return ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(ticker);
}

// ── Price Normalization ──
// Yahoo Finance returns UK stocks (.L) in pence (GBX), not pounds (GBP).
// Trading 212 also stores UK prices in GBX.
// This function converts a price to GBP for portfolio value calculations.
export async function normalizePriceToGBP(
  price: number,
  ticker: string,
  stockCurrency?: string | null
): Promise<number> {
  // UK stocks: .L suffix or T212 lowercase 'l' suffix — price is in GBX (pence)
  if (isUKTicker(ticker)) {
    return price / 100;
  }

  // Determine source currency
  const currency = stockCurrency?.toUpperCase() || 'USD';

  if (currency === 'GBP') return price;
  if (currency === 'GBX' || currency === 'GBp') return price / 100;

  // Convert foreign currency to GBP
  const rate = await getFXRate(currency, 'GBP');
  return price * rate;
}

// ── Batch normalize prices to GBP for portfolio calculations ──
export async function normalizeBatchPricesToGBP(
  prices: Record<string, number>,
  stockCurrencies: Record<string, string | null>
): Promise<Record<string, number>> {
  // Group by unique currency for efficient FX fetching
  const fxRates = new Map<string, number>();
  const currenciesNeeded = new Set<string>();

  for (const [ticker] of Object.entries(prices)) {
    if (isUKTicker(ticker)) continue; // handled by /100
    const currency = stockCurrencies[ticker]?.toUpperCase() || 'USD';
    if (currency !== 'GBP' && currency !== 'GBX' && currency !== 'GBp') {
      currenciesNeeded.add(currency);
    }
  }

  // Fetch all needed FX rates
  for (const curr of Array.from(currenciesNeeded)) {
    fxRates.set(curr, await getFXRate(curr, 'GBP'));
  }

  const normalized: Record<string, number> = {};
  for (const [ticker, price] of Object.entries(prices)) {
    if (isUKTicker(ticker)) {
      normalized[ticker] = price / 100;
    } else {
      const currency = stockCurrencies[ticker]?.toUpperCase() || 'USD';
      if (currency === 'GBP') {
        normalized[ticker] = price;
      } else if (currency === 'GBX' || currency === 'GBp') {
        normalized[ticker] = price / 100;
      } else {
        normalized[ticker] = price * (fxRates.get(currency) ?? 1);
      }
    }
  }

  return normalized;
}

export async function getBatchQuotes(tickers: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();
  if (tickers.length === 0) return results;

  // Process in batches of 20 to avoid overwhelming Yahoo
  const batchSize = 20;
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const promises = batch.map(async (ticker) => {
      const quote = await getStockQuote(ticker);
      if (quote) results.set(ticker, quote);
    });
    await Promise.all(promises);
    if (i + batchSize < tickers.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}

// ── Market Regime from SPY vs 200 MA ──
export async function getMarketRegime(): Promise<'BULLISH' | 'SIDEWAYS' | 'BEARISH'> {
  try {
    const spyData = await getDailyPrices('SPY', 'full');
    if (spyData.length < 200) return 'BULLISH';

    const spyPrice = spyData[0].close;
    const closes = spyData.map((d) => d.close);
    const spyMa200 = calculateMA(closes, 200);
    const spyMa50 = calculateMA(closes, 50);

    if (spyPrice > spyMa200 && spyMa50 > spyMa200) return 'BULLISH';
    if (spyPrice < spyMa200 && spyMa50 < spyMa200) return 'BEARISH';
    return 'SIDEWAYS';
  } catch {
    return 'BULLISH';
  }
}

// ── Quick single-price fetch ──
export async function getQuickPrice(ticker: string): Promise<number | null> {
  const quote = await getStockQuote(ticker);
  return quote?.price || null;
}

// ── Batch prices — just numbers ──
export async function getBatchPrices(tickers: string[]): Promise<Record<string, number>> {
  const quotes = await getBatchQuotes(tickers);
  const prices: Record<string, number> = {};
  quotes.forEach((quote, ticker) => {
    prices[ticker] = quote.price;
  });
  return prices;
}
