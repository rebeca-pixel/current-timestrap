import { pool } from "./server/db";

async function checkLocalSchema() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'time_entries'
        `);
        console.log("Local time_entries columns:");
        res.rows.forEach(col => {
            console.log(`  - ${col.column_name} (${col.data_type})`);
        });
    } catch (err) {
        console.error("💥 Error checking local schema:", err);
    } finally {
        await pool.end();
    }
}

checkLocalSchema();
