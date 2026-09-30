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

// Copy the normalization logic from pmsSupabase.ts
const normalizeDepartment = (dept: string): string => {
  const normalized = dept.toLowerCase().trim();
  const departmentMappings: Record<string, string> = {
    'software': 'software',
    'software developers': 'software',
    'software developer': 'software',
    'finance': 'finance',
    'purchase': 'purchase',
    'purchases': 'purchase',
    'hr': 'hr',
    'hr & admin': 'hr',
    'hr and admin': 'hr',
    'human resources': 'hr',
    'human resources & admin': 'hr',
    'operations': 'operations',
    'operation': 'operations',
    'marketing': 'marketing',
    'sales': 'sales',
    'admin': 'admin',
    'administration': 'admin',
    'it': 'it',
    'information technology': 'it',
    'qa': 'qa',
    'quality assurance': 'qa',
    'testing': 'qa',
    // include singular presale form as well
    'presale': 'presales',
    'presales': 'presales',
    'pre-sales': 'presales',  
    'it support': 'it',
    'support': 'it'
  };

  return departmentMappings[normalized] || normalized;
};

const isDepartmentMatch = (userDept: string, projectDept: string): boolean => {
  return normalizeDepartment(userDept) === normalizeDepartment(projectDept);
};
                
async function testGetProjects() {
  try {
    console.log('🧪 Testing PMS getProjects with departments\n');

    // Test query with new SQL
    const projectsResult = await pmsPool.query(`
      SELECT 
        p.id,
        p.title as project_name,        
        p.project_code,
        p.client_name,  
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.progress as progress_percentage,
        p.created_at,
        p.updated_at
      FROM projects p    
      ORDER BY p.title
    `);

    const projects = projectsResult.rows;

    // Get all department assignments
    const deptResult = await pmsPool.query(`
      SELECT project_id, department FROM project_departments
    `);

    // Map departments to projects
    const projectDepts: Record<string, string[]> = {};
    deptResult.rows.forEach((row: any) => {
      const projId = row.project_id;  
      if (!projectDepts[projId]) {     
        projectDepts[projId] = [];
      }
      projectDepts[projId].push(row.department);
    });

    // Enrich projects with their departments
    const enrichedProjects = projects.map((p: any) => ({
      ...p,
      department: projectDepts[p.id] || []
    }));

    console.log(`✅ Found ${enrichedProjects.length} projects:\n`);
    
    enrichedProjects.forEach((project: any) => {
      console.log(`📌 ${project.project_name} (${project.project_code})`);
      console.log(`   Departments: ${Array.isArray(project.department) ? project.department.join(', ') : 'none'}`);
      console.log();   
    });
    
    // Test filtering    
    console.log('\n\n🔍 Testing department filtering:\n');
    
    const testDepts = ['Software Developers', 'software', 'HR', 'Purchase', 'IT Support', 'Presales', 'presale'];
    
    testDepts.forEach(userDept => {
      console.log(`Testing user department: "${userDept}"`);
      const filtered = enrichedProjects.filter((project: any) => {
        let projectDepts: string[] = [];
        
        if (project.department && Array.isArray(project.department)) {
          projectDepts = project.department;
        } else if (typeof project.department === 'string') {
          projectDepts = [project.department];
        }         

        const isMatch = projectDepts.some(dept => isDepartmentMatch(userDept, dept));
           
        if (isMatch) {
          console.log(`  ✅ ${project.project_name} - matches dept: ${projectDepts.join(', ')}`);
        }
        
        return isMatch;
      });
                      
      console.log(`  Total matching: ${filtered.length} projects\n`);
    });

  } catch (err) {
    console.error('💥 Error:', err);
  } finally {  
    await pmsPool.end();
  }
}      
  
testGetProjects();    
               