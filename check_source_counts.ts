process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const localPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const lmsPool = new Pool({
  connectionString: process.env.LMS_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const localClient = await localPool.connect();
    const timesheetsCount = await localClient.query("SELECT COUNT(*) FROM time_entries");
    console.log("Local time_entries count:", timesheetsCount.rows[0].count);

    const siteReportsCount = await localClient.query("SELECT COUNT(*) FROM site_reports");
    console.log("Local site_reports count:", siteReportsCount.rows[0].count);
    localClient.release();

    const lmsClient = await lmsPool.connect();
    const leavesCount = await lmsClient.query("SELECT COUNT(*) FROM leaves");
    console.log("LMS leaves count:", leavesCount.rows[0].count);

    const permissionsCount = await lmsClient.query("SELECT COUNT(*) FROM permissions");
    console.log("LMS permissions count:", permissionsCount.rows[0].count);
    lmsClient.release();

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await localPool.end();
    await lmsPool.end();
  }
}

main();
