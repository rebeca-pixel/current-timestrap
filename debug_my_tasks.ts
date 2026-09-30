process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pmsPool = new Pool({
  connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  try {
    // Get employee E0001
    console.log("=== GETTING EMPLOYEE E0001 ===");
    const empRes = await db.query(
      "SELECT id, employee_code, name, department FROM employees WHERE employee_code = 'E0001'"
    );
    console.log("Employee:", empRes.rows[0]);
    const empCode = empRes.rows[0]?.employee_code;
    const empId = empRes.rows[0]?.id;

    // Check project_tasks columns
    console.log("\n=== PROJECT_TASKS COLUMNS ===");
    const colRes = await pmsPool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'project_tasks' ORDER BY ordinal_position`
    );
    console.log("Columns:", colRes.rows.map((r: any) => `${r.column_name} (${r.data_type})`));

    // Check project_tasks sample
    console.log("\n=== PROJECT_TASKS SAMPLE ===");
    const tasksRes = await pmsPool.query(
      "SELECT id, task_name FROM project_tasks LIMIT 5"
    );
    console.log("Sample tasks:", tasksRes.rows);

    // Check task_members data
    console.log("\n=== TASK_MEMBERS DATA ===");
    const membersRes = await pmsPool.query(
      "SELECT * FROM task_members LIMIT 10"
    );
    console.log("Sample task_members:", membersRes.rows);

    // Check if task_members rows join with employees
    console.log("\n=== TASK_MEMBERS WITH EMPLOYEE INFO ===");
    const joinRes = await pmsPool.query(
      `SELECT tm.task_id, tm.employee_id, e.emp_code, e.name
       FROM task_members tm
       LEFT JOIN employees e ON tm.employee_id = e.id
       LIMIT 10`
    );
    console.log("Task members with employee info:", joinRes.rows);

    // Check if E0001 has any tasks assigned via assignee field
    console.log(`\n=== CHECKING FOR assignee COLUMN ===`);
    const assigneeColRes = await pmsPool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'project_tasks' AND column_name ILIKE '%assign%'`
    );
    console.log("Assignee-related columns:", assigneeColRes.rows.map((r: any) => r.column_name));

    // Check if E0001 has any tasks in task_members
    console.log(`\n=== TASKS IN task_members FOR EMPLOYEE ${empCode} ===`);
    const tmRes = await pmsPool.query(
      `SELECT pt.id, pt.task_name, tm.employee_id, e.emp_code
       FROM project_tasks pt
       INNER JOIN task_members tm ON pt.id = tm.task_id
       INNER JOIN employees e ON tm.employee_id = e.id
       WHERE LOWER(TRIM(e.emp_code)) = LOWER(TRIM($1))`,
      [empCode]
    );
    console.log(`Tasks in task_members for '${empCode}':`, tmRes.rows);

    // ==== RUN getDepartmentTasks QUERY ====
    console.log(`\n=== RUNNING getDepartmentTasks QUERY ===`);
    
    // First check projects table columns
    const projColRes = await pmsPool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'projects' ORDER BY ordinal_position`
    );
    console.log("Projects table columns:", projColRes.rows.slice(0, 15).map((r: any) => `${r.column_name} (${r.data_type})`));

    const dept = empRes.rows[0]?.department || "presales"; // E0001 is in Admin
    
    // Get projects in department - check what field contains department info
    const projRes = await pmsPool.query(
      `SELECT DISTINCT id, project_code, project_name FROM projects LIMIT 5`
    );
    console.log(`Sample projects:`, projRes.rows);

    const projectIds = projRes.rows.map((r: any) => r.id);

    if (projectIds.length > 0) {
      // Run getDepartmentTasks-like query (without checking assignee/assigned_to)
      let query = `
        SELECT DISTINCT pt.*, pt.schedule_type, pt.schedule_data FROM project_tasks pt
        INNER JOIN projects p ON pt.project_id = p.id
        WHERE pt.project_id = ANY($1)
          AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
          AND EXISTS (
            SELECT 1 FROM task_members tm 
            INNER JOIN employees e ON tm.employee_id = e.id 
            WHERE tm.task_id = pt.id 
            AND LOWER(TRIM(e.emp_code)) = LOWER(TRIM($2))
          )
        ORDER BY pt.task_name
      `;
      const result = await pmsPool.query(query, [projectIds, empCode]);
      console.log(`\nTasks for ${empCode} in my-tasks view:`, result.rows.length);
      if (result.rows.length > 0) {
        console.log("Sample tasks:", result.rows.slice(0, 2).map((t: any) => ({id: t.id, task_name: t.task_name})));
      }
    }

    await db.end();
    await pmsPool.end();
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
