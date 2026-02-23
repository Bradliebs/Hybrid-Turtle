import YahooFinance from 'yahoo-finance2';

const yf = new (YahooFinance as unknown as new (opts: { suppressNotices: string[] }) => { chart: (t: string, o: Record<string, unknown>) => Promise<{ quotes: Array<{ date: Date; close: number; adjclose: number }> }> })({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

async function check() {
  const r = await yf.chart('CME', {
    period1: '2026-02-18',
    period2: '2026-02-24',
    interval: '1d',
  });
  for (const q of r.quotes) {
    const date = new Date(q.date).toISOString().split('T')[0];
    const diff = q.close && q.adjclose ? ((q.close - q.adjclose) / q.close * 100).toFixed(2) : 'N/A';
    console.log(`${date}  close: ${q.close?.toFixed(2)}  adjclose: ${q.adjclose?.toFixed(2)}  diff: ${diff}%`);
  }
}

check().catch(console.error);
