// ============================================================
// Market Data Service — Multi-Provider (Yahoo / EODHD)
// ============================================================
//
// DEPENDENCIES
// Consumed by: scan-engine.ts, nightly.ts, regime-detector.ts,
//              /api/scan/route.ts, /api/market-data/route.ts
// Consumes: yahoo-finance2, market-data-eodhd.ts, types/index.ts
// Risk-sensitive: YES — prices feed position sizing + stop logic
// Last modified: 2026-02-20
//
// Provider routing:
//   Default: Yahoo Finance (no API key needed)
//   Optional: EODHD (requires EODHD_API_KEY env var)
//   Set MARKET_DATA_PROVIDER=eodhd in .env to switch
// ============================================================

import 'server-only';
import YahooFinance from 'yahoo-finance2';
import { z } from 'zod';
import type { StockQuote, TechnicalData, MarketIndex, FearGreedData } from '@/types';
import * as eodhd from './market-data-eodhd';

// ── Zod schemas for Yahoo Finance runtime validation ──
const YahooQuoteSchema = z.object({
  symbol: z.string().optional(),
  shortName: z.string().optional(),
  longName: z.string().optional(),
  regularMarketPrice: z.number(),
  regularMarketChange: z.number().optional(),
  regularMarketChangePercent: z.number().optional(),
  regularMarketVolume: z.number().optional(),
  regularMarketPreviousClose: z.number().optional(),
  regularMarketDayHigh: z.number().optional(),
  regularMarketDayLow: z.number().optional(),
  regularMarketOpen: z.number().optional(),
}).passthrough();

const YahooChartBarSchema = z.object({
  date: z.union([z.string(), z.date()]),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  adjclose: z.number().finite().optional(),
  volume: z.number(),
});

const YahooChartResponseSchema = z.object({
  quotes: z.array(YahooChartBarSchema),
}).passthrough();

// ── Provider routing ──
// Checks MARKET_DATA_PROVIDER env var. Default is 'yahoo'.
export type MarketDataProviderType = 'yahoo' | 'eodhd';

export function getActiveProvider(): MarketDataProviderType {
  const provider = (process.env.MARKET_DATA_PROVIDER || 'yahoo').toLowerCase();
  if (provider === 'eodhd') return 'eodhd';
  return 'yahoo';
}

function isEodhd(): boolean {
  return getActiveProvider() === 'eodhd';
}

