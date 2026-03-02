import { createRequire } from 'module';
import { execSync } from 'child_process';

// Use npx to run a quick prisma query
// Instead, let's use the raw SQLite driver that Prisma bundles
import { readFileSync } from 'fs';

// Check if we can read the file at all
const dbPath = 'prisma/dev.db';
const stats = readFileSync(dbPath);
console.log('DB file size:', stats.length, 'bytes');
console.log('First 16 bytes (SQLite header):', stats.slice(0, 16).toString('ascii'));
