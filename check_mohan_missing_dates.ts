import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://bmigbiajnhhknltuvrso.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtaWdiaWFqbmhoa25sdHV2cnNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTMxMzcwOSwiZXhwIjoyMDg2ODg5NzA5fQ.BDSRMDIPZfDyZO_VynCGU4t943J4FgGXPwUbPyQ4BOM'
);

async function run() {
  const dates = ['2026-05-04', '2026-05-07', '2026-05-13', '2026-05-16', '2026-05-28', '2026-05-29'];

  const { data, error } = await supabase
    .from('time_entries')
    .select('date, status, employee_code')
    .eq('employee_code', 'E0041')
    .in('date', dates)
    .order('date');

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log(`\n📋 Query Result — E0041 on 6 specific dates:\n`);
  console.log(`Total rows returned: ${data.length}`);
  console.log('');

  if (data.length === 0) {
    console.log('✅ 0 rows → These dates have NO entries in the DB at all (not even draft).');
    console.log('   ARIA is correct in showing them as "not submitted". Check ARIA logic.');
  } else {
    console.table(data.map(r => ({ date: r.date, status: r.status, employee_code: r.employee_code })));
    const statuses = [...new Set(data.map((r: any) => r.status))];
    console.log(`\nUnique statuses found: ${statuses.join(', ')}`);
    if (statuses.includes('draft')) {
      console.log('⚠️  DRAFT entries found → These may be hidden by the status != draft filter');
    }
  }
}

run().catch(console.error);
