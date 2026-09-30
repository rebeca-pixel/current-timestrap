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

async function checkTasks() {
  try {
    console.log('🔍 Checking tasks in PMS database...\n');

    // Get all projects
    const projectsResult = await pmsPool.query('SELECT id, title, project_code FROM projects');
    const projects = projectsResult.rows;

    console.log(`📊 Projects in database (${projects.length}):`);
    projects.forEach((p: any) => {
      console.log(`  - ${p.title} (${p.project_code}) | ID: ${p.id}`);
    });

    // Get all tasks
    console.log('\n📋 Tasks in database:');
    const tasksResult = await pmsPool.query(`
      SELECT 
        pt.id,
        pt.project_id,
        pt.task_name,
        pt.description,
        pt.status,
        p.title as project_title,
        p.project_code
      FROM project_tasks pt
      LEFT JOIN projects p ON pt.project_id = p.id
      ORDER BY pt.project_id, pt.task_name
    `);

    const tasks = tasksResult.rows;
    console.log(`Total tasks: ${tasks.length}\n`);

    if (tasks.length === 0) {
      console.log('⚠️ No tasks found!');
    } else {
      tasks.forEach((task: any) => {
        console.log(`📌 ${task.task_name}`);
        console.log(`   Project: ${task.project_title} (${task.project_code})`);
        console.log(`   Project ID: ${task.project_id}`);
        console.log(`   Status: ${task.status}`);
        console.log();
      });
    }

    // Group tasks by project
    console.log('\n\n🏢 Tasks grouped by project:');
    const tasksByProject: Record<string, any[]> = {};
    tasks.forEach((task: any) => {
      const projectKey = task.project_code || 'unknown';
      if (!tasksByProject[projectKey]) {
        tasksByProject[projectKey] = [];
      }
      tasksByProject[projectKey].push(task);
    });

    Object.keys(tasksByProject).forEach(projectCode => {
      console.log(`\n${projectCode}:`);
      console.log(`  Tasks: ${tasksByProject[projectCode].length}`);
      tasksByProject[projectCode].forEach((task: any) => {
        console.log(`    - ${task.task_name} (${task.status})`);
      });
    });

    // Check for projects without tasks
    console.log('\n\n⚠️ Projects without tasks:');
    const projectsWithoutTasks = projects.filter(p => !tasksByProject[p.project_code]);
    if (projectsWithoutTasks.length === 0) {
      console.log('✅ All projects have tasks');
    } else {
      projectsWithoutTasks.forEach((p: any) => {
        console.log(`  - ${p.title} (${p.project_code})`);
      });
    }

  } catch (err) {
    console.error('💥 Error:', err);
  } finally {
    await pmsPool.end();
  }
}

checkTasks();
