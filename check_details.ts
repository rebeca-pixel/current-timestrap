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

    console.log("=== Group by data_type ===");
    const countRes = await client.query(`
      SELECT metadata->>'data_type' as type, COUNT(*) 
      FROM document_embeddings 
      GROUP BY metadata->>'data_type'
    `);
    console.table(countRes.rows);

    console.log("=== Tasks with vs without employee_id ===");
    const empTaskRes = await client.query(`
      SELECT 
        CASE 
          WHEN metadata->>'employee_id' IS NULL THEN 'NULL'
          ELSE 'UUID'
        END as employee_status,
        COUNT(*) as count
      FROM document_embeddings
      WHERE metadata->>'data_type' = 'task'
      GROUP BY 1
    `);
    console.table(empTaskRes.rows);

    console.log("=== Sample task records ===");
    const sampleRes = await client.query(`
      SELECT content, metadata
      FROM document_embeddings
      WHERE metadata->>'data_type' = 'task'
      LIMIT 3
    `);
    for (const row of sampleRes.rows) {
      console.log("- Content:", row.content);
      console.log("- Metadata:", JSON.stringify(row.metadata));
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
