import pkg from 'pg';
const { Pool } = pkg;

const lmsDatabaseUrl = 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji@13@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: lmsDatabaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function explore() {
  try {
    console.log('Connecting to LMS database...');
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables in LMS database:', tables.rows.map(r => r.table_name));

    for (const table of tables.rows) {
      const name = table.table_name;
      if (name.includes('leave') || name.includes('permission') || name.includes('request') || name.includes('employee')) {
        console.log(`\nColumns in ${name}:`);
        const columns = await pool.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = $1
        `, [name]);
        console.table(columns.rows);
        
        // Sample data
        const sample = await pool.query(`SELECT * FROM ${name} LIMIT 5`);
        console.log(`Sample data from ${name}:`);
        console.table(sample.rows);
      }
    }
  } catch (err) {
    console.error('Error exploring LMS database:', err);
  } finally {
    await pool.end();
  }
}

explore();
