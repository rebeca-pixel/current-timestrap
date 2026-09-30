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
    
    // Check employee id for E0053
    const empRes = await client.query("SELECT id, name FROM employees WHERE employee_code = 'E0053'");
    console.log("Employee E0053 info:", empRes.rows[0]);
    const empId = empRes.rows[0]?.id;
    
    // Check daily submissions for E0053 on June 9
    const subRes = await client.query("SELECT * FROM daily_submissions WHERE employee_id = $1 AND date = '2026-06-09'", [empId]);
    console.log("Daily submission records on June 9:", subRes.rows);
    
    client.release();
  } catch (err) {
    console.error("Database query error:", err);
  } finally {
    await pool.end();
  }
}

main();
