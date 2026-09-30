import { getLMSHours, lmsPool } from './server/lmsSupabase.js';

async function testLMS() {
  console.log('🚀 Starting LMS Integration Test...');

  const testCases = [
    { employeeCode: 'E0000', date: '2026-03-14', description: 'Test Employee from screenshot' },
    { employeeCode: 'E0047', date: '2025-02-14', description: 'Employee with potential permission' }
  ];

  for (const tc of testCases) {
    console.log(`\n--- Testing: ${tc.description} (${tc.employeeCode} on ${tc.date}) ---`);
    try {
      const data = await getLMSHours(tc.employeeCode, tc.date);
      console.log('Result:', JSON.stringify(data, null, 2));
      
      if (data.totalLMSHours > 0) {
        console.log(`✅ Success: Found ${data.totalLMSHours}h of LMS data.`);
      } else {
        console.log('ℹ️ No LMS data found for this case.');
      }
    } catch (error) {
      console.error('❌ Test failed:', error);
    }
  }

  await lmsPool.end();
  console.log('\n🏁 Tests completed.');
}

testLMS();
