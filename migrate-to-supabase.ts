import "dotenv/config";
import pg from "pg";
import * as fs from "fs";
import * as path from "path";

const { Pool } = pg;

/* ================================
   Configuration
================================ */
const SOURCE_DB_URL = process.env.DATABASE_URL;

// Try to get Supabase URL from environment or use the Supabase pooler connection
// Preferred connection (pooler) format provided by Supabase:
// postgresql://<user>.<project_id>:<password>@aws-1-<region>.pooler.supabase.com:<port>/postgres
let DESTINATION_DB_URL = process.env.SUPABASE_DATABASE_URL;

if (!DESTINATION_DB_URL) {
  // Use the pooler host and project-specific user as provided
  const pooledHost = "aws-1-ap-south-1.pooler.supabase.com";
  const pooledPort = "6543";
  const pooledUser = "postgres.zcqwthebilqrcvkqywav"; // as provided
  const pooledPassword = "Durgadevi@67"; // provided password
  const pooledDatabase = "postgres";

  const encodedPassword = encodeURIComponent(pooledPassword);
  DESTINATION_DB_URL = `postgresql://${pooledUser}:${encodedPassword}@${pooledHost}:${pooledPort}/${pooledDatabase}`;
}

if (!SOURCE_DB_URL) {
  throw new Error("SOURCE DATABASE_URL must be set in .env");
}

/* ================================
   Table Definitions for Safe Migration
================================ */
const TABLE_DEFINITIONS = `
-- Organisations
CREATE TABLE IF NOT EXISTS organisations (
    id VARCHAR PRIMARY KEY,
    name TEXT NOT NULL,
    gst_id TEXT NOT NULL,
    main_address TEXT NOT NULL,
    branch_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Departments
CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    leader TEXT,
    parent_department_id VARCHAR,
    organisation_id VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
    id VARCHAR PRIMARY KEY,
    name TEXT NOT NULL,
    parent_department TEXT NOT NULL,
    group_leader TEXT,
    organisation_id VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR PRIMARY KEY,
    employee_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    department TEXT,
    group_name TEXT,
    line_manager_id VARCHAR,
    organisation_id VARCHAR,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    project_code TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    description TEXT,
    status TEXT,
    start_date TEXT,
    end_date TEXT
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR PRIMARY KEY,
    project_code TEXT NOT NULL,
    task_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subtasks
CREATE TABLE IF NOT EXISTS subtasks (
    id VARCHAR PRIMARY KEY,
    task_id VARCHAR NOT NULL,
    subtask_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Time Entries
CREATE TABLE IF NOT EXISTS time_entries (
    id VARCHAR PRIMARY KEY,
    employee_id VARCHAR NOT NULL,
    employee_code TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    date TEXT NOT NULL,
    project_name TEXT NOT NULL,
    task_description TEXT NOT NULL,
    problem_and_issues TEXT,
    quantify TEXT NOT NULL,
    achievements TEXT,
    scope_of_improvements TEXT,
    tools_used TEXT[],
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    total_hours TEXT NOT NULL,
    percentage_complete INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    approved_by VARCHAR,
    approved_at TIMESTAMP,
    manager_approved_by VARCHAR,
    manager_approved_at TIMESTAMP,
    manager_approved BOOLEAN DEFAULT FALSE,
    rejection_reason TEXT,
    approval_comment TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Managers
CREATE TABLE IF NOT EXISTS managers (
    id VARCHAR PRIMARY KEY,
    name TEXT NOT NULL,
    employee_code TEXT NOT NULL UNIQUE,
    email TEXT,
    department TEXT
);
`;

/* ================================
   Migration Functions
================================ */

