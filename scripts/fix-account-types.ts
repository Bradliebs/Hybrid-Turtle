/**
 * ONE-TIME ACCOUNT TYPE FIX SCRIPT
 *
 * Run this if your stop-loss placements
 * are failing with:
 * "selling-equity-not-owned" errors
 *
 * HOW TO RUN:
 * 1. Make sure your T212 API credentials
 *    are configured in Settings
 * 2. Open a terminal in the project folder
 * 3. Run: npx tsx scripts/fix-account-types.ts
 * 4. Review the report carefully
 * 5. Type Y to apply corrections
 *
 * WHAT IT DOES:
 * Checks each open position in your database
 * against Trading 212 to verify it is in
 * the correct account (ISA vs Invest).
 * Corrects any mismatches found.
 * Does NOT affect stops, prices, or P&L.
 *
 * SAFE TO RUN MULTIPLE TIMES:
 * If already correct, it makes no changes.
 */

/**
 * DEPENDENCIES
 * Consumed by: User (standalone CLI script)
 * Consumes: prisma (DB), trading212.ts (T212 API), trading212-dual.ts (dual-account)
 * Risk-sensitive: NO — only modifies accountType field
 * Last modified: 2026-03-02
 * Notes: One-time data fix for ISA/Invest account type mismatches.
 *        Never touches stops, P&L, shares, or any other position field.
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { Trading212Client, type T212Position } from '../src/lib/trading212';
import {
  DualT212Client,
  type T212AccountCredentials,
  validateDualCredentials,
  getCredentialsForAccount,
} from '../src/lib/trading212-dual';

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Log file setup ──
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logFile = path.join(__dirname, `fix-account-types-${timestamp}.log`);
const logLines: string[] = [];

function log(msg: string) {
  console.log(msg);
  logLines.push(`[${new Date().toISOString()}] ${msg}`);
}

function logOnly(msg: string) {
  logLines.push(`[${new Date().toISOString()}] ${msg}`);
}

function writeLog() {
  fs.writeFileSync(logFile, logLines.join('\n') + '\n', 'utf-8');
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Ticker matching: strip T212 suffixes for comparison ──
function normaliseT212Ticker(t212Ticker: string): string {
  return t212Ticker
    .replace(/_US_EQ$/, '')
    .replace(/_UK_EQ$/, '')
    .replace(/_EQ$/, '')
    .replace(/_ETF$/, '');
}

interface PositionCheck {
  id: string;
  ticker: string;
  t212Ticker: string | null;
  dbAccountType: string;
  t212AccountType: string | null; // null = not found in either account
  action: 'OK' | 'FIX' | 'UNKNOWN';
}

async function main() {
  log('');
  log('═══════════════════════════════════════════════════════');
  log('  ACCOUNT TYPE FIX — Trading 212 ISA/Invest Checker');
  log('═══════════════════════════════════════════════════════');
  log('');

  // 1. Get user credentials from DB
  log('Loading T212 credentials from database...');
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      t212ApiKey: true,
      t212ApiSecret: true,
      t212Environment: true,
      t212Connected: true,
      t212IsaApiKey: true,
      t212IsaApiSecret: true,
      t212IsaConnected: true,
    },
  });

  if (!user) {
    log('✗ No user found in database. Run the dashboard first to create an account.');
    writeLog();
    process.exit(1);
  }

  const credStatus = validateDualCredentials(user);
  log(`  Invest account: ${credStatus.hasInvest ? 'Connected' : 'Not connected'}`);
  log(`  ISA account:    ${credStatus.hasIsa ? 'Connected' : 'Not connected'}`);

  if (!credStatus.canFetch) {
    log('');
    log('✗ Cannot connect to Trading 212. Check your API credentials in Settings and try again.');
    writeLog();
    process.exit(1);
  }

  if (!credStatus.hasInvest || !credStatus.hasIsa) {
    log('');
    log('⚠ Only one account is connected. Cannot verify account type assignments');
    log('  for positions that might be in the other account.');
    log('  Connect both ISA and Invest accounts in Settings, then re-run.');
    writeLog();
    process.exit(1);
  }

  // 2. Fetch positions from both T212 accounts
  log('');
  log('Fetching live positions from Trading 212...');

  const investCreds = getCredentialsForAccount(user, 'invest');
  const isaCreds = getCredentialsForAccount(user, 'isa');
  const dualClient = new DualT212Client(investCreds, isaCreds);

  const result = await dualClient.fetchBothAccounts();

  // Check for API errors
  if (result.errors.invest && result.errors.isa) {
    log('');
    log(`✗ Cannot connect to Trading 212.`);
    log(`  Invest error: ${result.errors.invest}`);
    log(`  ISA error:    ${result.errors.isa}`);
    log('  Check your API credentials and try again.');
    writeLog();
    process.exit(1);
  }

  if (result.errors.invest) {
    log(`  ⚠ Invest fetch failed: ${result.errors.invest}`);
    log('  Cannot verify. Fix credentials and try again.');
    writeLog();
    process.exit(1);
  }

  if (result.errors.isa) {
    log(`  ⚠ ISA fetch failed: ${result.errors.isa}`);
    log('  Cannot verify. Fix credentials and try again.');
    writeLog();
    process.exit(1);
  }

  if (!result.invest?.positionsFetched || !result.isa?.positionsFetched) {
    log('');
    log('✗ T212 position fetch incomplete. Try again in a few minutes.');
    writeLog();
    process.exit(1);
  }

  const investPositions = result.invest?.positions ?? [];
  const isaPositions = result.isa?.positions ?? [];

  log(`  Invest positions: ${investPositions.length}`);
  log(`  ISA positions:    ${isaPositions.length}`);

  const totalT212 = investPositions.length + isaPositions.length;
  if (totalT212 === 0) {
    log('');
    log('✗ T212 returned no positions — possible API error. No changes made.');
    writeLog();
    process.exit(1);
  }

  // Build lookup maps: normalised ticker → account type
  // Use t212Ticker (raw format like AAPL_US_EQ) for primary matching,
  // fall back to normalised ticker for fuzzy matching
  const investTickerMap = new Map<string, T212Position>();
  const isaTickerMap = new Map<string, T212Position>();

  for (const pos of investPositions) {
    investTickerMap.set(pos.instrument.ticker, pos);
    investTickerMap.set(normaliseT212Ticker(pos.instrument.ticker), pos);
  }
  for (const pos of isaPositions) {
    isaTickerMap.set(pos.instrument.ticker, pos);
    isaTickerMap.set(normaliseT212Ticker(pos.instrument.ticker), pos);
  }

  // 3. Fetch open positions from DB
  log('');
  log('Fetching open positions from database...');

  const dbPositions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    select: {
      id: true,
      t212Ticker: true,
      accountType: true,
      stock: {
        select: { ticker: true, name: true },
      },
    },
  });

  log(`  Open positions in DB: ${dbPositions.length}`);

  if (dbPositions.length === 0) {
    log('');
    log('No open positions to check. Nothing to do.');
    writeLog();
    process.exit(0);
  }

  // 4. Compare each DB position against T212
  const checks: PositionCheck[] = [];

  for (const pos of dbPositions) {
    const ticker = pos.stock.ticker;
    const t212Ticker = pos.t212Ticker;
    const dbAccountType = pos.accountType ?? 'invest';

    // Try matching by t212Ticker first, then by stock ticker
    const lookupKeys = [t212Ticker, ticker].filter(Boolean) as string[];

    let foundInInvest = false;
    let foundInIsa = false;

    for (const key of lookupKeys) {
      if (investTickerMap.has(key)) foundInInvest = true;
      if (isaTickerMap.has(key)) foundInIsa = true;
    }

    let t212AccountType: string | null = null;
    let action: 'OK' | 'FIX' | 'UNKNOWN' = 'UNKNOWN';

    if (foundInInvest && !foundInIsa) {
      t212AccountType = 'invest';
      action = dbAccountType === 'invest' ? 'OK' : 'FIX';
    } else if (foundInIsa && !foundInInvest) {
      t212AccountType = 'isa';
      action = dbAccountType === 'isa' ? 'OK' : 'FIX';
    } else if (foundInInvest && foundInIsa) {
      // Position exists in both accounts — unusual but possible
      t212AccountType = 'both';
      action = 'OK'; // Can't determine which is "correct" — leave as-is
    } else {
      // Not found in either account
      t212AccountType = null;
      action = 'UNKNOWN';
    }

    checks.push({
      id: pos.id,
      ticker,
      t212Ticker,
      dbAccountType,
      t212AccountType,
      action,
    });

    logOnly(`  Check: ${ticker} | DB=${dbAccountType} | T212=${t212AccountType ?? 'NOT FOUND'} | ${action}`);
  }

  // 5. Display report
  const needsFix = checks.filter((c) => c.action === 'FIX');
  const alreadyOk = checks.filter((c) => c.action === 'OK');
  const unknown = checks.filter((c) => c.action === 'UNKNOWN');

  log('');
  log('ACCOUNT TYPE CORRECTIONS NEEDED:');
  log('┌──────────────┬──────────────┬──────────────┬─────────┐');
  log('│ Ticker       │ DB Says      │ T212 Says    │ Action  │');
  log('├──────────────┼──────────────┼──────────────┼─────────┤');

  for (const check of checks) {
    const ticker = check.ticker.padEnd(12);
    const dbType = (check.dbAccountType ?? 'unknown').padEnd(12);
    const t212Type = (check.t212AccountType ?? 'NOT FOUND').padEnd(12);
    const action = check.action.padEnd(7);
    log(`│ ${ticker} │ ${dbType} │ ${t212Type} │ ${action} │`);
  }

  log('└──────────────┴──────────────┴──────────────┴─────────┘');
  log('');
  log(`  Positions needing correction:             ${needsFix.length}`);
  log(`  Positions already correct:                ${alreadyOk.length}`);
  log(`  Not found in T212 (manual check needed):  ${unknown.length}`);

  if (unknown.length > 0) {
    log('');
    log('  ⚠ Positions not found in T212:');
    for (const u of unknown) {
      log(`    - ${u.ticker} (t212Ticker: ${u.t212Ticker ?? 'none'})`);
    }
    log('    These will NOT be changed. Check manually.');
  }

  // 6. If nothing to fix, exit
  if (needsFix.length === 0) {
    log('');
    log('✓ All positions already match their T212 accounts. No changes needed.');
    writeLog();
    log(`  Log saved: ${logFile}`);
    await prisma.$disconnect();
    process.exit(0);
  }

  // 7. Ask for confirmation
  log('');
  const answer = await ask('Apply these corrections? (y/N): ');

  if (answer.toLowerCase() !== 'y') {
    log('');
    log('Aborted — no changes made.');
    writeLog();
    log(`  Log saved: ${logFile}`);
    await prisma.$disconnect();
    process.exit(0);
  }

  // 8. Apply corrections — ONLY accountType field
  log('');
  log('Applying corrections...');

  let corrected = 0;
  let failed = 0;

  for (const fix of needsFix) {
    try {
      await prisma.position.update({
        where: { id: fix.id },
        data: { accountType: fix.t212AccountType },
      });
      log(`  ✓ ${fix.ticker}: ${fix.dbAccountType} → ${fix.t212AccountType}`);
      logOnly(`  UPDATED position ${fix.id} (${fix.ticker}) accountType: ${fix.dbAccountType} → ${fix.t212AccountType}`);
      corrected++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  ✗ ${fix.ticker}: Failed — ${msg}`);
      logOnly(`  ERROR updating position ${fix.id} (${fix.ticker}): ${msg}`);
      failed++;
    }
  }

  // 9. Final report
  log('');
  if (failed === 0) {
    log(`✓ ${corrected} position(s) corrected`);
    log('✓ All positions now match T212 accounts');
  } else {
    log(`✓ ${corrected} position(s) corrected`);
    log(`✗ ${failed} position(s) failed — check log for details`);
  }
  log('');
  log('  Next step: Re-run stop placement from the');
  log('  Portfolio page to set stops on previously');
  log('  failed positions.');

  writeLog();
  log(`  Log saved: ${logFile}`);

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('');
  console.error('✗ Unexpected error:', err instanceof Error ? err.message : String(err));
  logLines.push(`[${new Date().toISOString()}] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  writeLog();
  console.error(`  Log saved: ${logFile}`);
  await prisma.$disconnect();
  process.exit(1);
});
