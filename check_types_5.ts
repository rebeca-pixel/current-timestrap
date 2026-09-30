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
    
    // Check count of embeddings by type
    const countRes = await client.query(`
      SELECT metadata->>'data_type' as type, COUNT(*) 
      FROM document_embeddings 
      GROUP BY metadata->>'data_type'
    `);
    console.log("Counts by type:");
    console.table(countRes.rows);

    client.release();
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
