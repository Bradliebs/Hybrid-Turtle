const Database = require('better-sqlite3');

// Check the corrupted file in detail
console.log('=== CHECKING .corrupted FILE IN DETAIL ===');
try {
  const db = new Database('prisma/dev.db.corrupted', { readonly: true });
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log('Tables:', tables.map(t => t.name));
  
  try {
    const migrations = db.prepare("SELECT migration_name FROM _prisma_migrations ORDER BY started_at").all();
    console.log('Migrations:', migrations.map(m => m.migration_name));
  } catch(e) {
    console.log('No _prisma_migrations table');
  }
  
  const counts = {};
  for (const t of tables) {
    try {
      const c = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
      counts[t.name] = c.cnt;
    } catch(e) {
      counts[t.name] = 'ERROR';
    }
  }
  console.log('Row counts:', JSON.stringify(counts, null, 2));
  
  db.close();
} catch(e) {
  console.log('ERROR:', e.message);
}

// Check backup row counts
console.log('\n=== BACKUP FILE ROW COUNTS ===');
try {
  const db = new Database('prisma/dev.db.backup-20260301-222339', { readonly: true });
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const counts = {};
  for (const t of tables) {
    try {
      const c = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
      counts[t.name] = c.cnt;
    } catch(e) {
      counts[t.name] = 'ERROR';
    }
  }
  console.log('Row counts:', JSON.stringify(counts, null, 2));
  
  db.close();
} catch(e) {
  console.log('ERROR:', e.message);
}
