process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const { Pool } = require('pg');
require('dotenv').config();

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT id, date, length(date) as len, status, manager_approved, employee_id
      FROM time_entries
      WHERE employee_code = 'E0048'
        AND date >= '2026-06-01'
        AND date <= '2026-06-10'
      ORDER BY date;
    `);
    console.log(res.rows);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(console.error);
