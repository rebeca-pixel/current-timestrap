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
    
    // Check initial count of embeddings
    const initialCount = await client.query("SELECT COUNT(*) FROM document_embeddings");
    console.log("Initial document_embeddings count:", initialCount.rows[0].count);

    // Reset last_sync_at in rag_sync_state
    console.log("Resetting rag_sync_state...");
    const resetRes = await client.query(`
      UPDATE rag_sync_state 
      SET last_sync_at = '2024-01-01 00:00:00' 
      WHERE data_type = 'all'
    `);
    console.log("Reset state result (rows updated):", resetRes.rowCount);

    // Delete existing embeddings to start fresh
    console.log("Clearing existing document_embeddings...");
    const deleteRes = await client.query("DELETE FROM document_embeddings");
    console.log("Cleared embeddings result (rows deleted):", deleteRes.rowCount);

    client.release();
  } catch (err) {
    console.error("Error running database reset:", err);
  } finally {
    await pool.end();
  }
}

main();
