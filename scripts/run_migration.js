#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sqlFile = path.join(__dirname, '..', 'migrations', '0001_add_pms_id.sql');
if (!fs.existsSync(sqlFile)) {
  console.error('Migration file not found:', sqlFile);
  process.exit(1);
}
const sql = fs.readFileSync(sqlFile, 'utf8');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Please set DATABASE_URL in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  console.log('Applying migration:', sqlFile);
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Migration applied successfully.');
  } finally {
    client.release();
  }
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
