import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkSchema() {
  console.log('Checking PMS database schema...');

  // Check Projects table
  const { data: projects, error: projError } = await supabase.from('Projects').select('*').limit(1);
  if (projError) {
    console.log('Projects table error:', projError.message);
  } else if (projects && projects.length > 0) {
    console.log('Projects table columns:', Object.keys(projects[0]));
    console.log('Sample project:', projects[0]);
  }

  // Check for project_departments or similar table
  const possibleTables = ['project_departments', 'ProjectDepartments', 'project_dept', 'departments_projects'];
  for (const table of possibleTables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (!error && data) {
        console.log(`Found table: ${table}`);
        console.log('Columns:', Object.keys(data[0]));
        console.log('Sample:', data[0]);
      }
    } catch (e) {
      // Table doesn't exist
    }
  }
}

checkSchema().catch(console.error);