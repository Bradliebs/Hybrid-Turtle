/**
 * HybridTurtle Nightly Cron Job
 * 
 * Runs at 9:30 PM UK time every weekday.
 * 
 * 8-Step Nightly Process:
 * 1. Run 16-point health check
 * 2. Detect market regime
 * 3. Fetch latest prices for all positions
 * 4. Generate stop-loss recommendations
 * 5. Run 7-stage scan
 * 6. Calculate risk budget
 * 7. Save heartbeat
 * 8. Send Telegram summary
 * 
 * Usage:
 *   npx ts-node src/cron/nightly.ts
 * 
 * Or import and call startNightlyCron() from your server startup.
 */

import cron from 'node-cron';

const NIGHTLY_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

async function runNightlyProcess() {
  console.log('========================================');
  console.log(`[HybridTurtle] Nightly process started at ${new Date().toISOString()}`);
  console.log('========================================');

  try {
    const response = await fetch(`${NIGHTLY_URL}/api/nightly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'hybridturtle-cron'}`,
      },
      body: JSON.stringify({ userId: 'default-user' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[HybridTurtle] Nightly process failed with status ${response.status}`);
      console.error(errorText);
      return;
    }

    const result = await response.json();

    console.log('[HybridTurtle] Nightly process completed successfully');
    console.log(`  Health: ${result.summary?.healthStatus || 'N/A'}`);
    console.log(`  Regime: ${result.summary?.regime || 'N/A'}`);
    console.log(`  Positions: ${result.summary?.positionCount || 0}`);
    console.log(`  Scan Candidates: ${result.summary?.scanCandidates || 0}`);
    console.log(`  Telegram: ${result.summary?.telegramSent ? 'Sent' : 'Not sent'}`);
    console.log('========================================');
  } catch (error) {
    console.error('[HybridTurtle] Nightly process error:', error);
  }
}

/**
 * Start the nightly cron job.
 * Runs at 21:30 (9:30 PM) UK time, Monday through Friday.
 */
export function startNightlyCron() {
  // Schedule: minute hour day-of-month month day-of-week
  // 30 21 * * 1-5 = 9:30 PM, Mon-Fri
  const job = cron.schedule(
    '30 21 * * 1-5',
    () => {
      runNightlyProcess();
    },
    {
      timezone: 'Europe/London',
    }
  );

  console.log('[HybridTurtle] Nightly cron job scheduled for 9:30 PM UK time (Mon-Fri)');
  return job;
}

// If running directly via ts-node / node
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--run-now')) {
    // Run immediately for testing
    console.log('[HybridTurtle] Running nightly process immediately (--run-now)');
    runNightlyProcess().then(() => process.exit(0));
  } else {
    // Start the cron scheduler
    startNightlyCron();
  }
}
