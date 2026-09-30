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

async function checkProjects() {
  try {
    console.log('🔍 Checking projects and their departments...\n');

    // Get all projects
    const projectsResult = await pmsPool.query('SELECT * FROM projects');
    const projects = projectsResult.rows;

    console.log(`📊 Found ${projects.length} projects total\n`);
    
    projects.forEach(project => {
      console.log(`📌 Project: ${project.title} (${project.project_code})`);
      console.log(`   ID: ${project.id}`);
      console.log(`   Status: ${project.status}`);
    });

    // Get all department assignments
    console.log('\n\n🏢 Department Assignments:');
    const deptResult = await pmsPool.query(`
      SELECT p.title, p.project_code, pd.department 
      FROM projects p
      LEFT JOIN project_departments pd ON p.id = pd.project_id
      ORDER BY p.title
    `);

    const depts: Record<string, string[]> = {};
    deptResult.rows.forEach((row: any) => {
      if (!depts[row.project_code]) {
        depts[row.project_code] = [];
      }
      if (row.department) {
        depts[row.project_code].push(row.department);
      }
    });

    Object.keys(depts).forEach(code => {
      console.log(`\n${code}:`);
      console.log(`  Departments: ${depts[code].length > 0 ? depts[code].join(', ') : 'NONE ASSIGNED'}`);
    });

    // Check if there are projects without departments
    console.log('\n\n⚠️  Projects without department assignments:');
    const noDeptResult = await pmsPool.query(`
      SELECT DISTINCT p.title, p.project_code
      FROM projects p
      LEFT JOIN project_departments pd ON p.id = pd.project_id
      WHERE pd.department IS NULL
    `);

    if (noDeptResult.rows.length === 0) {
      console.log('✅ All projects have departments assigned');
    } else {
      noDeptResult.rows.forEach((row: any) => {
        console.log(`  - ${row.title} (${row.project_code})`);
      });
    }

  } catch (err) {
    console.error('💥 Error:', err);
  } finally {
    await pmsPool.end();
  }
}

checkProjects();
