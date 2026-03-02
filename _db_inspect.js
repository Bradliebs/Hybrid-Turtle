const Database = require('better-sqlite3');
const db = new Database('prisma/dev.db', { readonly: true });

console.log('=== INTEGRITY CHECK ===');
console.log(db.pragma('integrity_check'));

console.log('\n=== ALL TABLES ===');
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
tables.forEach(t => console.log(`  ${t.name}`));

console.log('\n=== _prisma_migrations TABLE ===');
try {
  const migrations = db.prepare("SELECT id, migration_name, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at").all();
  migrations.forEach(m => console.log(`  ${m.migration_name} (steps: ${m.applied_steps_count}, finished: ${m.finished_at})`));
} catch(e) {
  console.log('  ERROR:', e.message);
}

console.log('\n=== SCHEMA FOR _prisma_migrations ===');
try {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='_prisma_migrations'").get();
  console.log(schema ? schema.sql : 'TABLE NOT FOUND');
} catch(e) {
  console.log('  ERROR:', e.message);
}

console.log('\n=== CHECK FOR default-user VIEW/TABLE ===');
try {
  const items = db.prepare("SELECT name, type, sql FROM sqlite_master WHERE name LIKE '%default%' OR name LIKE '%user%'").all();
  if (items.length === 0) console.log('  No items matching default/user');
  items.forEach(i => console.log(`  ${i.type}: ${i.name} => ${i.sql}`));
} catch(e) {
  console.log('  ERROR:', e.message);
}

db.close();
