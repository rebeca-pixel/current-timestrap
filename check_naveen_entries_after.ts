process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function main() {
  try {
    const client = await pool.connect();
    
    // Check status of E0053 entries on June 9
    const res = await client.query("SELECT id, employee_id, date, status FROM time_entries WHERE employee_code = 'E0053' AND date = '2026-06-09'");
    console.log("Current time entries:", res.rows);
    
    client.release();
  } catch (err) {
    console.error("Database query error:", err);
  } finally {
    await pool.end();
  }
}

main();
