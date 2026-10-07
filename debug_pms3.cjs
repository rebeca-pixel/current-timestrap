const { Pool } = require('./node_modules/pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function debug() {
  try {
    // Check the active status of software-dept projects
    const res = await pool.query(`
      SELECT p.project_code, p.title, p.status, p.start_date, p.end_date, p.progress,
             COALESCE(ARRAY_AGG(pd.department) FILTER (WHERE pd.department IS NOT NULL), ARRAY[]::text[]) as depts
      FROM projects p
      LEFT JOIN project_departments pd ON pd.project_id = p.id
      WHERE LOWER(pd.department) IN ('software developer', 'software developers', 'software')
      GROUP BY p.project_code, p.title, p.status, p.start_date, p.end_date, p.progress
      ORDER BY p.status, p.title
    `);
    
    const today = new Date().toISOString().split('T')[0];
    console.log('Today (IST approx):', today);
    console.log('\n=== Software dept projects with active status check ===');
    res.rows.forEach(r => {
      const endKey = r.end_date ? String(r.end_date).substring(0, 10) : null;
      const startKey = r.start_date ? String(r.start_date).substring(0, 10) : null;
      const doneStatuses = ['completed', 'complete', 'done', 'closed', 'cancelled', 'canceled'];
      const isStatusDone = doneStatuses.includes(String(r.status || '').toLowerCase().trim());
      const isProgressDone = !isNaN(Number(r.progress)) && Number(r.progress) >= 100;
      const isExpired = endKey && endKey < today;
      const isNotStarted = startKey && startKey > today;
      const isActive = !isStatusDone && !isProgressDone && !isExpired && !isNotStarted;
      
      console.log(
        ' ', (r.project_code||'').padEnd(20),
        '|', r.title.padEnd(40),
        '| status:', (r.status||'null').padEnd(12),
        '| progress:', String(r.progress||0).padEnd(5),
        '| end:', (endKey||'null').padEnd(12),
        '| ACTIVE:', isActive ? 'YES' : 'NO',
        isStatusDone ? '(status done)' : isProgressDone ? '(100%)' : isExpired ? '(EXPIRED '+endKey+')' : isNotStarted ? '(not started)' : ''
      );
    });
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
debug();
