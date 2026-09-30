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
        const tables = ['projects', 'project_tasks'];

        for (const tableName of tables) {
            const colResult = await pmsPool.query(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

            console.log(`\n${tableName}:`);
            colResult.rows.forEach((col: any) => {
                console.log(`  - ${col.column_name} (${col.data_type})`);
            });
        }

    } catch (err) {
        console.error('💥 Error:', err);
    } finally {
        await pmsPool.end();
    }
}

checkDatabase();
