process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://postgres.bmigbiajnhhknltuvrso:Durgadevi%4067@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require',
});

async function run() {
  const client = await pool.connect();
  try {
    const empId = '2746b875-444f-4f74-94a6-16c98808c102';

    // Test: Does the submitted CTE find June 1 when using employee_id?
    console.log('\n--- submitted CTE test for employee_id ---');
    const res1 = await client.query(`
      SELECT DISTINCT date AS sub_date FROM time_entries
      WHERE employee_id = $1
        AND date >= $2::text
        AND date <= $3::text
        AND status != 'draft'
      ORDER BY sub_date
    `, [empId, '2026-06-01', '2026-06-30']);
    console.log('submitted dates via employee_id:', res1.rows.map((r: any) => r.sub_date));

    // Check what the date column value looks like for June 1
    console.log('\n--- Raw date column for Jun 1 ---');
    const res2 = await client.query(`
      SELECT date, length(date::text) as len, date = '2026-06-01' as exact_match
      FROM time_entries
      WHERE employee_id = $1 AND date = '2026-06-01'
      LIMIT 1
    `, [empId]);
    console.log('Raw row:', res2.rows[0]);

    // Full CTE debug — print intermediate CTEs
    console.log('\n--- Full CTE step by step ---');
    const res3 = await client.query(`
      WITH
      working_days AS (
        SELECT TO_CHAR(
          generate_series('2026-06-01'::timestamp, LEAST('2026-06-30'::timestamp, CURRENT_DATE::timestamp), '1 day'::interval),
          'YYYY-MM-DD'
        ) AS work_date
      ),
      filtered_working_days AS (
        SELECT work_date FROM working_days WHERE EXTRACT(DOW FROM work_date::date) != 0
      ),
      submitted AS (
        SELECT DISTINCT date AS sub_date FROM time_entries
        WHERE employee_id = $1
          AND date >= '2026-06-01'::text AND date <= '2026-06-30'::text
          AND status != 'draft'
      )
      SELECT fwd.work_date, s.sub_date, 
        CASE WHEN s.sub_date IS NOT NULL THEN 'submitted' ELSE 'not_submitted' END AS day_status
      FROM filtered_working_days fwd
      LEFT JOIN submitted s ON s.sub_date = fwd.work_date
      ORDER BY fwd.work_date
    `, [empId]);

    console.log('All rows:');
    console.table(res3.rows.map((r: any) => ({ date: r.work_date, sub: r.sub_date, status: r.day_status })));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
