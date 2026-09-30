import 'dotenv/config';
import { pmsPool } from './server/pmsSupabase.ts';

async function run() {
  const r = await pmsPool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'google_calendar_accounts'`);
  console.log(r.rows);
  process.exit(0);
}
run();
