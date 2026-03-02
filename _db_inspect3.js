const Database = require('better-sqlite3');

// Try read-write mode to fix the issue
const db = new Database('prisma/dev.db');

// Try reading specific known tables directly, bypassing sqlite_master
const knownTables = ['Ticker', 'Position', 'EquitySnapshot', 'ScanResult', 'Trade', '_prisma_migrations', 'ExecutionLog', 'Notification', 'EarningsCache', 'GapGuardConfig'];

console.log('=== TESTING DIRECT TABLE ACCESS ===');
for (const table of knownTables) {
  try {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get();
    console.log(`  ${table}: ${count.cnt} rows`);
  } catch(e) {
    console.log(`  ${table}: ${e.message.substring(0, 80)}`);
  }
}

// Try to find the corrupted schema entry using raw approach
console.log('\n=== TRYING TO READ sqlite_master by type ===');
try {
  // This might work if we can iterate individually
  const stmt = db.prepare("SELECT type, name FROM sqlite_master");
  // just try to access it
  const result = stmt.all();
  result.forEach(r => console.log(`  ${r.type}: ${r.name}`));
} catch(e) {
  console.log('  ERROR:', e.message);
}

// Try writable_schema to see what's broken
console.log('\n=== TRYING writable_schema ===');
try {
  db.exec('PRAGMA writable_schema = ON');
  // Now try to list items
  const items = db.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY name").all();
  items.forEach(i => console.log(`  [${i.type}] ${i.name}: ${(i.sql || '').substring(0, 100)}`));
} catch(e) {
  console.log('  ERROR:', e.message);
}

db.close();
