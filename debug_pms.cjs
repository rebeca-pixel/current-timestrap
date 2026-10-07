const { Pool } = require('./node_modules/pg');
require('dotenv').config();

const pool = new Pool({ 
  connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function debug() {
  try {
    // 1. Find E0046 in PMS employees
    const empRes = await pool.query(
      "SELECT id, emp_code, name, department FROM employees WHERE LOWER(TRIM(emp_code::text)) = 'e0046'"
    );
    console.log('=== E0046 in PMS employees ===');
    console.log(JSON.stringify(empRes.rows, null, 2));
    
    if (empRes.rows.length > 0) {
      const emp = empRes.rows[0];
      const empId = emp.id;
      console.log('\nEmployee Dept in PMS:', emp.department);
      
      // 2. Projects assigned via tasks
      const assignedRes = await pool.query(
        `SELECT DISTINCT p.id, p.title, p.project_code FROM projects p
         INNER JOIN project_tasks pt ON pt.project_id = p.id
         LEFT JOIN task_members tm ON pt.id = tm.task_id
         WHERE tm.employee_id = $1 OR pt.task_owner_id = $1 OR pt.assigner_id = $1`,
        [empId]
      );
      console.log('\n=== Projects assigned to E0046 via task_members ===');
      assignedRes.rows.forEach(r => console.log(' ', r.project_code, '|', r.title));
    }
    
    // 3. All distinct department names in project_departments
    const depts = await pool.query(
      'SELECT DISTINCT department FROM project_departments ORDER BY department'
    );
    console.log('\n=== All department values in project_departments ===');
    depts.rows.forEach(r => console.log('  "' + r.department + '"'));
    
    // 4. All projects with their departments
    const projs = await pool.query(
      `SELECT p.project_code, p.title, p.status, 
              COALESCE(ARRAY_AGG(pd.department) FILTER (WHERE pd.department IS NOT NULL), ARRAY[]::text[]) as depts 
       FROM projects p 
       LEFT JOIN project_departments pd ON pd.project_id = p.id 
       GROUP BY p.project_code, p.title, p.status 
       ORDER BY p.title`
    );
    console.log('\n=== All projects with departments ===');
    projs.rows.forEach(r => {
      console.log(' ', (r.project_code||'N/A').padEnd(15), '|', (r.title||'').padEnd(40), '| status:', (r.status||'null').padEnd(15), '| depts:', JSON.stringify(r.depts));
    });
    
  } catch (err) {
    console.error('Error:', err.message, err.stack);
  } finally { 
    await pool.end(); 
  }
}

debug();
