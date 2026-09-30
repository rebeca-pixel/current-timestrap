import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pmsDatabaseUrl = process.env.PMS_DATABASE_URL || process.env.DATABASE_URL!;

const pmsPool = new Pool({
  connectionString: pmsDatabaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testGetTasks() {
  try {
    console.log('🧪 Testing PMS getTasks with project_code\n');

    // Get all projects
    const projectsResult = await pmsPool.query('SELECT id, title, project_code FROM projects');
    const projects = projectsResult.rows;

    console.log(`📊 Testing with ${projects.length} projects:\n`);

    for (const project of projects) {
      const projectCode = project.project_code;
      
      console.log(`\n📌 Project: ${project.title} (${projectCode})`);
      console.log(`   Project ID (UUID): ${project.id}`);
      
      // Test the new query logic
      const query = `
        SELECT pt.* FROM project_tasks pt
        INNER JOIN projects p ON pt.project_id = p.id
        WHERE p.project_code = $1
        ORDER BY pt.task_name
      `;

      const result = await pmsPool.query(query, [projectCode]);
      const tasks = result.rows;

      console.log(`   Tasks found: ${tasks.length}`);
      
      if (tasks.length > 0) {
        tasks.forEach((task: any) => {
          console.log(`     ✅ ${task.task_name} (${task.status})`);
        });
      } else {
        console.log(`     ⚠️ No tasks found`);
      }
    }

    console.log('\n\n✅ Test complete!');

  } catch (err) {
    console.error('💥 Error:', err);
  } finally {
    await pmsPool.end();
  }
}

testGetTasks();
