import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pmsDatabaseUrl = process.env.PMS_DATABASE_URL || process.env.DATABASE_URL!;

const pmsPool = new Pool({
  connectionString: pmsDatabaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkDatabase() {
  try {
    console.log('🔍 Checking PMS database structure...\n');

    // Get all tables
    const tablesResult = await pmsPool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);  
    
    console.log('📋 Available tables:');
    tablesResult.rows.forEach((row: any) => {
      console.log(`  - ${row.table_name}`);
    });

    // For each table, get column info
    console.log('\n📊 Table structures:');
    for (const row of tablesResult.rows) {
      const tableName = row.table_name;    
      const colResult = await pmsPool.query(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position                                    
      `, [tableName]); 
                             
      console.log(`\n${tableName}:`);
      colResult.rows.forEach((col: any) => {
        console.log(`  - ${col.column_name} (${col.data_type})`);
      });

      // Get row count
      const countResult = await pmsPool.query(`SELECT COUNT(*) FROM "${tableName}"`);
      console.log(`  Total rows: ${countResult.rows[0].count}`);
    }

    console.log('\n✅ Database scan complete');

  } catch (err) {
    console.error('💥 Error:', err);
  } finally {
    await pmsPool.end();
  }
}

checkDatabase();
