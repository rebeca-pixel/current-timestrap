process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pmsPool = new Pool({
  connectionString: process.env.PMS_DATABASE_URL || process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function main() {
  try {
    const client = await pmsPool.connect();

    const tasksCount = await client.query("SELECT COUNT(*) FROM project_tasks");
    console.log("Total tasks in project_tasks:", tasksCount.rows[0].count);

    const membersCount = await client.query("SELECT COUNT(*) FROM task_members");
    console.log("Total task members in task_members:", membersCount.rows[0].count);

    const distinctAssignedTasks = await client.query("SELECT COUNT(DISTINCT task_id) FROM task_members");
    console.log("Distinct assigned tasks:", distinctAssignedTasks.rows[0].count);

    client.release();
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pmsPool.end();
  }
}

main();
