import { pmsPool } from './server/pmsSupabase';

async function test() {
  try {
    const res = await pmsPool.query(`SELECT date FROM calendar_events LIMIT 1`);
    console.log('Row 0:', res.rows[0]);
    console.log('Type of date:', typeof res.rows[0].date);
    if (res.rows[0].date instanceof Date) {
      console.log('Is Date object:', true);
    }
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    process.exit();
  }
}

test();
