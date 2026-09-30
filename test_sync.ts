import { upsertPlanCalendarEvent, getCalendarEvents } from './server/Pmscalendarevents';

async function test() {
  try {
    console.log('Testing upsertPlanCalendarEvent...');
    const res = await upsertPlanCalendarEvent('E0046', { 
      taskId: 'test-123', 
      title: 'Test Task', 
      date: '2026-07-23', 
      startTime: '10:00', 
      endTime: '11:00' 
    } as any, { matchBySlot: true });
    
    console.log('\nResult of upsert:', res);

    console.log('\nTesting getCalendarEvents...');
    const events = await getCalendarEvents('E0046', '2026-07-23');
    console.log('Result of getCalendarEvents:', events);

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    process.exit();
  }
}

test();
