import "dotenv/config";
import { pool } from "./server/db";

// Set SSL bypass for Postgres connection
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
  console.log("=== CHECKING DAILY PLANS & PLAN TASKS ===");
  try {
    // 1. Find employee
    const empRes = await pool.query("SELECT id, employee_code, name FROM employees WHERE employee_code = 'E0053'");
    if (empRes.rows.length === 0) {
      console.error("Employee E0053 not found");
      process.exit(1);
    }
    const emp = empRes.rows[0];
    console.log("Employee:", emp);

    // 2. Find daily plans
    const dpRes = await pool.query(
      "SELECT * FROM daily_plans WHERE employee_id = $1 AND date = '2026-06-19'",
      [emp.id]
    );
    console.log("Daily Plans:", dpRes.rows);

    if (dpRes.rows.length > 0) {
      const planId = dpRes.rows[0].id;
      // 3. Find plan tasks
      const ptRes = await pool.query(
        "SELECT * FROM plan_tasks WHERE plan_id = $1",
        [planId]
      );
      console.log("Plan Tasks count:", ptRes.rows.length);
      console.log("Plan Tasks details:");
      for (const row of ptRes.rows) {
        console.log({
          id: row.id,
          taskName: row.task_name,
          projectName: row.projectName,
          isDeviation: row.is_deviation,
          scheduleData: row.schedule_data
        });
      }
    }
  } catch (err: any) {
    console.error("Query failed:", err.message);
  }

  process.exit(0);
}

main().catch(console.error);
