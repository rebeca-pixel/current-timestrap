import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pmsDatabaseUrl = process.env.PMS_DATABASE_URL || process.env.DATABASE_URL!;

const pmsPool = new Pool({
    connectionString: pmsDatabaseUrl,
    ssl: {
        rejectUnauthorized: false
    }
});

async function checkIds() {
    try {
        console.log("--- Checking project_tasks for 'remove bugs and updates' ---");
        const taskRes = await pmsPool.query(`
            SELECT id, task_name, status FROM project_tasks 
            WHERE task_name ILIKE '%remove%bugs%'
        `);
        console.log("Tasks found:", JSON.stringify(taskRes.rows, null, 2));

        if (taskRes.rows.length > 0) {
            const taskId = taskRes.rows[0].id;
            console.log(`\n--- Checking subtasks for task id: ${taskId} ---`);
            const subtaskRes = await pmsPool.query(`
                SELECT id, task_id, title, is_completed FROM subtasks 
                WHERE task_id = $1 OR CAST(task_id AS text) = $1
            `, [taskId]);
            console.log("Subtasks found:", JSON.stringify(subtaskRes.rows, null, 2));
        }

        console.log("\n--- Checking columns of project_tasks ---");
        const ptCols = await pmsPool.query(`
            SELECT column_name, data_type FROM information_schema.columns 
            WHERE table_name = 'project_tasks' AND table_schema = 'public'
        `);
        console.log("Columns:", ptCols.rows.map(c => c.column_name).join(', '));

        console.log("\n--- Checking columns of subtasks ---");
        const sCols = await pmsPool.query(`
            SELECT column_name, data_type FROM information_schema.columns 
            WHERE table_name = 'subtasks' AND table_schema = 'public'
        `);
        console.log("Columns:", sCols.rows.map(c => c.column_name).join(', '));

    } catch (err) {
        console.error('💥 Error:', err);  
    } finally {
        await pmsPool.end();
    }
}

checkIds();
