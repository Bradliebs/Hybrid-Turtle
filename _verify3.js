const D = require('better-sqlite3');
const db = new D('prisma/dev.db', { readonly: true });

console.log('Integrity:', db.pragma('integrity_check'));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('\nTables (' + tables.length + '):', tables.map(t => t.name));

console.log('\n_prisma_migrations:');
const migs = db.prepare("SELECT migration_name, finished_at FROM _prisma_migrations").all();
migs.forEach(m => console.log('  ' + m.migration_name + ' (' + m.finished_at + ')'));

// Check key data
const checks = ['Stock', 'Position', 'EquitySnapshot', 'Heartbeat', 'ScanResult', 'ExecutionLog', 'Notification', 'EarningsCache', 'TradeJournal'];
console.log('\nRow counts:');
for (const t of checks) {
  try {
    const c = db.prepare('SELECT COUNT(*) as cnt FROM "' + t + '"').get();
    console.log('  ' + t + ': ' + c.cnt);
  } catch(e) {
    console.log('  ' + t + ': ERROR - ' + e.message);
  }
}

db.close();
