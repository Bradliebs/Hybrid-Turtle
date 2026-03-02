const Database = require('better-sqlite3');

// Try to checkpoint the WAL - this might fix the issue
console.log('=== ATTEMPTING WAL CHECKPOINT ===');
try {
  const db = new Database('prisma/dev.db');
  const result = db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('Checkpoint result:', result);
  db.close();
} catch(e) {
  console.log('Checkpoint error:', e.message);
}

// Try opening without WAL (read the DB using a copy without WAL)
console.log('\n=== TRYING TO OPEN IN DIFFERENT JOURNAL MODE ===');
try {
  const db = new Database('prisma/dev.db');
  // Try to set journal mode
  try {
    const mode = db.pragma('journal_mode');
    console.log('Current journal mode:', mode);
  } catch(e) {
    console.log('Cannot read journal mode:', e.message);
  }
  db.close();
} catch(e) {
  console.log('Open error:', e.message);
}

// Last resort: try to dump the raw sqlite_master page
console.log('\n=== RAW BINARY INSPECTION ===');
const fs = require('fs');
const buf = fs.readFileSync('prisma/dev.db');
console.log('File size:', buf.length);
console.log('Header:', buf.slice(0, 16).toString('ascii'));
// Page size is at offset 16-17 (big-endian)
const pageSize = buf.readUInt16BE(16);
console.log('Page size:', pageSize);
// Number of pages at offset 28
const numPages = buf.readUInt32BE(28);
console.log('Number of pages:', numPages);

// Check the schema format at offset 44
const schemaFormat = buf.readUInt32BE(44);
console.log('Schema format:', schemaFormat);

// Find "default-user" in the binary
let idx = 0;
let positions = [];
while ((idx = buf.indexOf('default-user', idx)) !== -1) {
  positions.push(idx);
  idx++;
}
console.log(`\nFound "default-user" at ${positions.length} positions:`, positions.map(p => `offset ${p} (page ${Math.floor(p/pageSize)+1})`));

// Show the context around each occurrence
for (const pos of positions) {
  const start = Math.max(0, pos - 100);
  const end = Math.min(buf.length, pos + 200);
  const context = buf.slice(start, end).toString('utf8').replace(/[\x00-\x1f\x7f-\xff]/g, '.');
  console.log(`\n--- Context around offset ${pos} ---`);
  console.log(context);
}
