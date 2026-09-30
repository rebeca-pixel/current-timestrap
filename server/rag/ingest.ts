import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { pmsPool } from "../pmsSupabase";
import { lmsPool } from "../lmsSupabase";
import { pool } from "../db";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const timestrapSupabase = createClient(
  process.env.TIMESTRAP_SUPABASE_URL!,
  process.env.TIMESTRAP_SUPABASE_SERVICE_KEY!
);

const pmsSupabase = createClient(
  process.env.PMS_SUPABASE_URL!,
  process.env.PMS_SUPABASE_SERVICE_KEY!
);

const lmsSupabase = createClient(
  process.env.LMS_SUPABASE_URL!,
  process.env.LMS_SUPABASE_SERVICE_KEY!
);

// Concurrency pool helper to run promises in parallel with a limit
async function batchPromises<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<any>
): Promise<void> {
  const executing: Promise<any>[] = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    if (limit <= items.length) {
      const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  await Promise.all(executing);
}

// ─── GENERATE EMBEDDING ───────────────────────────────────
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

// ─── UPSERT INTO VECTOR DB ────────────────────────────────
async function upsertEmbedding(
  content: string,
  metadata: Record<string, any>
) {
  const embedding = await generateEmbedding(content);

  const { error } = await timestrapSupabase.rpc("upsert_embedding", {
    p_content: content,
    p_embedding: embedding,
    p_metadata: metadata,
  });

  if (error) {
    console.error("Upsert error:", error.message);
  }
}

// ─── INGEST PMS TASKS ─────────────────────────────────────
async function ingestPMSTasks(since?: string) {
  try {
    // Step 1: Pre-fetch all Timestrap employees to map emp_code -> local UUID
    const { rows: timestrapEmployees } = await pool.query(
      `SELECT id, employee_code FROM employees`
    );
    const codeToLocalId: Record<string, string> = {};
    for (const emp of timestrapEmployees) {
      if (emp.employee_code) codeToLocalId[emp.employee_code] = emp.id;
    }

    // Step 2: Fetch PMS tasks
    let taskQuery = `SELECT * FROM project_tasks`;
    if (since) taskQuery += ` WHERE updated_at > '${since}'`;
    const { rows: tasks } = await pmsPool.query(taskQuery);

    // Step 3: Fetch project names
    const { rows: projects } = await pmsPool.query(`SELECT id, title FROM projects`);
    const projectMap: Record<string, string> = {};
    for (const p of projects) projectMap[p.id] = p.title;

    // Step 4: Fetch task_members with PMS employee codes
    const { rows: members } = await pmsPool.query(`
      SELECT tm.task_id, e.emp_code 
      FROM task_members tm
      JOIN employees e ON e.id = tm.employee_id
    `);

    // Group members by task_id
    const taskAssignees: Record<string, string[]> = {};
    for (const m of members) {
      if (!taskAssignees[m.task_id]) taskAssignees[m.task_id] = [];
      taskAssignees[m.task_id].push(m.emp_code);
    }

    await batchPromises(tasks, 15, async (task) => {
      const projectName = projectMap[task.project_id] || "Unknown";
      const assigneeCodes = taskAssignees[task.id] || [];
      const assigneeLocalIds = assigneeCodes
        .map(code => codeToLocalId[code])
        .filter(Boolean);

      const content = `Task: ${task.task_name}.
Project: ${projectName}.
Assigned to: ${assigneeCodes.length > 0 ? assigneeCodes.join(", ") : "Unassigned"}.
Status: ${task.status || "Unknown"}.
Progress: ${task.progress || 0}%.
Deadline: ${task.end_date || "No deadline"}.
Description: ${task.description || "None"}.`;

      if (assigneeLocalIds.length > 0) {
        // Upsert one embedding per assignee so each employee can find it
        for (const localId of assigneeLocalIds) {
          await upsertEmbedding(content, {
            source_db: "pms_db",
            data_type: "task",
            record_id: `${task.id}_${localId}`,
            employee_id: localId,
            project_id: task.project_id,
            role_access: ["manager", "admin", "employee"],
            updated_at: task.updated_at,
          });
        }
      } else {
        // Unassigned tasks — store with null so managers can still find them
        await upsertEmbedding(content, {
          source_db: "pms_db",
          data_type: "task",
          record_id: task.id,
          employee_id: null,
          project_id: task.project_id,
          role_access: ["manager", "admin"],
          updated_at: task.updated_at,
        });
      }

      console.log(`Ingested PMS task: ${task.task_name}`);
    });
  } catch (error: any) {
    console.error("PMS tasks fetch error:", error.message);
  }
}

// ─── INGEST TIMESTRAP TIMESHEETS ──────────────────────────
async function ingestTimesheets(since?: string) {
  try {
    let queryStr = "SELECT * FROM time_entries";
    const params: any[] = [];
    if (since) {
      queryStr += " WHERE submitted_at > $1";
      params.push(since);
    }

    const res = await pool.query(queryStr, params);
    const data = res.rows || [];

    await batchPromises(data, 15, async (entry) => {
      const content = `Timesheet entry by employee ID: ${entry.employee_id}.
Date: ${entry.date || "Unknown"}.
Task: ${entry.task_description || "No description"}.
Hours logged: ${entry.total_hours || "0"}.
Progress: ${entry.percentage_complete || 0}%.
Achievement: ${entry.achievements || entry.achievement || "None"}.
Issues: ${entry.problem_and_issues || entry.problems_issues || "None"}.
Status: ${entry.status || "pending"}.`;

      await upsertEmbedding(content, {
        source_db: "timestrap_db",
        data_type: "timesheet",
        record_id: entry.id,
        employee_id: entry.employee_id,
        role_access: ["manager", "admin", "employee"],
        updated_at: entry.submitted_at || new Date().toISOString(),
      });

      console.log(`Ingested timesheet: ${entry.id}`);
    });

    // Auto-cleanup: delete timesheet embeddings older than 30 days (runs once after batch)
    const cleaned = await pool.query(`
      DELETE FROM document_embeddings
      WHERE metadata->>'data_type' = 'timesheet'
        AND created_at < NOW() - INTERVAL '30 days'
    `);
    if (cleaned.rowCount && cleaned.rowCount > 0) {
      console.log(`Auto-cleaned ${cleaned.rowCount} old timesheet embeddings (>30 days)`);
    }
  } catch (error: any) {
    console.error("Timesheets ingestion error:", error.message);
  }
}

// ─── INGEST SITE REPORTS ──────────────────────────────────
async function ingestSiteReports(since?: string) {
  try {
    let queryStr = "SELECT * FROM site_reports";
    const params: any[] = [];
    if (since) {
      queryStr += " WHERE timestamp > $1";
      params.push(since);
    }

    const res = await pool.query(queryStr, params);
    const data = res.rows || [];

    await batchPromises(data, 15, async (report) => {
      const content = `Site report by employee ID: ${report.employee_id}.
Date: ${report.date || "Unknown"}.
Location: ${report.project_name || "Unknown"}.
GPS: ${report.location_lat || "?"}, ${report.location_lng || "?"}.
Labor count: ${report.labor_count || 0} workers.
Materials used: ${report.materials_used || "None"}.
SQFT covered: ${report.sqft_covered || 0}.
Notes: ${report.work_done || "None"}.`;

      await upsertEmbedding(content, {
        source_db: "timestrap_db",
        data_type: "site_report",
        record_id: report.id,
        employee_id: report.employee_id,
        role_access: ["manager", "admin"],
        updated_at: report.timestamp || new Date().toISOString(),
      });

      console.log(`Ingested site report: ${report.id}`);
    });
  } catch (error: any) {
    console.error("Site reports ingestion error:", error.message);
  }
}

// ─── INGEST LMS LEAVES ────────────────────────────────────
async function ingestLeaves(since?: string) {
  try {
    // Pre-fetch all Timestrap employees to map employee_code -> local UUID
    const { rows: timestrapEmployees } = await pool.query(
      `SELECT id, employee_code FROM employees`
    );
    const codeToLocalId: Record<string, string> = {};
    for (const emp of timestrapEmployees) {
      if (emp.employee_code) codeToLocalId[emp.employee_code] = emp.id;
    }

    let queryStr = "SELECT * FROM leaves";
    const params: any[] = [];
    if (since) {
      queryStr += " WHERE created_at > $1";
      params.push(since);
    }

    const res = await lmsPool.query(queryStr, params);
    const data = res.rows || [];

    await batchPromises(data, 15, async (leave) => {
      const localId = leave.user_id ? codeToLocalId[leave.user_id] : null;

      const content = `Leave request by employee ID: ${localId || leave.user_id}.
Type: ${leave.leave_type || "Unknown"}.
From: ${leave.start_date}.
To: ${leave.end_date}.
Status: ${leave.status || "pending"}.
Reason: ${leave.reason || "Not provided"}.`;

      await upsertEmbedding(content, {
        source_db: "lms_db",
        data_type: "leave",
        record_id: leave.id,
        employee_id: localId || leave.user_id,
        role_access: ["hr", "admin", "employee"],
        updated_at: leave.created_at || leave.action_date || new Date().toISOString(),
      });

      console.log(`Ingested leave: ${leave.id}`);
    });
  } catch (error: any) {
    console.error("LMS leaves fetch error:", error.message);
  }
}

// ─── INGEST LMS PERMISSIONS ───────────────────────────────
async function ingestPermissions(since?: string) {
  try {
    // Pre-fetch all Timestrap employees to map employee_code -> local UUID
    const { rows: timestrapEmployees } = await pool.query(
      `SELECT id, employee_code FROM employees`
    );
    const codeToLocalId: Record<string, string> = {};
    for (const emp of timestrapEmployees) {
      if (emp.employee_code) codeToLocalId[emp.employee_code] = emp.id;
    }

    let queryStr = "SELECT * FROM permissions";
    const params: any[] = [];
    if (since) {
      queryStr += " WHERE created_at > $1";
      params.push(since);
    }

    const res = await lmsPool.query(queryStr, params);
    const data = res.rows || [];

    await batchPromises(data, 15, async (perm) => {
      const localId = perm.user_id ? codeToLocalId[perm.user_id] : null;

      const content = `Permission request by employee ID: ${localId || perm.user_id}.
Type: ${perm.permission_type || "Unknown"}.
Date: ${perm.permission_date || perm.date || "Unknown"}.
From: ${perm.from_time || perm.start_time}.
To: ${perm.to_time || perm.end_time}.
Status: ${perm.status || "pending"}.
Reason: ${perm.reason || "Not provided"}.`;

      await upsertEmbedding(content, {
        source_db: "lms_db",
        data_type: "permission",
        record_id: perm.id,
        employee_id: localId || perm.user_id,
        role_access: ["hr", "admin", "employee"],
        updated_at: perm.created_at || perm.action_date || new Date().toISOString(),
      });

      console.log(`Ingested permission: ${perm.id}`);
    });
  } catch (error: any) {
    console.error("LMS permissions fetch error:", error.message);
  }
}

// ─── MAIN INGEST FUNCTION ─────────────────────────────────
export async function runIngestion(since?: string) {
  console.log("Starting ingestion pipeline...");
  console.log(since ? `Only processing data since: ${since}` : "Full ingestion");

  await ingestPMSTasks(since);
  await ingestTimesheets(since);
  await ingestSiteReports(since);
  await ingestLeaves(since);
  await ingestPermissions(since);

  console.log("Ingestion complete!");
}
