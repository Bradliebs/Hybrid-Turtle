const D = require('better-sqlite3');

// Check original backup
console.log('=== BACKUP FILE ===');
try {
  const db = new D('prisma/dev.db.backup-20260301-222339', { readonly: true });
  console.log('Integrity:', db.pragma('integrity_check'));
  db.close();
  console.log('OK');
} catch(e) {
  console.log('ERROR:', e.message);
}

// Check current dev.db
console.log('\n=== DEV.DB (restored) ===');
try {
  const db = new D('prisma/dev.db', { readonly: true });
  console.log('Integrity:', db.pragma('integrity_check'));
  db.close();
  console.log('OK');
} catch(e) {
  console.log('ERROR:', e.message);
}

// Compare file sizes
const fs = require('fs');
const backup = fs.statSync('prisma/dev.db.backup-20260301-222339');
const current = fs.statSync('prisma/dev.db');
console.log('\nBackup size:', backup.size);
console.log('Current size:', current.size);
console.log('Same size:', backup.size === current.size);

// Check for leftover shm/wal
for (const ext of ['-shm', '-wal', '-journal']) {
  const p = 'prisma/dev.db' + ext;
  console.log(`${p}: ${fs.existsSync(p) ? 'EXISTS (' + fs.statSync(p).size + ' bytes)' : 'not found'}`);
}
