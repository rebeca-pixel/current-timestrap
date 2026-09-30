import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkProjectsByDepartment() {
  try {
    console.log('🔍 Checking projects by department in PMS database...');

    // Get all projects and group by department
    const { data: projects, error } = await supabase
      .from('Projects')
      .select('*');

    if (error) {
      console.error('❌ Error fetching projects:', error);
      return;
    }

    console.log(`📊 Found ${projects.length} projects total`);

    // Group projects by department
    const departments = {};
    projects.forEach(project => {
      const dept = project.department || 'No Department';
      if (!departments[dept]) {
        departments[dept] = [];
      }
      departments[dept].push(project);
    });

    console.log('\n🏢 Projects by department:');
    Object.keys(departments).forEach(dept => {
      console.log(`\n📁 Department: "${dept}" (${departments[dept].length} projects)`);
      departments[dept].forEach(project => {
        console.log(`  - ${project.project_name} (${project.project_code})`);
      });
    });

    // Check if there are projects for "Software" department (E0048's department)
    const softwareProjects = projects.filter(p => p.department === 'Software' || p.department === 'software');
    console.log(`\n🎯 Projects for "Software" department: ${softwareProjects.length}`);
    if (softwareProjects.length === 0) {
      console.log('⚠️ No projects found for "Software" department. E0048 will see no projects.');
    }

  } catch (err) {
    console.error('💥 Error:', err);
  }
}

checkProjectsByDepartment();