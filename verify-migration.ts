import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const SOURCE_DB_URL = process.env.DATABASE_URL;

// Properly construct destination URL with URL encoding
let DESTINATION_DB_URL = process.env.SUPABASE_DATABASE_URL;
if (!DESTINATION_DB_URL) {
  // Use Supabase pooler connection details
  const pooledHost = "aws-1-ap-south-1.pooler.supabase.com";
  const pooledPort = "6543";
  const pooledUser = "postgres.zcqwthebilqrcvkqywav";
  const pooledPassword = "Durgadevi@67";
  const pooledDatabase = "postgres";
  const encodedPassword = encodeURIComponent(pooledPassword);
  DESTINATION_DB_URL = `postgresql://${pooledUser}:${encodedPassword}@${pooledHost}:${pooledPort}/${pooledDatabase}`;
}

async function verify() {
  console.log("\n🔍 Database Migration Verification\n");
  console.log("=====================================\n");

  let sourceConnected = false;
  let destConnected = false;
  let sourceTables = 0;
  let sourceRows = 0;

  // Display connection information
  console.log("📋 Connection Details:\n");
  if (SOURCE_DB_URL) {
    const sourceHost = SOURCE_DB_URL.split("@")[1]?.split(":")[0] || "unknown";
    console.log(`   Source DB: ${sourceHost} (Neon)`);
  }
  const destHost = DESTINATION_DB_URL.split("@")[1]?.split(":")[0] || "unknown";
  console.log(`   Destination DB: ${destHost} (Supabase)\n`);

  // Check source database
  console.log("1️⃣  Checking SOURCE database (Neon)...");
  const sourcePool = new Pool({
    connectionString: SOURCE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const client = await sourcePool.connect();
    await client.query("SELECT NOW()");
    sourceConnected = true;
    console.log("   ✓ Connected to source database");

    // Get table count
    const tableResult = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    sourceTables = parseInt(tableResult.rows[0].count, 10);
    console.log(`   ✓ Found ${sourceTables} tables`);

    // Get total row count
    const rowResult = await client.query(`
      SELECT SUM(n_live_tup) as total_rows
      FROM pg_stat_user_tables
    `);
    sourceRows =
      rowResult.rows[0].total_rows || 0;
    console.log(`   ✓ Found approximately ${sourceRows} total rows\n`);

    client.release();
  } catch (error: any) {
    console.error(
      "   ✗ Failed to connect to source database:",
      error.message
    );
    console.error("   Please check:");
    console.error("   - .env file exists with DATABASE_URL");
    console.error("   - DATABASE_URL is correct");
    console.error("   - Internet connection is working");
    console.error("   - Neon database is accessible\n");
  } finally {
    await sourcePool.end();
  }

  // Check destination database
  console.log("2️⃣  Checking DESTINATION database (Supabase)...");
  const destPool = new Pool({
    connectionString: DESTINATION_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const client = await destPool.connect();
    await client.query("SELECT NOW()");
    destConnected = true;
    console.log("   ✓ Connected to destination database");

    // Get table count
    const tableResult = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    const destTables = parseInt(tableResult.rows[0].count, 10);

    if (destTables === 0) {
      console.log("   ✓ Destination is empty (ready for migration)");
    } else {
      console.log(
        `   ⚠  Destination has ${destTables} existing tables (will update them safely)`
      );
    }

    console.log("");

    client.release();
  } catch (error: any) {
    console.error(
      "   ✗ Failed to connect to destination database:",
      error.message
    );
    console.error("   Please check:");
    console.error("   - Supabase connection string is correct");
    console.error("   - Password is correct (Durgadevi@67)");
    console.error("   - Supabase database is accessible\n");
  } finally {
    await destPool.end();
  }

  // Summary
  console.log("=====================================\n");
  console.log("📊 Migration Summary:\n");

  if (sourceConnected && destConnected) {
    console.log("   ✅ Both databases are accessible");
    console.log(`   📦 Ready to migrate:`);
    console.log(`      - ${sourceTables} tables`);
    console.log(`      - ~${sourceRows} rows of data\n`);
    console.log("   🚀 To start migration, run:\n");
    console.log("      npm run migrate:supabase\n");
    console.log("   Or:\n");
    console.log("      npx tsx migrate-to-supabase.ts\n");
  } else {
    console.log("   ❌ Database connectivity issues detected");
    console.log("   Please fix the errors above before migrating\n");
    process.exit(1);
  }
}

verify().catch((error) => {
  console.error("Verification error:", error);
  process.exit(1);
});
