
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function test() {
    console.log("Checking for managers table...");
    try {
        const client = await pool.connect();
        // Check if table exists
        const res = await client.query("SELECT to_regclass('public.managers')");
        console.log("Table check result:", res.rows[0]);

        if (res.rows[0].to_regclass) {
            console.log("Managers table exists. Counting rows...");
            const count = await client.query("SELECT COUNT(*) FROM managers");
            console.log("Managers count:", count.rows[0]);
        } else {
            console.log("Managers table does NOT exist!");
        }
        client.release();
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

test();
