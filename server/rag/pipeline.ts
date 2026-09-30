import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { pool } from "../db";
import { runIngestion, generateEmbedding } from "./ingest";
import { createClient } from "@supabase/supabase-js";

// Initialize Redis Client if configured
const redisUrl = process.env.REDIS_URL;
let redisConnection: IORedis | null = null;
let embeddingQueue: Queue | null = null;
let queueWorker: Worker | null = null;

if (redisUrl) {
  try {
    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisConnection.on("error", (err) => {
      console.warn("⚠️ Redis connection error: Ensure Redis is running for BullMQ RAG updates.", err.message);
    });

    embeddingQueue = new Queue("embeddingQueue", {
      connection: redisConnection,
    });
  } catch (error: any) {
    console.warn("⚠️ Failed to initialize Redis/BullMQ. RAG will fallback to on-demand sync.", error.message);
  }
} else {
  console.log("ℹ️ No REDIS_URL configured. RAG is using on-demand/direct synchronization mode (no background worker).");
}

// Supabase client for helper updates inside worker
const timestrapSupabase = createClient(
  process.env.TIMESTRAP_SUPABASE_URL || "",
  process.env.TIMESTRAP_SUPABASE_SERVICE_KEY || ""
);

// Helper to upsert embedding for single webhook record
async function handleSingleRecordIngestion(table: string, record: any) {
  let content = "";
  let metadata: Record<string, any> = {};

  if (table === "time_entries") {
    content = `Timesheet entry by employee ID: ${record.employee_id}.
Date: ${record.date || "Unknown"}.
Task: ${record.task_description || "No description"}.
Hours logged: ${record.hours_logged || 0}.
Progress: ${record.percentage_complete || 0}%.
Achievement: ${record.achievement || "None"}.
Issues: ${record.problems_issues || "None"}.
Status: ${record.status || "pending"}.`;

    metadata = {
      source_db: "timestrap_db",
      data_type: "timesheet",
      record_id: record.id,
      employee_id: record.employee_id,
      role_access: ["manager", "admin", "employee"],
      updated_at: record.updated_at,
    };
  } else if (table === "site_reports") {
    content = `Site report by employee ID: ${record.employee_id}.
Date: ${record.date || "Unknown"}.
Location: ${record.location || "Unknown"}.
GPS: ${record.location_lat || "?"}, ${record.location_lng || "?"}.
Labor count: ${record.labor_count || 0} workers.
Materials used: ${record.materials_used || "None"}.
SQFT covered: ${record.sqft_covered || 0}.
Notes: ${record.notes || "None"}.`;

    metadata = {
      source_db: "timestrap_db",
      data_type: "site_report",
      record_id: record.id,
      employee_id: record.employee_id,
      role_access: ["manager", "admin"],
      updated_at: record.updated_at,
    };
  } else {
    return; // table not supported for real-time webhooks
  }

  const embedding = await generateEmbedding(content);
  const { error } = await timestrapSupabase.rpc("upsert_embedding", {
    p_content: content,
    p_embedding: embedding,
    p_metadata: metadata,
  });

  if (error) {
    console.error(`Error ingesting webhook record for ${table}:`, error.message);
  } else {
    console.log(`Successfully ingested webhook record for ${table}: ${record.id}`);
    if (table === "time_entries") {
      try {
        await pool.query(`
          DELETE FROM document_embeddings
          WHERE metadata->>'data_type' = 'timesheet'
            AND created_at < NOW() - INTERVAL '90 days'
        `);
      } catch (err: any) {
        console.error("Auto-cleanup timesheet embeddings error:", err.message);
      }
    }
  }
}

// Helper to delete embedding for webhook record
async function handleSingleRecordDeletion(table: string, recordId: string) {
  const sourceDb = table === "project_tasks" ? "pms_db" : (table === "leaves" || table === "permissions" ? "lms_db" : "timestrap_db");
  const dataType = table === "project_tasks" ? "task" : (table === "leaves" ? "leave" : (table === "permissions" ? "permission" : (table === "time_entries" ? "timesheet" : "site_report")));

  const { error } = await timestrapSupabase.rpc("upsert_embedding", {
    p_content: "", // will trigger delete or we execute delete query directly
    p_embedding: Array(1536).fill(0), // dummy vector
    p_metadata: { record_id: recordId, source_db: sourceDb, data_type: dataType },
  });

  // Execute direct SQL delete to make sure it's gone
  try {
    await pool.query(`
      DELETE FROM document_embeddings 
      WHERE (metadata->>'record_id') = $1 
        AND (metadata->>'source_db') = $2 
        AND (metadata->>'data_type') = $3
    `, [recordId, sourceDb, dataType]);
    console.log(`Successfully deleted embedding for ${table}: ${recordId}`);
  } catch (err: any) {
    console.error("Delete embedding error:", err.message);
  }
}

// Initialize Worker if Redis is active
if (redisConnection) {
  queueWorker = new Worker(
    "embeddingQueue",
    async (job) => {
      console.log(`Processing job ${job.id} - ${job.name}`);
      const { table, record, type } = job.data;

      if (type === "DELETE") {
        await handleSingleRecordDeletion(table, record.id);
      } else {
        await handleSingleRecordIngestion(table, record);
      }
    },
    { connection: redisConnection }
  );

  queueWorker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
  });
}

// ─── PERIODIC SYNC PIPELINE ─────────────────────────────────
export async function syncDatabaseRecords() {
  console.log("🔄 Starting database sync cycle...");
  try {
    // 1. Fetch last sync time
    const res = await pool.query("SELECT last_sync_at FROM rag_sync_state WHERE data_type = 'all' LIMIT 1");
    const lastSync = res.rows[0]?.last_sync_at;
    const sinceString = lastSync ? lastSync.toISOString() : undefined;

    // 2. Run ingestion
    await runIngestion(sinceString);

    // 3. Update last sync time
    const now = new Date();
    await pool.query(`
      INSERT INTO rag_sync_state (data_type, last_sync_at)
      VALUES ('all', $1)
      ON CONFLICT (data_type) 
      DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at
    `, [now]);

    console.log("🔄 Sync cycle completed successfully!");
  } catch (error: any) {
    console.error("❌ Sync cycle failed:", error.message);
  }
}

// Queue helper to add real-time webhook jobs
export async function queueWebhookJob(table: string, record: any, type: string) {
  if (embeddingQueue) {
    try {
      await embeddingQueue.add("webhook_ingest", { table, record, type });
      console.log(`Queued BullMQ job for webhook ${table} - ${type}`);
    } catch (err: any) {
      console.warn("Queue failed, falling back to direct ingestion:", err.message);
      await handleSingleRecordIngestion(table, record);
    }
  } else {
    // Direct sync fallback if Redis is down
    if (type === "DELETE") {
      await handleSingleRecordDeletion(table, record.id);
    } else {
      await handleSingleRecordIngestion(table, record);
    }
  }
}

// Start periodic sync every 15 minutes (in case webhooks or external DB updates miss)
setInterval(() => {
  syncDatabaseRecords().catch(console.error);
}, 15 * 60 * 1000);
