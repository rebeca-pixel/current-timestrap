import "dotenv/config";
import { pool } from "./server/db";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
  const targetEmployeeCode = "E0041";
  const empRes = await pool.query("SELECT id FROM employees WHERE employee_code = $1", [targetEmployeeCode]);
  const targetEmployeeId = empRes.rows[0].id;

  const from_date = "2026-05-01";
  const to_date = "2026-05-31";

  let query = `SELECT * FROM time_entries WHERE employee_id = $1`;
  const params: any[] = [targetEmployeeId];
  params.push(from_date, to_date);
  query += ` AND date BETWEEN $${params.length - 1} AND $${params.length}`;
  const limit = 200;
  query += ` ORDER BY date DESC LIMIT ${limit}`;

  console.log("Running query:", query, "with params:", params);
  const res = await pool.query(query, params);
  console.log(`Total rows returned: ${res.rows.length}`);
  
  const uniqueDates = Array.from(new Set(res.rows.map(r => r.date)));
  console.log("Unique dates in timesheets:", uniqueDates);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
