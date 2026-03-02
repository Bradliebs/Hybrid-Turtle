const Database = require('better-sqlite3');

// Check the backup
console.log('=== CHECKING BACKUP ===');
try {
  const db = new Database('prisma/dev.db.backup-20260301-222339', { readonly: true });
  console.log('Opened successfully');
  
  const integrity = db.pragma('integrity_check');
  console.log('Integrity:', integrity);
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log('Tables:', tables.map(t => t.name));
  
  const migrations = db.prepare("SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at").all();
  console.log('\nMigrations:');
  migrations.forEach(m => console.log(`  ${m.migration_name} (${m.finished_at})`));
  
  // Count important data
  const counts = {};
  for (const t of tables) {
    try {
      const c = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
      counts[t.name] = c.cnt;
    } catch(e) {
      counts[t.name] = 'ERROR: ' + e.message;
    }
  }
  console.log('\nRow counts:', JSON.stringify(counts, null, 2));
  
  db.close();
} catch(e) {
  console.log('ERROR:', e.message);
}

// Also check the .corrupted file
console.log('\n=== CHECKING .corrupted FILE ===');
try {
  const db = new Database('prisma/dev.db.corrupted', { readonly: true });
  const integrity = db.pragma('integrity_check');
  console.log('Integrity:', integrity);
  db.close();
} catch(e) {
  console.log('ERROR:', e.message);
}