// yahoo-finance2 v3 requires instantiation
const yf = new (YahooFinance as unknown as new (opts: { suppressNotices: string[] }) => YahooFinanceInstance)({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

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

/** Minimal shape returned by yf.chart() quotes */
interface YahooChartBar {
  date: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjclose?: number;
  volume: number;
}

/** Shape of the yahoo-finance2 instance */
interface YahooFinanceInstance {
  quote(ticker: string): Promise<YahooQuoteResult | null>;
  quote(tickers: string[]): Promise<YahooQuoteResult[]>;
  chart(ticker: string, opts: { period1: string; period2: string; interval: string }): Promise<{ quotes: YahooChartBar[] }>;
}

// ── In-memory cache to avoid hammering Yahoo ──
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const quoteCache = new Map<string, CacheEntry<StockQuote>>();
const historicalCache = new Map<string, CacheEntry<DailyBar[]>>();
const QUOTE_TTL = 30 * 60_000;     // 30 minutes — prices fetched once per session, manual refresh available
const HISTORICAL_TTL = 86_400_000; // 24 hours (daily bars don't change intraday)
const FX_TTL = 30 * 60_000;        // 30 minutes — FX rates move slowly

// ── Rate-limited chart queue ──
// Serialises yf.chart() calls with a configurable delay to avoid rate-limiting.
const CHART_DELAY_MS = 150; // ms between consecutive live chart API calls
let chartQueueTail: Promise<void> = Promise.resolve();

function enqueueChartCall<T>(fn: () => Promise<T>): Promise<T> {
  const result = chartQueueTail.then(() => fn());
  // Chain a delay after this call so the next one waits
  chartQueueTail = result.then(
    () => new Promise(resolve => setTimeout(resolve, CHART_DELAY_MS)),
    () => new Promise(resolve => setTimeout(resolve, CHART_DELAY_MS))
  );
  return result;
}

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

// ── Ticker translation: DB/T212 format → Yahoo Finance format ──
// Trading 212 uses e.g. "GSKl" for London, Yahoo Finance uses "GSK.L"
// Non-US tickers without exchange suffixes need explicit mapping.
const YAHOO_TICKER_MAP: Record<string, string> = {
  // UK / LSE (GBP / GBX) — stored without .L suffix
  AIAI: 'AIAI.L',
  AZN: 'AZN.L',
  BTEE: 'BTEE.L',
  CNDX: 'CNDX.L',
  DGE: 'DGE.L',
  EIMI: 'EIMI.L',
  GSK: 'GSK.L',
  HSBA: 'HSBA.L',
  INRG: 'INRG.L',
  IWMO: 'IWMO.L',
  NG: 'NG.L',
  RBOT: 'RBOT.L',
  REL: 'REL.L',
  RIO: 'RIO.L',
  SGLN: 'SGLN.L',
  SHEL: 'SHEL.L',
  SSE: 'SSE.L',
  SSLN: 'SSLN.L',
  ULVR: 'ULVR.L',
  VUSA: 'VUSA.L',
  WSML: 'WSML.L',
  // Germany / XETRA (EUR)
  ALV: 'ALV.DE',
  SAP: 'SAP.DE',
  SIE: 'SIE.DE',
  // Netherlands / Euronext Amsterdam (EUR)
  ASML: 'ASML.AS',
  MT: 'MT.AS',
  // France / Euronext Paris (EUR)
  MC: 'MC.PA',
  OR: 'OR.PA',
  SU: 'SU.PA',
  TTE: 'TTE.PA',
  // Switzerland / SIX (CHF)
  NOVN: 'NOVN.SW',
  ROG: 'ROG.SW',
  // Denmark / Copenhagen (DKK)
  NVO: 'NOVO-B.CO',
  // Germany / XETRA additions (Feb 2026)
  DBK: 'DBK.DE',
  IFX: 'IFX.DE',
  HLAG: 'HLAG.DE',
  // Italy / Milan additions (Feb 2026)
  UCG: 'UCG.MI',
};

/**
 * Convert a database/T212 ticker to its Yahoo Finance symbol.
 * Priority: explicit yahooTicker override → static map → T212 'l' suffix rule → passthrough.
 */
export function toYahooTicker(ticker: string, yahooTickerOverride?: string | null): string {
  if (yahooTickerOverride) return yahooTickerOverride;
  if (YAHOO_TICKER_MAP[ticker]) return YAHOO_TICKER_MAP[ticker];
  // UK stocks: T212 appends lowercase 'l' for London exchange
  if (/^[A-Z]{2,5}l$/.test(ticker)) {
    return ticker.slice(0, -1) + '.L';
  }
  return ticker;
}

// ────────────────────────────────────────────────────
// Stock Quote — live price via active provider
// ────────────────────────────────────────────────────
export async function getStockQuote(ticker: string): Promise<StockQuote | null> {
  // Route to EODHD if configured
  if (isEodhd()) return eodhd.getStockQuote(ticker);

  // Check cache (use original ticker as key)
  const cached = quoteCache.get(ticker);
  if (cached && cached.expiry > Date.now()) return cached.data;

  const yahooTicker = toYahooTicker(ticker);

  try {
    const raw = await yf.quote(yahooTicker);
    if (!raw) return null;

    // Runtime validation — rejects malformed Yahoo responses
    const parsed = YahooQuoteSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[YF] Quote validation failed for ${ticker}:`, parsed.error.issues.map(i => i.message).join(', '));
      return null;
    }
    const result = parsed.data;

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
  // Route to EODHD if configured
  if (isEodhd()) return eodhd.getDailyPrices(ticker, outputSize);

  const cacheKey = `${ticker}:${outputSize}`;
  const cached = historicalCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.data;

  try {
    // compact = ~100 days, full = ~400 days (need 200+ for MA200)
    const period1 = new Date();
    period1.setDate(period1.getDate() - (outputSize === 'full' ? 400 : 120));

    // Yahoo chart API treats period2 as EXCLUSIVE — setting it to today
    // excludes today's bar (returns only up to yesterday's close).
    // Adding +1 day ensures we always get the latest available daily bar.
    const period2 = new Date();
    period2.setDate(period2.getDate() + 1);

    const yahooTicker = toYahooTicker(ticker);
    // Route through the rate-limited queue to prevent bursts
    const { quotes } = await enqueueChartCall(() =>
      yf.chart(yahooTicker, {
        period1: period1.toISOString().split('T')[0],
        period2: period2.toISOString().split('T')[0],
        interval: '1d',
      })
    );

    if (!quotes || quotes.length === 0) return [];

    // Runtime validation — rejects malformed chart responses
    const chartParsed = YahooChartResponseSchema.safeParse({ quotes });
    if (!chartParsed.success) {
      console.warn(`[YF] Chart validation failed for ${ticker}:`, chartParsed.error.issues.map(i => i.message).join(', '));
      return [];
    }
    const validBars = chartParsed.data.quotes;

    // Sort newest first (scan-engine expects this order)
    const bars: DailyBar[] = validBars
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((bar) => ({
        date: new Date(bar.date).toISOString().split('T')[0],
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.adjclose ?? bar.close,
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

export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const multiplier = 2 / (period + 1);
  // Data is sorted newest-first. Seed EMA with SMA of the OLDEST `period` bars.
  const seedSlice = prices.slice(prices.length - period);
  let ema = seedSlice.reduce((sum, p) => sum + p, 0) / period;
  // Walk forward in time (from oldest to newest)
  for (let i = prices.length - period - 1; i >= 0; i--) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  return ema;
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
  // Need at least 2×period bars to seed DM smoothing + ADX smoothing
  // Insufficient data — return zeros so callers reject the ticker (adx < 20 filter)
  if (data.length < period * 2 + 1) return { adx: 0, plusDI: 0, minusDI: 0 };

  // Data is sorted newest-first — compute DM/TR walking from oldest to newest
  const len = data.length;
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trs: number[] = [];

  // Build arrays in chronological order (oldest first)
  for (let i = len - 1; i > 0; i--) {
    const plusDM = data[i - 1].high - data[i].high;
    const minusDM = data[i].low - data[i - 1].low;

    plusDMs.push(plusDM > minusDM && plusDM > 0 ? plusDM : 0);
    minusDMs.push(minusDM > plusDM && minusDM > 0 ? minusDM : 0);

    const tr = Math.max(
      data[i - 1].high - data[i - 1].low,
      Math.abs(data[i - 1].high - data[i].close),
      Math.abs(data[i - 1].low - data[i].close)
    );
    trs.push(tr);
  }

  // Seed smoothed values with first `period` bars
  let smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);

  // Collect DX values for ADX smoothing
  const dxValues: number[] = [];

  // First DX from the seed
  const plusDI0 = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  const minusDI0 = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
  const diSum0 = plusDI0 + minusDI0;
  dxValues.push(diSum0 > 0 ? (Math.abs(plusDI0 - minusDI0) / diSum0) * 100 : 0);

  // Continue smoothing DM/TR and collecting DX values
  for (let i = period; i < plusDMs.length; i++) {
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];
    smoothTR = smoothTR - smoothTR / period + trs[i];

    const pDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const mDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = pDI + mDI;
    dxValues.push(diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0);
  }

  // Final +DI / -DI from last smoothed values
  const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

  // Smooth DX values into ADX using Wilder's smoothing
  if (dxValues.length < period) {
    return { adx: dxValues[dxValues.length - 1] || 20, plusDI, minusDI };
  }
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }

  return { adx, plusDI, minusDI };
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

export function getPriorNDayHigh(data: { high: number }[], n: number): number {
  if (n <= 0 || data.length <= 1) return 0;
  const highs = data.slice(1, n + 1).map((d) => d.high);
  return highs.length ? Math.max(...highs) : 0;
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
  const ema20 = calculateEMA(closes, 20);
  const atr = calculateATR(dailyData, 14);
  const atr20DayAgo = dailyData.length >= 34
    ? calculateATR(dailyData.slice(20), 14)
    : 0;
  const atrSpiking = atr20DayAgo > 0 ? atr >= atr20DayAgo * 1.3 : false;
  const atrPercent = closes[0] > 0 ? (atr / closes[0]) * 100 : 0;
  const { adx, plusDI, minusDI } = calculateADX(dailyData, 14);
  const efficiency = calculateTrendEfficiency(closes, 20);
  const twentyDayHigh = calculate20DayHigh(dailyData);
  const priorTwentyDayHigh = getPriorNDayHigh(dailyData, 20);

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

  // Exclude today's bar from average so spike isn't diluted in denominator
  const volumeRatio = dailyData[0]?.volume && dailyData.length > 20
    ? dailyData[0].volume / (dailyData.slice(1, 21).reduce((s, d) => s + d.volume, 0) / 20)
    : 1;

  return {
    currentPrice: closes[0],
    ma200,
    ema20,
    adx,
    plusDI,
    minusDI,
    atr,
    dayLow: dailyData[0]?.low ?? closes[0],
    atr20DayAgo,
    atrSpiking,
    atrPercent,
    twentyDayHigh,
    priorTwentyDayHigh,
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
  // Route to EODHD if configured
  if (isEodhd()) return eodhd.getMarketIndices();

  const indexTickers = INDEX_MAP.map(idx => idx.ticker);
  try {
    const rawResults = await yf.quote(indexTickers) as YahooQuoteResult[];
    return INDEX_MAP.map(idx => {
      const q = rawResults.find(r => r.symbol === idx.ticker);
      return {
        name: idx.name,
        ticker: idx.ticker,
        value: q?.regularMarketPrice || 0,
        change: q?.regularMarketChange || 0,
        changePercent: q?.regularMarketChangePercent || 0,
      };
    });
  } catch (error) {
    console.warn('[YF] Batch index fetch failed:', (error as Error).message);
    // Fallback: return zeroed entries
    return INDEX_MAP.map(idx => ({
      name: idx.name, ticker: idx.ticker, value: 0, change: 0, changePercent: 0,
    }));
  }
}

// ── Fear & Greed — approximation from VIX ──
export async function getFearGreedIndex(): Promise<FearGreedData> {
  // Route to EODHD if configured
  if (isEodhd()) return eodhd.getFearGreedIndex();

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
  // Route to EODHD if configured
  if (isEodhd()) return eodhd.getFXRate(fromCurrency, toCurrency);

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
  // Determine source currency — check explicit currency first
  const currency = stockCurrency?.toUpperCase() || (isUKTicker(ticker) ? 'GBX' : 'USD');

  // UK tickers default to GBX (pence) but respect explicit stockCurrency
  // e.g. a USD-denominated ETF on LSE would have stockCurrency='USD'
  if (currency === 'GBX' || currency === 'GBp') {
    return price / 100;
  }

  if (currency === 'GBP') return price;

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
    // Determine effective currency: explicit stockCurrency takes priority,
    // then fall back to GBX for UK tickers, USD otherwise
    const currency = stockCurrencies[ticker]?.toUpperCase()
      || (isUKTicker(ticker) ? 'GBX' : 'USD');
    if (currency !== 'GBP' && currency !== 'GBX' && currency !== 'GBp') {
      currenciesNeeded.add(currency);
    }
  }

  // Fetch all needed FX rates in parallel
  const fxEntries = await Promise.all(
    Array.from(currenciesNeeded).map(async (curr) => {
      const rate = await getFXRate(curr, 'GBP');
      return [curr, rate] as const;
    })
  );
  for (const [curr, rate] of fxEntries) {
    fxRates.set(curr, rate);
  }

  const normalized: Record<string, number> = {};
  for (const [ticker, price] of Object.entries(prices)) {
    const currency = stockCurrencies[ticker]?.toUpperCase()
      || (isUKTicker(ticker) ? 'GBX' : 'USD');
    if (currency === 'GBP') {
      normalized[ticker] = price;
    } else if (currency === 'GBX' || currency === 'GBp') {
      normalized[ticker] = price / 100;
    } else {
      normalized[ticker] = price * (fxRates.get(currency) ?? 1);
    }
  }

  return normalized;
}

export async function getBatchQuotes(tickers: string[]): Promise<Map<string, StockQuote>> {
  // Route to EODHD if configured
  if (isEodhd()) return eodhd.getBatchQuotes(tickers);

  const results = new Map<string, StockQuote>();
  if (tickers.length === 0) return results;

  // Separate cached vs uncached tickers
  const uncached: string[] = [];
  for (const ticker of tickers) {
    const cached = quoteCache.get(ticker);
    if (cached && cached.expiry > Date.now()) {
      results.set(ticker, cached.data);
    } else {
      uncached.push(ticker);
    }
  }

  if (uncached.length === 0) return results;

  // Build yahoo ticker → original ticker reverse map
  const yahooToOriginal = new Map<string, string>();
  const yahooTickers: string[] = [];
  for (const ticker of uncached) {
    const yt = toYahooTicker(ticker);
    yahooToOriginal.set(yt, ticker);
    yahooTickers.push(yt);
  }

  // True batch: yf.quote() accepts arrays — process in chunks of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < yahooTickers.length; i += BATCH_SIZE) {
    const batch = yahooTickers.slice(i, i + BATCH_SIZE);
    try {
      const rawResults = await yf.quote(batch) as YahooQuoteResult[];
      for (const r of rawResults) {
        if (!r || !r.regularMarketPrice || !r.symbol) continue;
        const originalTicker = yahooToOriginal.get(r.symbol) || r.symbol;
        const quote: StockQuote = {
          ticker: r.symbol,
          name: r.shortName || r.longName || originalTicker,
          price: r.regularMarketPrice,
          change: r.regularMarketChange || 0,
          changePercent: r.regularMarketChangePercent || 0,
          volume: r.regularMarketVolume || 0,
          previousClose: r.regularMarketPreviousClose || 0,
          high: r.regularMarketDayHigh || r.regularMarketPrice,
          low: r.regularMarketDayLow || r.regularMarketPrice,
          open: r.regularMarketOpen || r.regularMarketPrice,
        };
        quoteCache.set(originalTicker, { data: quote, expiry: Date.now() + QUOTE_TTL });
        results.set(originalTicker, quote);
      }
    } catch (error) {
      console.error(`[YF] Batch quote failed for chunk ${i}-${i + batch.length}:`, (error as Error).message);
      // Fallback: fetch individually for this chunk
      for (const yt of batch) {
        const originalTicker = yahooToOriginal.get(yt) || yt;
        try {
          const quote = await getStockQuote(originalTicker);
          if (quote) results.set(originalTicker, quote);
        } catch { /* skip */ }
      }
    }
    if (i + BATCH_SIZE < yahooTickers.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

// ── Market Regime from SPY + VWRL with CHOP band & 3-day stability ──
// Implements:
//   Module 10: ±2% CHOP band around 200MA forces SIDEWAYS
//   Module 19: Dual benchmark — both SPY and VWRL must be BULLISH
//   Module 9:  3 consecutive days same regime required for BULLISH confirmation
const CHOP_BAND_PCT = 0.02;

/**
 * Determine per-benchmark regime with ±2% CHOP band enforcement.
 * If price is within ±2% of MA200, regime is forced to SIDEWAYS.
 */
function singleBenchmarkRegime(price: number, ma200: number): 'BULLISH' | 'SIDEWAYS' | 'BEARISH' {
  const band = ma200 * CHOP_BAND_PCT;
  const inChop = Math.abs(price - ma200) <= band;
  if (inChop) return 'SIDEWAYS';
  return price > ma200 ? 'BULLISH' : 'BEARISH';
}

/**
 * Compute raw regime for a single day's data (SPY + VWRL dual benchmark).
 * Both must be BULLISH for combined BULLISH; either BEARISH → combined BEARISH.
 */
function computeDayRegime(
  spyClose: number, spyMa200: number,
  vwrlClose: number, vwrlMa200: number
): 'BULLISH' | 'SIDEWAYS' | 'BEARISH' {
  const spyRegime = singleBenchmarkRegime(spyClose, spyMa200);
  const vwrlRegime = singleBenchmarkRegime(vwrlClose, vwrlMa200);
  if (spyRegime === 'BULLISH' && vwrlRegime === 'BULLISH') return 'BULLISH';
  if (spyRegime === 'BEARISH' || vwrlRegime === 'BEARISH') return 'BEARISH';
  return 'SIDEWAYS';
}

export async function getMarketRegime(): Promise<'BULLISH' | 'SIDEWAYS' | 'BEARISH'> {
  try {
    // Fetch full history for both benchmarks in parallel
    const [spyData, vwrlData] = await Promise.all([
      getDailyPrices('SPY', 'full'),
      getDailyPrices('VWRL.L', 'full'),
    ]);

    if (spyData.length < 200) return 'SIDEWAYS';
    // If VWRL data is unavailable, fall back to SPY-only with CHOP band
    const hasVwrl = vwrlData.length >= 200;

    const spyCloses = spyData.map((d) => d.close);
    const spyMa200 = calculateMA(spyCloses, 200);

    let vwrlMa200 = 0;
    if (hasVwrl) {
      const vwrlCloses = vwrlData.map((d) => d.close);
      vwrlMa200 = calculateMA(vwrlCloses, 200);
    }

    // --- 3-day stability check ---
    // Compute regime for each of the last 3 trading days.
    // All 3 must agree for BULLISH confirmation; otherwise fall back to SIDEWAYS.
    const STABILITY_DAYS = 3;
    const regimes: ('BULLISH' | 'SIDEWAYS' | 'BEARISH')[] = [];

    for (let day = 0; day < STABILITY_DAYS; day++) {
      if (day >= spyData.length) break;
      const spyClose = spyData[day].close;

      if (hasVwrl && day < vwrlData.length) {
        const vwrlClose = vwrlData[day].close;
        regimes.push(computeDayRegime(spyClose, spyMa200, vwrlClose, vwrlMa200));
      } else {
        // SPY-only with CHOP band fallback
        regimes.push(singleBenchmarkRegime(spyClose, spyMa200));
      }
    }

    // Today's raw regime
    const todayRegime = regimes[0] ?? 'SIDEWAYS';

    // Stability: all 3 days must show the same regime
    if (regimes.length >= STABILITY_DAYS) {
      const allSame = regimes.every((r) => r === todayRegime);
      if (allSame) return todayRegime;
      // Not stable — force SIDEWAYS (spec: "needs 3 for confirmation")
      return 'SIDEWAYS';
    }

    // Fewer than 3 days of data — conservative fallback
    return 'SIDEWAYS';
  } catch {
    return 'SIDEWAYS';
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

// ── Pre-cache historical data for all active tickers ──
// Called by nightly cron (Step 0) and on server startup if cache is empty.
// Populates the in-memory historicalCache (24h TTL) so all downstream
// consumers get cache hits throughout the day.
export async function preCacheHistoricalData(): Promise<{
  total: number;
  success: number;
  failed: string[];
  durationMs: number;
}> {
  // Dynamic import to avoid circular dependency — prisma is only needed here
  const { default: prisma } = await import('./prisma');

  const stocks = await prisma.stock.findMany({
    where: { active: true },
    select: { ticker: true },
  });
  const allTickers = stocks.map(s => s.ticker);

  console.log(`[Pre-cache] Starting historical data fetch for ${allTickers.length} tickers...`);
  const start = Date.now();
  const failed: string[] = [];
  let success = 0;

  // Process in batches of 10 to stay within rate limits
  // (each call goes through the rate-limited queue anyway)
  const BATCH = 10;
  for (let i = 0; i < allTickers.length; i += BATCH) {
    const batch = allTickers.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => {
        const bars = await getDailyPrices(ticker, 'full');
        if (bars.length === 0) throw new Error('no data');
      })
    );
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        success++;
      } else {
        failed.push(batch[idx]);
      }
    });
    // Progress log every 50 tickers
    if ((i + BATCH) % 50 === 0 || i + BATCH >= allTickers.length) {
      console.log(`[Pre-cache] Progress: ${Math.min(i + BATCH, allTickers.length)}/${allTickers.length}`);
    }
  }

  const durationMs = Date.now() - start;
  console.log(`[Pre-cache] Complete: ${success}/${allTickers.length} succeeded, ${failed.length} failed in ${(durationMs / 1000).toFixed(1)}s`);
  if (failed.length > 0) {
    console.warn(`[Pre-cache] Failed tickers: ${failed.join(', ')}`);
  }

  return { total: allTickers.length, success, failed, durationMs };
}

// ── Startup pre-cache ──
// On first module load, if the historical cache is empty, run pre-cache in
// the background so the first scan/dashboard load doesn't trigger ~268
// sequential chart calls.  Fires once per server process.
(function autoPreCache() {
  // Small delay to let the server finish booting before hammering Yahoo
  setTimeout(() => {
    if (historicalCache.size === 0) {
      console.log('[Startup] Historical cache empty — launching background pre-cache...');
      preCacheHistoricalData().catch(err => {
        console.error('[Startup] Pre-cache failed:', (err as Error).message);
      });
    } else {
      console.log('[Startup] Historical cache already populated — skipping pre-cache');
    }
  }, 3000);
})();
