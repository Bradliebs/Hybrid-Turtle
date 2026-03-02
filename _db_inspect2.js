const Database = require('better-sqlite3');
const db = new Database('prisma/dev.db', { readonly: true });

// Skip PRAGMA, go straight to queries
console.log('=== ALL TABLES/VIEWS/TRIGGERS ===');
try {
  const items = db.prepare("SELECT type, name, tbl_name FROM sqlite_master ORDER BY type, name").all();
  items.forEach(i => console.log(`  [${i.type}] ${i.name} (table: ${i.tbl_name})`));
} catch(e) {
  console.log('  ERROR:', e.message);
}

console.log('\n=== ITEMS WITH "default" or "user" IN NAME OR SQL ===');
try {
  const items = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%default%' OR name LIKE '%user%' OR sql LIKE '%default-user%'").all();
  if (items.length === 0) console.log('  None found');
  items.forEach(i => {
    console.log(`  [${i.type}] ${i.name}`);
    console.log(`    SQL: ${i.sql}`);
  });
} catch(e) {
  console.log('  ERROR:', e.message);
}

console.log('\n=== _prisma_migrations ===');
try {
  const migrations = db.prepare("SELECT migration_name, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at").all();
  migrations.forEach(m => console.log(`  ${m.migration_name} (steps: ${m.applied_steps_count})`));
} catch(e) {
  console.log('  ERROR:', e.message);
}

console.log('\n=== TABLE COUNT ===');
try {
  const count = db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'").get();
  console.log('  Tables:', count.cnt);
} catch(e) {
  console.log('  ERROR:', e.message);
}

db.close();
