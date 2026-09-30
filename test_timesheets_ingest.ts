process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const lmsPool = new Pool({
  connectionString: process.env.LMS_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function main() {
  console.log("Testing permissions columns...");
  try {
    const client = await lmsPool.connect();
    const res = await client.query("SELECT * FROM permissions LIMIT 1");
    console.log("Permissions columns:", Object.keys(res.rows[0] || {}));
    client.release();
  } catch (err) {
    console.error("LMS Error:", err);
  } finally {
    await lmsPool.end();
  }
}

main().catch(console.error);
