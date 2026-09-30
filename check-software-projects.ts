import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

async function checkSoftwareProjects() {
  const pmsPool = new Pool({
    connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL!,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log("=== Checking Software Department Projects ===\n");

    // Check project_departments table
    console.log("1. Checking project_departments table...");
    const deptsResult = await pmsPool.query(
      `SELECT project_id, department FROM project_departments WHERE LOWER(department) LIKE '%software%' LIMIT 10`
    );
    console.log(`Found ${deptsResult.rows.length} entries for Software department:`);
    deptsResult.rows.forEach((row: any, idx: number) => {
      console.log(`  ${idx + 1}. Project ID: ${row.project_id}, Department: ${row.department}`);
    });

    // Get the actual projects for these
    if (deptsResult.rows.length > 0) {
      console.log("\n2. Getting project details...");
      const projectIds = deptsResult.rows.map(r => `'${r.project_id}'`).join(",");
      const projectsResult = await pmsPool.query(
        `SELECT id, title, project_code FROM projects WHERE id IN (${projectIds})`
      );
      console.log(`Found ${projectsResult.rows.length} projects:`);
      projectsResult.rows.forEach((p: any) => {
        console.log(`  - ${p.title} (${p.project_code}) | ID: ${p.id}`);
      });

      // Now get tasks for these projects
      console.log("\n3. Getting tasks for these projects...");
      for (const project of projectsResult.rows) {
        const tasksResult = await pmsPool.query(
          `SELECT task_name FROM project_tasks WHERE project_id = $1 LIMIT 3`,
          [project.id]
        );
        console.log(`\n  Project: ${project.title} (${project.project_code})`);
        if (tasksResult.rows.length > 0) {
          tasksResult.rows.forEach((task: any) => {
            console.log(`    - ${task.task_name}`);
          });
        } else {
          console.log(`    ⚠️ No tasks found`);
        }
      }
    } else {
      console.log("⚠️ No Software department projects found!");
      console.log("\n4. Checking all departments in project_departments...");
      const allDeptsResult = await pmsPool.query(
        `SELECT DISTINCT department FROM project_departments ORDER BY department`
      );
      console.log("Available departments:");
      allDeptsResult.rows.forEach((row: any) => {
        console.log(`  - ${row.department}`);
      });
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pmsPool.end();
  }
}

checkSoftwareProjects();
