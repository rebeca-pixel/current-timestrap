import "dotenv/config";
import { pool } from "./server/db";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
  console.log("=== CHECKING ALL MAY & JUNE 2026 ROWS FOR E0041 ===");
  const res = await pool.query(
    "SELECT id, date, status, start_time, end_time, submitted_at, project_name FROM time_entries WHERE employee_id = '62ff4085-53a3-40c2-8329-f496c09889e0' AND date >= '2026-05-01' AND date <= '2026-06-30' ORDER BY date"
  );
  res.rows.forEach(r => {
    console.log(`Date: ${r.date}, Status: ${r.status}, SubmittedAt: ${r.submitted_at?.toISOString()}, Project: ${r.project_name}`);
  });

  console.log("\n=== UNIQUE STATUS VALUES IN time_entries ===");
  const statusRes = await pool.query("SELECT DISTINCT status FROM time_entries");
  console.log(statusRes.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