async function createSourcePool() {
  return new Pool({
    connectionString: SOURCE_DB_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function createDestinationPool() {
  return new Pool({
    connectionString: DESTINATION_DB_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function createSchema(client: pg.PoolClient) {
  console.log("✓ Creating schemas in destination database...");
  try {
    await client.query(TABLE_DEFINITIONS);
    // Ensure newer/legacy columns exist if source uses slightly different schema
    try {
      await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS manager_approved BOOLEAN DEFAULT FALSE`);
    } catch (e) {
      // Non-fatal: just log
      console.log('ℹ Could not ensure legacy columns:', e instanceof Error ? e.message : e);
    }
    console.log("✓ Schema created successfully");
  } catch (error: any) {
    if (error.code !== "42P07") {
      // 42P07 is "table already exists"
      throw error;
    }
    console.log("ℹ Tables already exist in destination database");
  }
}

async function getTables(sourceClient: pg.PoolClient): Promise<string[]> {
  const result = await sourceClient.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
  `);

  return result.rows.map((row) => row.table_name);
}

async function copyTableData(
  sourceClient: pg.PoolClient,
  destClient: pg.PoolClient,
  tableName: string
) {
  console.log(`\n⏳ Copying data from table: ${tableName}`);

  // Get row count from source
  const countResult = await sourceClient.query(
    `SELECT COUNT(*) as count FROM "${tableName}"`
  );
  const rowCount = parseInt(countResult.rows[0].count, 10);

  if (rowCount === 0) {
    console.log(`   ℹ  Table "${tableName}" is empty`);
    return;
  }

  // Fetch all data from source table
  const sourceData = await sourceClient.query(`SELECT * FROM "${tableName}"`);

  if (sourceData.rows.length === 0) {
    console.log(`   ℹ  Table "${tableName}" has no data`);
    return;
  }

  // Get column names from first row
  const columns = Object.keys(sourceData.rows[0]);

  // Insert data in batches to avoid command size limits
  const batchSize = 100;
  let insertedCount = 0;

  for (let i = 0; i < sourceData.rows.length; i += batchSize) {
    const batch = sourceData.rows.slice(i, i + batchSize);

    if (batch.length === 0) continue;

    // Build INSERT statement
    const values = batch
      .map((row, rowIndex) => {
        const rowValues = columns
          .map((col) => {
            const value = row[col];
            if (value === null) {
              return "NULL";
            } else if (Array.isArray(value)) {
              // Handle array types
              return `'${JSON.stringify(value)}'::text[]`;
            } else if (typeof value === "string") {
              // Escape single quotes
              return `'${value.replace(/'/g, "''")}'`;
            } else if (typeof value === "boolean") {
              return value ? "TRUE" : "FALSE";
            } else if (value instanceof Date) {
              return `'${value.toISOString()}'`;
            } else {
              return String(value);
            }
          })
          .join(", ");
        return `(${rowValues})`;
      })
      .join(", ");

    const columnList = columns.map((col) => `"${col}"`).join(", ");
    const insertQuery = `
      INSERT INTO "${tableName}" (${columnList})
      VALUES ${values}
      ON CONFLICT DO NOTHING;
    `;

    try {
      await destClient.query(insertQuery);
      insertedCount += batch.length;
      console.log(
        `   ✓ Inserted ${insertedCount}/${rowCount} rows (batch completed)`
      );
    } catch (error: any) {
      console.error(
        `   ✗ Error inserting batch for table "${tableName}":`,
        error.message
      );
      throw error;
    }
  }

  console.log(`   ✓ Successfully copied ${insertedCount} rows to "${tableName}"`);
}

async function migrate() {
  const sourcePool = await createSourcePool();
  const destPool = await createDestinationPool();

  try {
    // Test source connection
    console.log("🔗 Testing connection to source database...");
    const sourceTest = await sourcePool.query("SELECT NOW()");
    console.log("✓ Source database connected");

    // Test destination connection
    console.log("🔗 Testing connection to destination database...");
    const destTest = await destPool.query("SELECT NOW()");
    console.log("✓ Destination database connected");

    // Get clients
    const sourceClient = await sourcePool.connect();
    const destClient = await destPool.connect();

    try {
      // Create schema in destination
      await createSchema(destClient);

      // Get all tables from source
      const tables = await getTables(sourceClient);
      console.log(`\n📊 Found ${tables.length} tables to migrate:`);
      tables.forEach((table) => console.log(`   - ${table}`));

      // Copy data for each table
      console.log("\n📋 Starting data migration...");
      for (const table of tables) {
        await copyTableData(sourceClient, destClient, table);
      }

      console.log("\n✅ Migration completed successfully!");
      console.log("\n📊 Summary:");
      console.log(`   Source: ${SOURCE_DB_URL?.split("@")[0].split("://")[1]}...`);
      console.log(
        `   Destination: ${DESTINATION_DB_URL?.split("@")[0].split("://")[1]}...`
      );
      console.log(`   Tables migrated: ${tables.length}`);
    } finally {
      sourceClient.release();
      destClient.release();
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await destPool.end();
  }
}

// Run migration
migrate().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
