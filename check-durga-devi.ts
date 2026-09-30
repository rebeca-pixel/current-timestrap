import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

async function checkDurgaDevi() {
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log("=== Checking Durga Devi Account ===\n");

    // Get Durga Devi
    const result = await db.query(
      `SELECT id, employee_code, name, department, role, email FROM employees WHERE employee_code = 'E0048' OR name LIKE '%Durga%'`
    );
    const employees = result.rows;

    if (employees.length === 0) {
      console.log("❌ Durga Devi (E0048) not found!");
      console.log("\nAll employees:");
      const allResult = await db.query(`SELECT employee_code, name, department FROM employees`);
      allResult.rows.forEach((emp: any) => {
        console.log(`  ${emp.employee_code}: ${emp.name} | Dept: ${emp.department}`);
      });
      return;
    }

    const durgaDevi = employees[0];
    console.log("✅ Durga Devi Found:");
    console.log(`  ID: ${durgaDevi.id}`);
    console.log(`  Code: ${durgaDevi.employee_code}`);
    console.log(`  Name: ${durgaDevi.name}`);
    console.log(`  Department: ${durgaDevi.department}`);
    console.log(`  Role: ${durgaDevi.role}`);
    console.log(`  Email: ${durgaDevi.email}`);

    // Check if department is set                   
    if (!durgaDevi.department) {
      console.log("\n⚠️  Department is NOT set for Durga Devi!");
      console.log("This is why no tasks are showing - the API needs a department to filter projects.");
      return;
    }

    // Now test the full flow
    console.log(`\n=== Testing Task Availability for ${durgaDevi.department} ===\n`);

    const pmsPool = new Pool({
      connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL!,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    // Get projects
    const projectsResult = await pmsPool.query(
      `SELECT p.id, p.title, p.project_code FROM projects p LIMIT 5`
    );
    console.log(`Found ${projectsResult.rows.length} projects in PMS`);

    // Get tasks
    const tasksResult = await pmsPool.query(
      `SELECT pt.id, pt.task_name, pt.project_id, p.title, p.project_code
       FROM project_tasks pt
       LEFT JOIN projects p ON pt.project_id = p.id
       LIMIT 5`
    );
    console.log(`Found ${tasksResult.rows.length} tasks in PMS`);

    if (tasksResult.rows.length > 0) {
      console.log("\nSample tasks:");
      tasksResult.rows.forEach((task: any) => {
        console.log(`  - ${task.task_name}`);
        console.log(`    Project: ${task.title} (${task.project_code})`);
      });
    }

    await pmsPool.end();

    console.log(`\n=== To Test Manually ===`);
    console.log(`URL: http://localhost:5000/api/available-tasks?employeeId=${durgaDevi.id}`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await db.end();
  }
}

checkDurgaDevi();
