import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

async function testAvailableTasks() {
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log("=== Testing Available Tasks Functionality ===\n");

    // Get an employee
    console.log("1. Fetching employees...");
    const employeeResult = await db.query(
      `SELECT id, employee_code, name, department, role FROM employees LIMIT 5`
    );
    const employees = employeeResult.rows;
    console.log(`Found ${employees.length} employees:`);
    employees.forEach((emp: any) => {
      console.log(
        `  - ${emp.name} (${emp.employee_code}) | Dept: ${emp.department} | Role: ${emp.role}`
      );
    });

    if (employees.length === 0) {
      console.log("⚠️ No employees found!");
      return;
    }

    const testEmployee = employees[0];

    // Get PMS projects for this department
    console.log(`\n2. Checking PMS projects for department: ${testEmployee.department}`);
    const pmsPool = new Pool({
      connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL!,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    const projectsResult = await pmsPool.query(
      `SELECT id, title, project_code FROM projects LIMIT 10`
    );
    const projects = projectsResult.rows;
    console.log(`Found ${projects.length} PMS projects:`);
    projects.forEach((proj: any) => {
      console.log(`  - ${proj.title} (${proj.project_code}) | ID: ${proj.id}`);
    });

    // Get tasks for each project
    console.log(`\n3. Checking PMS tasks...`);
    if (projects.length > 0) {
      const firstProject = projects[0];
      const tasksResult = await pmsPool.query(
        `SELECT pt.id, pt.task_name, pt.project_id, p.project_code, p.title 
         FROM project_tasks pt
         LEFT JOIN projects p ON pt.project_id = p.id
         LIMIT 10`
      );
      const tasks = tasksResult.rows;
      console.log(`Found ${tasks.length} PMS tasks:`);
      tasks.forEach((task: any) => {
        console.log(
          `  - ${task.task_name} | Project: ${task.title} (${task.project_code})`
        );
      });
    }

    console.log(
      `\n4. API Endpoint Test URL: /api/available-tasks?employeeId=${testEmployee.id}`
    );
    console.log(
      `   Employee: ${testEmployee.name} | Department: ${testEmployee.department}`
    );

    await pmsPool.end();
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await db.end();
  }
}

testAvailableTasks();
