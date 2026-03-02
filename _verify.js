const D = require('better-sqlite3');
const db = new D('prisma/dev.db', { readonly: true });
console.log('Integrity:', db.pragma('integrity_check'));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name));
db.close();
