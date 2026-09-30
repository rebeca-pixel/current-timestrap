process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import dotenv from "dotenv";
dotenv.config();
import pkg from "pg";
const { Pool } = pkg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const pmsPool = new Pool({
  connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const empRes = await db.query(
    "SELECT id, employee_code, name, department, role, email FROM employees WHERE name ILIKE '%durga%' OR name ILIKE '%thurga%'"
  );
  console.log("=== EMPLOYEES MATCHING DURGA OR THURGA ===");
  console.log(JSON.stringify(empRes.rows, null, 2));

  for (const emp of empRes.rows) {
    const pmsRes = await pmsPool.query(
      `SELECT DISTINCT p.title as project_name, p.project_code
       FROM projects p
       WHERE LOWER(p.status) = 'in progress'
         AND (
           EXISTS (
             SELECT 1 FROM project_tasks pt
             INNER JOIN task_members tm ON pt.id = tm.task_id
             INNER JOIN employees e ON tm.employee_id = e.id
             WHERE pt.project_id = p.id AND LOWER(e.emp_code) = LOWER($1)
           )
           OR
           EXISTS (
             SELECT 1 FROM employees e
             WHERE e.id = p.created_by_employee_id AND LOWER(e.emp_code) = LOWER($1)
           )
           OR
           EXISTS (
             SELECT 1 FROM project_departments pd
             INNER JOIN employees e ON LOWER(e.department) = LOWER(pd.department)
             WHERE pd.project_id = p.id AND LOWER(e.emp_code) = LOWER($1)
           )
         )`,
      [emp.employee_code]
    );
    console.log(`\n=== ACTIVE PROJECTS FOR ${emp.name} (${emp.employee_code}) ===`);
    console.log(JSON.stringify(pmsRes.rows, null, 2));
    console.log(`Total active projects count: ${pmsRes.rows.length}`);
  }

  await db.end();
  await pmsPool.end();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
