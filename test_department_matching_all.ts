import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Department normalization
const normalizeDepartment = (dept: string): string => {
  const normalized = dept.toLowerCase().trim();
  const mappings: Record<string, string> = {
    'software': 'software',
    'software developers': 'software',
    'finance': 'finance',
    'purchase': 'purchase',
    'purchases': 'purchase',
    'hr': 'hr',
    'human resources': 'hr',
    'operations': 'operations',
    'operation': 'operations'
  };
  return mappings[normalized] || normalized;
};

const isDepartmentMatch = (userDept: string, projectDept: string): boolean => {
  return normalizeDepartment(userDept) === normalizeDepartment(projectDept);
};

// Test with different employee departments
async function testDepartmentMatching() {
  const { data: projects } = await supabase.from('Projects').select('*');
  console.log('PMS Projects by department:');

  const deptGroups: Record<string, string[]> = {};
  projects.forEach(p => {
    const dept = p.department || 'No Department';
    if (!deptGroups[dept]) deptGroups[dept] = [];
    deptGroups[dept].push(p.project_name);
  });

  Object.keys(deptGroups).forEach(dept => {
    console.log(`${dept}: ${deptGroups[dept].join(', ')}`);
  });

  console.log('\nTesting employee department matching:');

  const testEmployees = [
    { code: 'E0048', dept: 'Software', expected: 'Software Developers projects' },
    { code: 'E0041', dept: 'Finance', expected: 'No matches' },
    { code: 'E0032', dept: 'Operations', expected: 'Operations projects' }
  ];

  testEmployees.forEach(emp => {
    const matches = projects.filter(p => isDepartmentMatch(emp.dept, p.department));
    console.log(`${emp.code} (${emp.dept}) -> ${matches.length} projects: ${matches.map(p => p.project_name).join(', ') || 'None'}`);
  });
}

testDepartmentMatching();    