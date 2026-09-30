import "dotenv/config";
import { pool } from "./server/db";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
  const targetEmployeeCode = "E0041";
  const empRes = await pool.query("SELECT id FROM employees WHERE employee_code = $1", [targetEmployeeCode]);
  const targetEmployeeId = empRes.rows[0].id;

  const res = await pool.query(
    `SELECT * FROM time_entries WHERE employee_id = $1 AND date BETWEEN '2026-05-01' AND '2026-05-31' ORDER BY date DESC LIMIT 200`,
    [targetEmployeeId]
  );
  
  console.log(`Retrieved ${res.rows.length} rows.`);
  const dates = res.rows.map(r => r.date);
  console.log("All dates:", dates);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
