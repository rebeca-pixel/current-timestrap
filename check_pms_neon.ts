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

async function checkProjectsByDepartment() {
  try {
    console.log('🔍 Checking projects by department in PMS (Neon) database...');

    // Query all projects
    const result = await pmsPool.query('SELECT * FROM "Projects" ORDER BY project_name');
    const projects = result.rows;

    console.log(`📊 Found ${projects.length} projects total`);
    
    if (projects.length === 0) {
      console.log('⚠️ No projects found in database!');
      console.log('\n📋 Available tables:');
      const tablesResult = await pmsPool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      console.log(tablesResult.rows);
      await pmsPool.end();
      return;
    }

    // Check column names
    console.log('\n📋 Available columns in Projects table:');
    console.log(Object.keys(projects[0]));

    // Group projects by department
    const departments: Record<string, any[]> = {};
    projects.forEach(project => {
      const dept = project.department || project.departments || project.dept || 'No Department';
      const deptKey = JSON.stringify(dept);
      
      if (!departments[deptKey]) {
        departments[deptKey] = [];
      }
      departments[deptKey].push(project);
    });

    console.log('\n🏢 Projects by department:');
    Object.keys(departments).forEach(deptKey => {
      const dept = JSON.parse(deptKey);
      console.log(`\n📁 Department: "${JSON.stringify(dept)}" (${departments[deptKey].length} projects)`);
      departments[deptKey].slice(0, 5).forEach((project: any) => {
        console.log(`  - ${project.project_name} (${project.project_code})`);
      });
      if (departments[deptKey].length > 5) {
        console.log(`  ... and ${departments[deptKey].length - 5} more`);
      }
    });

    // Show first 3 projects with full details
    console.log('\n📄 Sample projects with full details:');
    projects.slice(0, 3).forEach((project: any) => {
      console.log(`\n${project.project_name}:`);
      console.log(JSON.stringify(project, null, 2));
    });

  } catch (err) {
    console.error('💥 Error:', err);
  } finally {
    await pmsPool.end();
  }
}

checkProjectsByDepartment();
