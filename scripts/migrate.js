// Netfly DB migrations — applies backend/migrations/*.sql in filename
// order and records each applied file in schema_migrations, so re-runs
// are no-ops. Every migration file is itself idempotent
// (IF NOT EXISTS / ON CONFLICT), so applying twice is safe.
//
// Usage (needs a direct DB connection):
//   DATABASE_URL=postgresql://... node scripts/migrate.js
//
// On the dev VM the Render database is only reachable through the socat
// tunnel (see engine/db.py); run this from Render Shell, or from a host
// that can reach the database directly. The live database already has
// 001-003 applied (2026-11-20, via the engine tunnel).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL env var required');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const done = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`applied ${file}`);
    }
    console.log('migrations done');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
