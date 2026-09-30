process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function main() {
  try {
    const client = await pool.connect();

    console.log("=== Querying task embeddings for employee Durga Devi (d3995cf8-5d57-452a-a131-d7e1a107ce83) ===");
    const res = await client.query(`
      SELECT content, metadata->>'data_type' as type, metadata->>'record_id' as record_id
      FROM document_embeddings
      WHERE (metadata->>'employee_id') = 'd3995cf8-5d57-452a-a131-d7e1a107ce83'
        AND (metadata->>'data_type') = 'task'
    `);
    
    console.log(`Found ${res.rows.length} task embeddings:`);
    for (const row of res.rows) {
      console.log(`- Type: ${row.type}`);
      console.log(`  Content:\n${row.content}`);
      console.log("------------------------");
    }

    client.release();
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
