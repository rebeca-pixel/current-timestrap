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

async function debugE0032Projects() {
  try {
    console.log("🔍 Debugging E0032 Sivaram's projects visibility issue\n");
    
    // Step 1: Get E0032's employee ID from PMS employees table
    console.log("1️⃣ Finding E0032 employee ID in PMS...");
    const empResult = await pmsPool.query(
      `SELECT id, emp_code, name FROM employees WHERE LOWER(emp_code) = LOWER('E0032')`
    );
    
    if (empResult.rows.length === 0) {
      console.log("❌ E0032 not found in PMS employees table!");
      console.log("\nAvailable employees sample:");
      const allEmps = await pmsPool.query(`SELECT id, emp_code, name FROM employees LIMIT 5`);
      console.log(JSON.stringify(allEmps.rows, null, 2));
      return;
    }
    
    const e0032Employee = empResult.rows[0];
    console.log(`✅ Found: ${e0032Employee.name} (${e0032Employee.emp_code}) | ID: ${e0032Employee.id}`);
    
    // Step 2: Check if projects table has created_by_employee_id column
    console.log("\n2️⃣ Checking projects table schema...");
    const schemaResult = await pmsPool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'projects'
      ORDER BY ordinal_position
    `);
    
    console.log("Projects table columns:");
    const hasCreatedBy = schemaResult.rows.some((col: any) => col.column_name === 'created_by_employee_id');
    schemaResult.rows.forEach((col: any) => {
      console.log(`  - ${col.column_name} (${col.data_type})`);
    });
    
    if (!hasCreatedBy) {
      console.log("\n⚠️ WARNING: 'created_by_employee_id' column NOT found in projects table!");
      console.log("   This is the issue - projects created by E0032 cannot be identified!");
    }
    
    // Step 3: Get all projects created by E0032
    console.log("\n3️⃣ Looking for projects created by E0032...");
    
    let projectsQuery = `
      SELECT id, title, project_code, created_by_employee_id, status
      FROM projects
      WHERE created_by_employee_id = $1
      ORDER BY title
    `;
    
    try {
      const projectsResult = await pmsPool.query(projectsQuery, [e0032Employee.id]);
      console.log(`Found ${projectsResult.rows.length} projects created by E0032:`);
      
      if (projectsResult.rows.length > 0) {
        projectsResult.rows.forEach((proj: any) => {
          console.log(`  - ${proj.title} (${proj.project_code}) | ID: ${proj.id} | Status: ${proj.status}`);
        });
      } else {
        console.log("  ❌ No projects found with created_by_employee_id = E0032's ID");
      }
    } catch (err) {
      console.log(`  ❌ Error: ${(err as any).message}`);
    }
    
    // Step 4: Test the actual query that getProjects uses
    console.log("\n4️⃣ Testing the actual getProjects query for E0032...");
    const testQuery = `
      SELECT DISTINCT
        p.id,
        p.title as project_name,
        p.project_code,
        p.status,
        p.created_by_employee_id
      FROM projects p
      LEFT JOIN project_tasks pt ON p.id = pt.project_id
      LEFT JOIN task_members tm ON pt.id = tm.task_id
      LEFT JOIN employees e ON tm.employee_id = e.id
      LEFT JOIN project_departments pd ON p.id = pd.project_id
      WHERE (
        LOWER(e.emp_code) = LOWER($1)
        OR p.created_by_employee_id = (SELECT id FROM employees WHERE LOWER(emp_code) = LOWER($1))
        OR LOWER(pd.department) = ANY (
          SELECT LOWER(department) FROM employees WHERE LOWER(emp_code) = LOWER($1)
        )
      )
      ORDER BY p.title
    `;
    
    try {
      const result = await pmsPool.query(testQuery, ['E0032']);
      console.log(`Query returned ${result.rows.length} projects for E0032`);
      if (result.rows.length > 0) {
        console.log("✅ Projects visible through getProjects query:");
        result.rows.forEach((proj: any) => {
          console.log(`  - ${proj.project_name} (${proj.project_code})`);
        });
      } else {
        console.log("❌ getProjects query returned NO projects for E0032");
      }
    } catch (err) {
      console.log(`  ❌ Error in query: ${(err as any).message}`);
    }
    
    // Step 5: Check project departments for any E0032 projects
    console.log("\n5️⃣ Checking project_departments for E0032 related projects...");
    try {
      // First get E0032's department
      const deptResult = await pmsPool.query(
        `SELECT department FROM employees WHERE LOWER(emp_code) = LOWER('E0032') LIMIT 1`
      );
      
      if (deptResult.rows.length > 0) {
        const e0032Dept = deptResult.rows[0].department;
        console.log(`E0032's department: ${e0032Dept}`);
        
        // Find projects in that department
        const deptProjectsResult = await pmsPool.query(`
          SELECT DISTINCT p.id, p.title, p.project_code, pd.department
          FROM projects p
          LEFT JOIN project_departments pd ON p.id = pd.project_id
          WHERE LOWER(pd.department) = LOWER($1)
          ORDER BY p.title
        `, [e0032Dept]);
        
        console.log(`Found ${deptProjectsResult.rows.length} projects in department "${e0032Dept}"`);
        if (deptProjectsResult.rows.length > 0) {
          deptProjectsResult.rows.slice(0, 5).forEach((proj: any) => {
            console.log(`  - ${proj.title} (${proj.project_code})`);
          });
        }
      }
    } catch (err) {
      console.log(`  ❌ Error: ${(err as any).message}`);
    }
    
    console.log("\n✅ Debug complete!");
    
  } catch (err) {
    console.error('💥 Error:', err);
  } finally {
    await pmsPool.end();
  }
}

debugE0032Projects();
