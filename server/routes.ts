import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket, WebSocket as WSWebSocket } from "ws";
import { storage } from "./storage";
import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";   // ✅ KEEP THIS
import { pool } from "./db";
import { db } from "./db";
import { and, eq, isNull, or } from "drizzle-orm";
import { validateToolUsage, getToolActivitySummary, getActualWorkedTools } from "./toolUsageValidation";
import { getDayActivityMatches } from "./activityMatching";
import { generateTimesheetForDay, submitTimesheetForDay } from "./timesheetGenerator";
import { suggestWorkSummaryFromTimeGuard } from "./aiActivitySummary";
import { pmsPool, saveSiteReportToPMS, getTasks, type PMSTask } from "./pmsSupabase";
import {
  getCalendarEvents as getPmsCalendarEvents,
  createCalendarEvent as createPmsCalendarEvent,
  updateCalendarEvent as updatePmsCalendarEvent,
  deleteCalendarEvent as deletePmsCalendarEvent,
  upsertPlanCalendarEvent as upsertPmsPlanCalendarEvent,
  deletePlanCalendarEvent as deletePmsPlanCalendarEvent,
  getGoogleStatus as getPmsGoogleStatus,
  disconnectGoogle as disconnectPmsGoogle,
} from "./Pmscalendarevents";
import { getLMSHours, getODExemption, isWithinApprovedOD, getEffectivePlanCutoffMinutes } from "./lmsSupabase";
import { registerVoiceRoutes } from "./voice";
import { format, parseISO, eachDayOfInterval, isSameDay } from "date-fns";
import { sendEmail } from "./email";
import { validateWithRules, normalizeValidationRules, DEFAULT_VALIDATION_RULES, isWithinSubmissionWindow, type ValidationRules } from "@shared/timesheetValidation";
import bcrypt from "bcryptjs";
import { registerGoogleCalendarRoutes } from "./googleCalendar";

// ✅ REPLACE WITH THIS (WORKS IN PM2 + CJS)
const __dirname = path.resolve();

import {
  insertOrganisationSchema,
  insertEmployeeSchema,
  insertTimeEntrySchema,
  insertDepartmentSchema,
  insertGroupSchema,
  insertSiteReportSchema,
  insertSiteReportAttachmentSchema,
  dailyPlans,
  planTasks,
  employees,
  enforcementConfigs,
  deviationWarningLogs,
  deviationOverrides,
} from "@shared/schema";

import { createClient } from "@supabase/supabase-js";
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey, { realtime: { transport: WSWebSocket as any } });

// Store connected WebSocket clients for real-time updates
const clients: Set<WebSocket> = new Set();

function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Helper function to check if a project deadline has passed
function isProjectExpired(endDate: string | null): boolean {
  if (!endDate) return false;

  try {
    const projectEndDate = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    projectEndDate.setHours(0, 0, 0, 0);
    return projectEndDate < today;
  } catch (error) {
    console.error("Error parsing project end date:", endDate, error);
    return false;
  }
}

function isAfterPlanCutoff(cutoffMinutesOverride?: number): boolean {
  const now = new Date();
  // Normalize to UTC first, then add IST offset (5.5h)
  const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istNow = new Date(utcNow + (5.5 * 60 * 60 * 1000));

  // Use UTC methods to get the "local" components of the shifted date
  const hours = istNow.getUTCHours();
  const minutes = istNow.getUTCMinutes();
  const nowMinutes = hours * 60 + minutes;

  // Standard cutoff is 12:30 PM (750 minutes from midnight). Callers can pass
  // an OD-adjusted cutoff (see getEffectivePlanCutoffMinutes in lmsSupabase.ts)
  // so an employee on approved On-Duty isn't marked "past cutoff" while their
  // OD window overlaps the standard 12:30 PM deadline.
  const cutoffMinutes = cutoffMinutesOverride ?? (12 * 60 + 30);

  return nowMinutes >= cutoffMinutes;
}

async function getLeaveStatusForDate(employeeCode: string, date: string) {
  if (!employeeCode || !date) {
    return { hasLeave: false, status: null, details: [] as any[] };
  }

  try {
    const { lmsPool } = await import('./lmsSupabase');
    const result = await lmsPool.query(`
      SELECT id, user_id, leave_type, leave_duration_type, status, start_date, end_date
      FROM leaves
      WHERE user_id = $1
        AND status IN ('Approved', 'Pending')
        AND start_date <= $2::date
        AND end_date >= $2::date
      ORDER BY CASE status WHEN 'Pending' THEN 0 WHEN 'Approved' THEN 1 END ASC
    `, [employeeCode, date]);

    if (!result.rows?.length) {
      return { hasLeave: false, status: null, details: [] as any[] };
    }

    const primaryStatus = result.rows.some((row: any) => row.status === 'Pending')
      ? 'Pending'
      : 'Approved';

    return {
      hasLeave: true,
      status: primaryStatus,
      details: result.rows,
    };
  } catch (error) {
    console.error('[LEAVE STATUS] Error checking leave status:', error);
    return { hasLeave: false, status: null, details: [] as any[] };
  }
}

// ---------- PMS lookup cache ----------
// Key step / task dates live in a separate (remote) PMS database and change rarely. Looking them up
// costs three sequential round trips per list load, so results are cached and only unseen ids are queried.
const PMS_CACHE_TTL_MS = 10 * 60 * 1000;
const PMS_CACHE_MAX = 20000;
type PmsCacheItem<T> = { v: T; exp: number };
type PmsTaskDetails = { keyStepId: string | null; startDate: string | null; endDate: string | null };
const pmsSubtaskCache = new Map<string, PmsCacheItem<string>>(); // subtaskId -> taskId
const pmsTaskCache = new Map<string, PmsCacheItem<PmsTaskDetails>>();
const pmsKeyStepCache = new Map<string, PmsCacheItem<string>>(); // keyStepId -> title

function pmsCacheGet<T>(cache: Map<string, PmsCacheItem<T>>, id: string, now: number): T | undefined {
  const hit = cache.get(id);
  return hit && hit.exp > now ? hit.v : undefined;
}
function pmsCacheSet<T>(cache: Map<string, PmsCacheItem<T>>, id: string, value: T, now: number) {
  if (cache.size >= PMS_CACHE_MAX) cache.clear();
  cache.set(id, { v: value, exp: now + PMS_CACHE_TTL_MS });
}

// Batch enrich entries to avoid N+1 query problem
async function batchEnrichEntries(entries: any[]) {
  if (entries.length === 0) return [];

  const now = Date.now();
  const subtaskIds = Array.from(new Set(entries.filter(e => e.pmsSubtaskId).map(e => e.pmsSubtaskId as string)));
  const directTaskIds = Array.from(new Set(entries.filter(e => e.pmsId && !e.pmsSubtaskId).map(e => e.pmsId as string)));

  try {
    // 1. Subtasks -> parent task ids (only ids we have not cached yet)
    const missingSubtasks = subtaskIds.filter(id => pmsCacheGet(pmsSubtaskCache, id, now) === undefined);
    if (missingSubtasks.length > 0) {
      const subRes = await pmsPool.query('SELECT id, task_id FROM subtasks WHERE id = ANY($1::uuid[])', [missingSubtasks]);
      subRes.rows.forEach((row: any) => pmsCacheSet(pmsSubtaskCache, row.id, row.task_id, now));
    }

    // 2. All unique task ids (direct + from subtasks)
    const allTaskIds = Array.from(new Set([
      ...directTaskIds,
      ...subtaskIds.map(id => pmsCacheGet(pmsSubtaskCache, id, now)).filter((id): id is string => !!id),
    ]));

    // 3. Task details
    const missingTasks = allTaskIds.filter(id => pmsCacheGet(pmsTaskCache, id, now) === undefined);
    if (missingTasks.length > 0) {
      const taskRes = await pmsPool.query('SELECT id, key_step_id, start_date, end_date FROM project_tasks WHERE id = ANY($1::uuid[])', [missingTasks]);
      taskRes.rows.forEach((row: any) => pmsCacheSet(pmsTaskCache, row.id, {
        keyStepId: row.key_step_id,
        startDate: row.start_date,
        endDate: row.end_date,
      }, now));
    }

    // 4. Key step titles
    const allKeyStepIds = Array.from(new Set(
      allTaskIds
        .map(id => pmsCacheGet(pmsTaskCache, id, now)?.keyStepId)
        .filter((id): id is string => !!id)
    ));
    const missingKeySteps = allKeyStepIds.filter(id => pmsCacheGet(pmsKeyStepCache, id, now) === undefined);
    if (missingKeySteps.length > 0) {
      const keyRes = await pmsPool.query('SELECT id, title FROM key_steps WHERE id = ANY($1::uuid[])', [missingKeySteps]);
      keyRes.rows.forEach((row: any) => pmsCacheSet(pmsKeyStepCache, row.id, row.title, now));
    }
  } catch (err) {
    console.error('[PMS-BATCH-ENRICH] failed to resolve batch data', err);
  }

  // 5. Map back to entries
  return entries.map(e => {
    let taskId = e.pmsId;
    if (e.pmsSubtaskId) {
      taskId = pmsCacheGet(pmsSubtaskCache, e.pmsSubtaskId, now) || null;
    }

    const details = taskId ? pmsCacheGet(pmsTaskCache, taskId, now) : undefined;
    const keyStepName = details?.keyStepId ? pmsCacheGet(pmsKeyStepCache, details.keyStepId, now) : null;

    return {
      ...e,
      keyStep: e.keyStep || keyStepName,
      pmsStartDate: details?.startDate || null,
      pmsEndDate: details?.endDate || null
    };
  });
}

// ---------- Small helpers for fast approve / reject ----------
// Run slow follow-up work (emails) after the HTTP response has already been sent.
function runInBackground(label: string, task: () => Promise<void>) {
  setImmediate(() => {
    task().catch((err) => console.error(`[BACKGROUND:${label}] failed`, err));
  });
}

// Like Promise.all(items.map(fn)) but never more than `limit` calls in flight; result order is preserved.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// "Whole day approved" mail (admin final approval, or manager approval when every task is manager_approved).
async function sendDayApprovalEmail(entry: any, approvedBy: string, kind: 'approved' | 'manager_approved') {
  const allTasks = await storage.getTimeEntriesByEmployeeAndDate(entry.employeeId, entry.date);
  if (allTasks.length === 0 || !allTasks.every(t => t.status === kind)) return;
  const [employee, approver] = await Promise.all([
    storage.getEmployee(entry.employeeId),
    storage.getEmployee(approvedBy),
  ]);
  const { sendApprovalSummaryEmail } = await import('./email');
  let recipients: string[] | undefined;
  if (kind === 'approved') {
    const defaultRecipients = (process.env.SENDER_EMAIL || "").split(",").map(e => e.trim()).filter(Boolean);
    recipients = employee?.email ? [...defaultRecipients, employee.email] : defaultRecipients;
  } else {
    recipients = employee?.email ? [employee.email] : undefined;
  }
  const result = await sendApprovalSummaryEmail({
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    employeeCode: entry.employeeCode,
    date: entry.date,
    tasks: allTasks,
    status: kind,
    recipients,
    approverName: approver?.name,
  });
  if (result?.success) console.log(`[EMAIL] Grouped ${kind} email sent successfully`);
  else console.error(`[EMAIL] Failed to send grouped ${kind} email:`, result?.error || 'Unknown error');
}

// One rejection mail per employee + date listing every rejected task of that day.
async function sendDayRejectionEmail(entry: any, approvedBy: string, reason?: string) {
  const allTasks = await storage.getTimeEntriesByEmployeeAndDate(entry.employeeId, entry.date);
  const rejectedTasks = allTasks.filter(t => t.status === 'rejected');
  const [employee, approver] = await Promise.all([
    storage.getEmployee(entry.employeeId),
    storage.getEmployee(approvedBy),
  ]);
  const { sendApprovalSummaryEmail } = await import('./email');
  const result = await sendApprovalSummaryEmail({
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    employeeCode: entry.employeeCode,
    date: entry.date,
    tasks: rejectedTasks,
    status: 'rejected',
    recipients: employee?.email ? [employee.email] : undefined,
    approverName: approver?.name,
    rejectionReason: reason,
  });
  if (result?.success) console.log('[EMAIL] Grouped rejection email sent successfully');
  else console.error('[EMAIL] Failed to send grouped rejection email:', result?.error || 'Unknown error');
}

// Indexes for the queries the approvals screens run on every load (safe to run repeatedly).
async function ensureTimeEntryIndexes() {
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries (date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_entries_employee_date ON time_entries (employee_id, date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_entries_status ON time_entries (status)`);
  } catch (err) {
    console.error('[INDEXES] could not create time_entries indexes', err);
  }
}

// ---------- Timesheet validation rules (configured by the Admin, stored in the database) ----------
let cachedValidationRules: { rules: ValidationRules; updatedAt: string | null; updatedBy: string | null } | null = null;

async function ensureValidationRulesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheet_validation_settings (
      id VARCHAR(50) PRIMARY KEY,
      rules JSONB NOT NULL,
      updated_by VARCHAR(255),
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
}

async function loadValidationRulesRecord() {
  if (cachedValidationRules) return cachedValidationRules;
  try {
    await ensureValidationRulesTable();
    const r = await pool.query("SELECT rules, updated_by, updated_at FROM timesheet_validation_settings WHERE id = 'default'");
    if (r.rows.length > 0) {
      cachedValidationRules = {
        rules: normalizeValidationRules(r.rows[0].rules),
        updatedAt: r.rows[0].updated_at ? new Date(r.rows[0].updated_at).toISOString() : null,
        updatedBy: r.rows[0].updated_by || null,
      };
      return cachedValidationRules;
    }
  } catch (err) {
    console.error("[VALIDATION-RULES] failed to load saved rules, using starting rules", err);
    return { rules: DEFAULT_VALIDATION_RULES, updatedAt: null, updatedBy: null };
  }
  // Nothing saved yet: starting rules (not cached, so a save is picked up immediately)
  return { rules: DEFAULT_VALIDATION_RULES, updatedAt: null, updatedBy: null };
}

async function getTimesheetRules(): Promise<ValidationRules> {
  return (await loadValidationRulesRecord()).rules;
}

// Keep single enrichment for individual item routes
async function enrichEntry(e: any) {
  const enriched = await batchEnrichEntries([e]);
  return enriched[0];
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  void ensureTimeEntryIndexes();
  registerVoiceRoutes(app);

  // Reports static folder
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fsSync.existsSync(reportsDir)) fsSync.mkdirSync(reportsDir, { recursive: true });
  app.use("/reports", (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  }, express.static(reportsDir, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".pdf") {
        res.setHeader("Content-Type", "application/pdf");
      } else if (ext === ".xlsx") {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      }
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    }
  }));

  // Initialize WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  // Seed managers and default employees on startup
  await storage.seedManagers();
  await storage.seedDefaultEmployees();

  // Create Phase 5 tables if they don't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_memories (
      id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id VARCHAR(255) NOT NULL,
      memory_type VARCHAR(255) NOT NULL,
      memory_key VARCHAR(255) NOT NULL,
      memory_value JSONB NOT NULL,
      usage_count INTEGER DEFAULT 1 NOT NULL,
      last_used_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT ai_memories_employee_type_key_unique UNIQUE (employee_id, memory_type, memory_key)
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id VARCHAR(255) NOT NULL,
      title TEXT NOT NULL,
      messages JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `).catch(err => console.error("Error creating Phase 5 tables on startup:", err));

  // Register Google Calendar OAuth and sync routes
  registerGoogleCalendarRoutes(app);

  // ============ AUTH ROUTES ============
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { employeeCode, password } = req.body;

      if (!employeeCode || !password) {
        return res.status(400).json({ error: "Employee code and password are required" });
      }

      const employee = await storage.validateEmployee(employeeCode, password);

      if (!employee) {
        return res.status(401).json({ error: "Invalid employee code or password" });
      }

      // Don't send password to client
      const { password: _, ...safeEmployee } = employee;
      res.json({ user: safeEmployee });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/request-otp", async (req, res) => {
    try {
      const { employeeCode } = req.body;

      if (!employeeCode) {
        return res.status(400).json({ error: "Employee code is required" });
      }

      const employee = await storage.getEmployeeByCode(employeeCode);
      if (!employee) {
        // Don't reveal whether code exists — generic message
        return res.json({ message: "If this employee code exists, an OTP has been sent." });
      }

      if (!employee.email) {
        return res.status(400).json({ error: "No email address registered for this employee code. Contact your administrator." });
      }

      // Delete any existing unused OTPs for this employee
      await storage.deleteExistingOTPs(employeeCode);

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP
      await storage.createOTP(employeeCode, otp, expiresAt);

      // Send OTP email via Resend
      await sendEmail({
        to: [employee.email],
        subject: "Timestrap Password Reset OTP",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <h2 style="color: #2563EB;">Password Reset Request</h2>
            <p>Hi ${employee.name},</p>
            <p>Your one-time password (OTP) for resetting your Timestrap password is:</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2563EB; text-align: center; padding: 20px; background: #f0f4ff; border-radius: 8px; margin: 20px 0;">
              ${otp}
            </div>
            <p>This OTP expires in <strong>10 minutes</strong> and can only be used once.</p>
            <p>If you did not request this, please ignore this email — your password has not been changed.</p>
          </div>
        `
      });

      res.json({ message: "If this employee code exists, an OTP has been sent." });
    } catch (error) {
      console.error("Request OTP error:", error);
      res.status(500).json({ error: "Failed to request OTP" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { employeeCode, otp, newPassword, confirmPassword } = req.body;

      if (!employeeCode || !otp || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: "All fields are required" });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      // Verify OTP
      const otpRecord = await storage.getValidOTP(employeeCode, otp);
      if (!otpRecord) {
        return res.status(400).json({ error: "Invalid or expired OTP. Please request a new one." });
      }

      // Mark OTP as used
      await storage.markOTPUsed(otpRecord.id);

      // Reset password
      const employee = await storage.getEmployeeByCode(employeeCode);
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateEmployeePassword(employeeCode, hashedPassword);

      // Send confirmation email
      if (employee?.email) {
        try {
          await sendEmail({
            to: [employee.email],
            subject: "Timestrap Password Changed Successfully",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
                <h2 style="color: #16a34a;">Password Changed Successfully</h2>
                <p>Hi ${employee.name},</p>
                <p>Your Timestrap password was successfully reset at ${new Date().toLocaleString()}.</p>
                <p>If you did not make this change, contact your administrator immediately.</p>
              </div>
            `
          });
        } catch (emailError) {
          console.error("Failed to send password confirmation email:", emailError);
        }
      }

      res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ============ EMAIL TEST ROUTE ============
  app.get("/api/test/email-config", async (req, res) => {
    res.json({
      RESEND_API_KEY: process.env.RESEND_API_KEY ? "✓ Present" : "✗ Missing",
      FROM_EMAIL: process.env.FROM_EMAIL || "Not set",
      SENDER_EMAIL: process.env.SENDER_EMAIL || "Not set",
    });
  });

  // ============ ORGANISATION ROUTES ============
  app.get("/api/organisations", async (req, res) => {
    try {
      const orgs = await storage.getOrganisations();
      res.json(orgs);
    } catch (error) {
      console.error("Get organisations error:", error);
      res.status(500).json({ error: "Failed to fetch organisations" });
    }
  });

  app.post("/api/organisations", async (req, res) => {
    try {
      const result = insertOrganisationSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      const org = await storage.createOrganisation(result.data);
      broadcast("organisation_created", org);
      res.status(201).json(org);
    } catch (error) {
      console.error("Create organisation error:", error);
      res.status(500).json({ error: "Failed to create organisation" });
    }
  });

  app.patch("/api/organisations/:id", async (req, res) => {
    try {
      const org = await storage.updateOrganisation(req.params.id, req.body);
      if (!org) {
        return res.status(404).json({ error: "Organisation not found" });
      }
      broadcast("organisation_updated", org);
      res.json(org);
    } catch (error) {
      console.error("Update organisation error:", error);
      res.status(500).json({ error: "Failed to update organisation" });
    }
  });

  app.delete("/api/organisations/:id", async (req, res) => {
    try {
      await storage.deleteOrganisation(req.params.id);
      broadcast("organisation_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete organisation error:", error);
      res.status(500).json({ error: "Failed to delete organisation" });
    }
  });

  // ============ DEPARTMENT ROUTES ============
  app.get("/api/departments", async (req, res) => {
    try {
      const depts = await storage.getDepartments();
      res.json(depts);
    } catch (error) {
      console.error("Get departments error:", error);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  });

  app.post("/api/departments", async (req, res) => {
    try {
      const result = insertDepartmentSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      const dept = await storage.createDepartment(result.data);
      broadcast("department_created", dept);
      res.status(201).json(dept);
    } catch (error) {
      console.error("Create department error:", error);
      res.status(500).json({ error: "Failed to create department" });
    }
  });

  app.patch("/api/departments/:id", async (req, res) => {
    try {
      const dept = await storage.updateDepartment(req.params.id, req.body);
      if (!dept) {
        return res.status(404).json({ error: "Department not found" });
      }
      broadcast("department_updated", dept);
      res.json(dept);
    } catch (error) {
      console.error("Update department error:", error);
      res.status(500).json({ error: "Failed to update department" });
    }
  });

  app.delete("/api/departments/:id", async (req, res) => {
    try {
      await storage.deleteDepartment(req.params.id);
      broadcast("department_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete department error:", error);
      res.status(500).json({ error: "Failed to delete department" });
    }
  });

  // ============ GROUP ROUTES ============
  app.get("/api/groups", async (req, res) => {
    try {
      const grps = await storage.getGroups();
      res.json(grps);
    } catch (error) {
      console.error("Get groups error:", error);
      res.status(500).json({ error: "Failed to fetch groups" });
    }
  });

  app.post("/api/groups", async (req, res) => {
    try {
      const result = insertGroupSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      const group = await storage.createGroup(result.data);
      broadcast("group_created", group);
      res.status(201).json(group);
    } catch (error) {
      console.error("Create group error:", error);
      res.status(500).json({ error: "Failed to create group" });
    }
  });

  app.patch("/api/groups/:id", async (req, res) => {
    try {
      const group = await storage.updateGroup(req.params.id, req.body);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      broadcast("group_updated", group);
      res.json(group);
    } catch (error) {
      console.error("Update group error:", error);
      res.status(500).json({ error: "Failed to update group" });
    }
  });

  app.delete("/api/groups/:id", async (req, res) => {
    try {
      await storage.deleteGroup(req.params.id);
      broadcast("group_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete group error:", error);
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  // ============ EMPLOYEE ROUTES ============
  app.get("/api/employees", async (req, res) => {
    try {
      const emps = await storage.getEmployees();
      // Remove passwords from response
      const safeEmps = emps.map(({ password, ...emp }) => emp);
      res.json(safeEmps);
    } catch (error) {
      console.error("Get employees error:", error);
      res.status(500).json({ error: "Failed to fetch employees" });
    }
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const result = insertEmployeeSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      // Check if employee code already exists
      const existing = await storage.getEmployeeByCode(result.data.employeeCode);
      if (existing) {
        return res.status(400).json({ error: "Employee code already exists" });
      }

      const emp = await storage.createEmployee(result.data);
      const { password, ...safeEmp } = emp;
      broadcast("employee_created", safeEmp);
      res.status(201).json(safeEmp);
    } catch (error) {
      console.error("Create employee error:", error);
      res.status(500).json({ error: "Failed to create employee" });
    }
  });

  // ============ ACTUAL WORKED TOOLS (read-only, auto-fetched) ============
  // Returns every TimeGuard activity/tool log row (app + website activity)
  // whose window overlaps the given Timestrap session's [startTime, endTime).
  // Pure read/display — no manual entry, nothing derived or invented.
  app.get("/api/timeguard/actual-worked-tools", async (req, res) => {
    try {
      const { employeeCode, date, startTime, endTime } = req.query as Record<string, string>;
      if (!employeeCode || !date || !startTime || !endTime) {
        return res.status(400).json({ error: "employeeCode, date, startTime, and endTime are required" });
      }
      const entries = await getActualWorkedTools(employeeCode, date, startTime, endTime);
      res.json({ entries });
    } catch (error) {
      console.error("Get actual worked tools error:", error);
      res.status(500).json({ error: "Failed to fetch actual worked tools" });
    }
  });

  // ============ STEP 5 — DAY-LEVEL RULE-BASED TASK MATCHING ============
  // Returns the employee's full-day Activity Timeline, each block already
  // matched (or not) against their planned tasks for the day, with a
  // Matched / Partial Match / Unclassified status. Deterministic, no AI —
  // this is what Step 6 (Warning & Enforcement Engine) should poll/consume
  // to detect when an employee is off-plan.
  app.get("/api/timeguard/day-activity-matches", async (req, res) => {
    try {
      const { employeeCode, date } = req.query as Record<string, string>;
      if (!employeeCode || !date) {
        return res.status(400).json({ error: "employeeCode and date are required" });
      }
      const blocks = await getDayActivityMatches(employeeCode, date);
      res.json({ blocks });
    } catch (error) {
      console.error("Get day activity matches error:", error);
      res.status(500).json({ error: "Failed to fetch day activity matches" });
    }
  });

  // ============ STEP 7 — AUTOMATIC TIMESHEET ============
  // Generate: pulls the day's Activity Timeline matches (Step 5) and writes
  // actual start/end, active/idle seconds, and match status onto each
  // planned time_entries row for the day. Safe to call repeatedly before
  // submission — each call refreshes with the latest activity data.
  app.post("/api/timesheet/generate", async (req, res) => {
    try {
      const { employeeCode, date } = req.body;
      if (!employeeCode || !date) {
        return res.status(400).json({ error: "employeeCode and date are required" });
      }
      const results = await generateTimesheetForDay(employeeCode, date);
      res.json({ generated: results });
    } catch (error) {
      console.error("Generate timesheet error:", error);
      res.status(500).json({ error: "Failed to generate timesheet" });
    }
  });

  // Submit: locks in every generated (not-yet-submitted) row for the day as
  // final. Rows that were never generated are skipped and reported back so
  // the employee can be warned rather than silently submitting stale data.
  app.post("/api/timesheet/submit", async (req, res) => {
    try {
      const { employeeCode, date } = req.body;
      if (!employeeCode || !date) {
        return res.status(400).json({ error: "employeeCode and date are required" });
      }
      const result = await submitTimesheetForDay(employeeCode, date);
      res.json(result);
    } catch (error) {
      console.error("Submit timesheet error:", error);
      res.status(500).json({ error: "Failed to submit timesheet" });
    }
  });

  // ============ STEP 6 — ENFORCEMENT CONFIG ============
  // Returns the effective grace period / warning count / interval / lock-enabled
  // settings for an employee, resolved department-first then organisation-wide,
  // falling back to hardcoded defaults if nothing is configured yet.
  app.get("/api/settings/enforcement-config", async (req, res) => {
    try {
      const { employeeCode } = req.query as Record<string, string>;
      if (!employeeCode) {
        return res.status(400).json({ error: "employeeCode is required" });
      }

      const [employee] = await db
        .select()
        .from(employees)
        .where(eq(employees.employeeCode, employeeCode))
        .limit(1);

      const DEFAULTS = {
        gracePeriodSeconds: 300,
        warningIntervalSeconds: 300,
        warningCount: 3,
        lockEnabled: true,
        urgentBlockedCountsTowardLock: false,
      };

      if (!employee) {
        return res.json(DEFAULTS);
      }

      // Department-specific config takes priority over the org-wide default.
      let config = null;
      if (employee.department) {
        const rows = await db
          .select()
          .from(enforcementConfigs)
          .where(
            and(
              eq(enforcementConfigs.organisationId, employee.organisationId ?? ""),
              eq(enforcementConfigs.department, employee.department)
            )
          )
          .limit(1);
        config = rows[0] ?? null;
      }

      if (!config) {
        const rows = await db
          .select()
          .from(enforcementConfigs)
          .where(
            and(
              eq(enforcementConfigs.organisationId, employee.organisationId ?? ""),
              isNull(enforcementConfigs.department)
            )
          )
          .limit(1);
        config = rows[0] ?? null;
      }

      if (!config) {
        return res.json(DEFAULTS);
      }

      res.json({
        gracePeriodSeconds: config.gracePeriodSeconds,
        warningIntervalSeconds: config.warningIntervalSeconds,
        warningCount: config.warningCount,
        lockEnabled: config.lockEnabled,
        urgentBlockedCountsTowardLock: config.urgentBlockedCountsTowardLock,
      });
    } catch (error) {
      console.error("Get enforcement config error:", error);
      // Fail safe: never block the agent's poll loop on a config error.
      res.json({
        gracePeriodSeconds: 300,
        warningIntervalSeconds: 300,
        warningCount: 3,
        lockEnabled: true,
        urgentBlockedCountsTowardLock: false,
      });
    }
  });

  // Admin-facing: create/update the enforcement config for an org or a
  // specific department within it. Pass department: null for the org default.
  app.post("/api/settings/enforcement-config", async (req, res) => {
    try {
      const {
        organisationId,
        department,
        gracePeriodSeconds,
        warningIntervalSeconds,
        warningCount,
        lockEnabled,
        urgentBlockedCountsTowardLock,
      } = req.body;

      if (!organisationId) {
        return res.status(400).json({ error: "organisationId is required" });
      }

      const whereClause = department
        ? and(eq(enforcementConfigs.organisationId, organisationId), eq(enforcementConfigs.department, department))
        : and(eq(enforcementConfigs.organisationId, organisationId), isNull(enforcementConfigs.department));

      const existing = await db.select().from(enforcementConfigs).where(whereClause).limit(1);

      if (existing[0]) {
        const [updated] = await db
          .update(enforcementConfigs)
          .set({
            gracePeriodSeconds: gracePeriodSeconds ?? existing[0].gracePeriodSeconds,
            warningIntervalSeconds: warningIntervalSeconds ?? existing[0].warningIntervalSeconds,
            warningCount: warningCount ?? existing[0].warningCount,
            lockEnabled: lockEnabled ?? existing[0].lockEnabled,
            urgentBlockedCountsTowardLock: urgentBlockedCountsTowardLock ?? existing[0].urgentBlockedCountsTowardLock,
            updatedAt: new Date(),
          })
          .where(eq(enforcementConfigs.id, existing[0].id))
          .returning();
        return res.json(updated);
      }

      const [created] = await db
        .insert(enforcementConfigs)
        .values({
          organisationId,
          department: department ?? null,
          gracePeriodSeconds: gracePeriodSeconds ?? 300,
          warningIntervalSeconds: warningIntervalSeconds ?? 300,
          warningCount: warningCount ?? 3,
          lockEnabled: lockEnabled ?? true,
          urgentBlockedCountsTowardLock: urgentBlockedCountsTowardLock ?? false,
        })
        .returning();
      res.json(created);
    } catch (error) {
      console.error("Save enforcement config error:", error);
      res.status(500).json({ error: "Failed to save enforcement config" });
    }
  });

  // ============ STEP 6 — WARNING RESPONSE AUDIT TRAIL ============
  app.post("/api/timeguard/warning-response", async (req, res) => {
    try {
      const { employeeCode, warningNumber, response, reason } = req.body;
      if (!employeeCode || !warningNumber || !response) {
        return res.status(400).json({ error: "employeeCode, warningNumber, and response are required" });
      }
      const [log] = await db
        .insert(deviationWarningLogs)
        .values({ employeeCode, warningNumber, response, reason: reason ?? null })
        .returning();
      res.json(log);
    } catch (error) {
      console.error("Log warning response error:", error);
      res.status(500).json({ error: "Failed to log warning response" });
    }
  });

  // ============ STEP 6 — ADMIN OVERRIDE ============
  // Admin/manager-facing: create an override that will clear a locked
  // employee's TimeGuard lock. The agent polls for this while locked.
  app.post("/api/timeguard/admin-override", async (req, res) => {
    try {
      const { employeeCode, adminId, reason } = req.body;
      if (!employeeCode || !adminId || !reason) {
        return res.status(400).json({ error: "employeeCode, adminId, and reason are required" });
      }
      const [override] = await db
        .insert(deviationOverrides)
        .values({ employeeCode, adminId, reason })
        .returning();
      res.json(override);
    } catch (error) {
      console.error("Create admin override error:", error);
      res.status(500).json({ error: "Failed to create admin override" });
    }
  });

  // Agent-facing: check for (and consume) an unconsumed override for this
  // employee. Returns { override: null } if none is pending.
  app.post("/api/timeguard/check-override", async (req, res) => {
    try {
      const { employeeCode } = req.body;
      if (!employeeCode) {
        return res.status(400).json({ error: "employeeCode is required" });
      }
      const rows = await db
        .select()
        .from(deviationOverrides)
        .where(and(eq(deviationOverrides.employeeCode, employeeCode), isNull(deviationOverrides.consumedAt)))
        .limit(1);

      const pending = rows[0];
      if (!pending) {
        return res.json({ override: null });
      }

      const [consumed] = await db
        .update(deviationOverrides)
        .set({ consumedAt: new Date() })
        .where(eq(deviationOverrides.id, pending.id))
        .returning();

      res.json({ override: consumed });
    } catch (error) {
      console.error("Check override error:", error);
      res.status(500).json({ error: "Failed to check override" });
    }
  });

  // ============ TIMEGUARD ACTIVITY SUMMARY (for Description/Achievements autofill) ============
  // Returns tool usage minutes TimeGuard actually logged for the given
  // employee/date/time-window — factual data only, never invents content.
  app.get("/api/timeguard/activity-summary", async (req, res) => {
    try {
      const { employeeCode, date, startTime, endTime } = req.query as Record<string, string>;
      if (!employeeCode || !date || !startTime || !endTime) {
        return res.status(400).json({ error: "employeeCode, date, startTime, and endTime are required" });
      }
      const summary = await getToolActivitySummary(employeeCode, date, startTime, endTime);
      res.json(summary);
    } catch (error) {
      console.error("Get TimeGuard activity summary error:", error);
      res.status(500).json({ error: "Failed to fetch TimeGuard activity summary" });
    }
  });

  // ============ AI-DRAFTED WORK SUMMARY (from TimeGuard activity_logs) ============
  // Infers what work was actually done (not just which apps were open) from
  // TimeGuard's window titles/URLs/file names, and drafts Description,
  // Achievements, and Quantify Your Result. Always a suggestion the employee
  // reviews/edits — never auto-saved as final.
  app.get("/api/timeguard/suggest-work-summary", async (req, res) => {
    try {
      const settings = await readSettings();
      if (settings.timeguardSuggestionsEnabled === false) {
        return res.status(403).json({ error: "TimeGuard suggestions are currently disabled", disabled: true });
      }
      const { employeeCode, date, startTime, endTime, project, taskTitle, subTask } = req.query as Record<string, string>;
      if (!employeeCode || !date || !startTime || !endTime) {
        return res.status(400).json({ error: "employeeCode, date, startTime, and endTime are required" });
      }
      const result = await suggestWorkSummaryFromTimeGuard({
        employeeCode,
        date,
        startTime,
        endTime,
        project,
        taskTitle,
        subTask,
      });
      res.json(result);
    } catch (error) {
      console.error("Suggest work summary error:", error);
      res.status(500).json({ error: "Failed to generate work summary suggestion" });
    }
  });

  // ============ EMPLOYEE TOOL VALIDATION SETTING ============
  app.patch("/api/employees/:id/tool-validation", async (req, res) => {
    try {
      const { id } = req.params;
      const { enforceToolValidation } = req.body;
      if (typeof enforceToolValidation !== "boolean") {
        return res.status(400).json({ error: "enforceToolValidation must be a boolean" });
      }
      const updated = await storage.updateEmployeeToolValidation(id, enforceToolValidation);
      if (!updated) {
        return res.status(404).json({ error: "Employee not found" });
      }
      const { password, ...safeEmp } = updated;
      res.json(safeEmp);
    } catch (error) {
      console.error("Update tool validation error:", error);
      res.status(500).json({ error: "Failed to update tool validation setting" });
    }
  });

  // ============ MANAGER ROUTES ============
  app.get("/api/managers", async (req, res) => {
    try {
      const mgrs = await storage.getManagers();
      res.json(mgrs);
    } catch (error) {
      console.error("Get managers error:", error);
      res.status(500).json({ error: "Failed to fetch managers" });
    }
  });

  // ============ PROJECTS ROUTES ============
  app.get("/api/projects", async (req, res) => {
    try {
      const { userRole, userEmpCode, userDepartment } = req.query;
      const projects = await storage.getProjects(userRole as string, userEmpCode as string, userDepartment as string);
      res.json(projects);
    } catch (error) {
      console.error("Get projects error:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const project = await storage.createProject(req.body);
      broadcast("project_created", project);
      res.status(201).json(project);
    } catch (error) {
      console.error("Create project error:", error);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  // ============ TASKS ROUTES ============
  app.get("/api/tasks", async (req, res) => {
    try {
      const { projectId, userDepartment, userEmpCode, userRole } = req.query;
      const tasks = await storage.getTasks(
        projectId as string,
        userDepartment as string,
        userEmpCode as string,
        userRole as string
      );
      res.json(tasks);
    } catch (error) {
      console.error("Get tasks error:", error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const task = await storage.createTask(req.body);
      broadcast("task_created", task);
      res.status(201).json(task);
    } catch (error) {
      console.error("Create task error:", error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // ============ SUBTASKS ROUTES ============
  // NOTE: this is the single source of truth for GET /api/subtasks. It scopes subtasks
  // strictly to the given taskId (and optionally the caller's department/employee code),
  // so the Plan-for-Day and Tracker subtask dropdowns only ever show subtasks that belong
  // to the currently selected task. There used to be a second, duplicate handler for this
  // same route further down in this file — Express only ever invokes the first-registered
  // handler for a given method+path, so that second definition was silently dead code and
  // its userEmpCode-scoped filtering never actually ran. It has been removed; do not
  // re-add a second "/api/subtasks" GET handler.
  app.get("/api/subtasks", async (req, res) => {
    try {
      const { taskId, userDepartment, userEmpCode } = req.query;
      const { getSubtasks } = await import('./pmsSupabase');
      const subtasks = await getSubtasks(taskId as string, userDepartment as string, userEmpCode as string);
      res.json(subtasks);
    } catch (error) {
      console.error("Get subtasks error:", error);
      res.status(500).json({ error: "Failed to fetch subtasks" });
    }
  });

  app.post("/api/subtasks", async (req, res) => {
    try {
      const subtask = await storage.createSubtask(req.body);
      broadcast("subtask_created", subtask);
      res.status(201).json(subtask);
    } catch (error) {
      console.error("Create subtask error:", error);
      res.status(500).json({ error: "Failed to create subtask" });
    }
  });

  // ============ CALENDAR EVENTS (backed directly by PMS's Postgres DB) ============
  // Note: only "manual" calendar events go through here. Timestrap's
  // separate daily-plan scheduling system is untouched.
  //
  // NOTE: uses employeeCode (not Timestrap's internal user id) — that's what
  // PMS's calendar_events.user_id actually resolves against. See
  // pmsCalendarEvents.ts for why.
  app.get("/api/calendar-events", async (req, res) => {
    try {
      const { employeeCode, date } = req.query;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      const events = await getPmsCalendarEvents(employeeCode as string, date as string | undefined);
      res.json(events);
    } catch (error) {
      console.error("Get PMS calendar events error:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  app.post("/api/calendar-events", async (req, res) => {
    try {
      const { employeeCode, ...evt } = req.body;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      const created = await createPmsCalendarEvent(employeeCode, evt);
      if (!created) return res.status(404).json({ error: "No matching PMS user account found for this employee code" });
      res.status(201).json(created);
    } catch (error) {
      console.error("Create PMS calendar event error:", error);
      res.status(500).json({ error: "Failed to create calendar event" });
    }
  });

  app.put("/api/calendar-events/:id", async (req, res) => {
    try {
      const { employeeCode, ...evt } = req.body;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      const updated = await updatePmsCalendarEvent(req.params.id, employeeCode, evt);
      if (!updated) return res.status(404).json({ error: "Event not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update PMS calendar event error:", error);
      res.status(500).json({ error: "Failed to update calendar event" });
    }
  });

  app.delete("/api/calendar-events/:id", async (req, res) => {
    try {
      const { employeeCode } = req.query;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      const deleted = await deletePmsCalendarEvent(req.params.id, employeeCode as string);
      if (!deleted) return res.status(404).json({ error: "Event not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete PMS calendar event error:", error);
      res.status(500).json({ error: "Failed to delete calendar event" });
    }
  });

  // ============ PLAN-FOR-THE-DAY EVENTS: shared with PMS ============
  // Written on plan submission, and kept in sync when a plan task is
  // edited/dragged/deleted on the Calendar page.
  app.post("/api/calendar-events/plan-sync", async (req, res) => {
    try {
      const payload = req.body;
      if (!payload.employeeCode || !payload.taskId) return res.status(400).json({ error: "employeeCode and taskId are required" });
      const synced = await upsertPmsPlanCalendarEvent(payload.employeeCode, payload);
      res.json(synced);
    } catch (error) {
      console.error("Plan calendar sync error:", error);
      res.status(500).json({ error: "Failed to sync plan event to PMS" });
    }
  });

  app.delete("/api/calendar-events/plan-sync/:taskId", async (req, res) => {
    try {
      const { employeeCode } = req.query;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      await deletePmsPlanCalendarEvent(employeeCode as string, req.params.taskId);
      res.json({ success: true });
    } catch (error) {
      console.error("Plan calendar delete-sync error:", error);
      res.status(500).json({ error: "Failed to remove synced plan event from PMS" });
    }
  });

  // ============ CALENDAR EVENT GUESTS (Timestrap-owned, separate from PMS) ============
  // Guests + guest permissions for a calendar event (manual or plan/task). Stored
  // in Timestrap's own DB, keyed by (employeeCode, eventId), so this never has to
  // guess at columns that may or may not exist on PMS's shared calendar_events table.
  app.get("/api/calendar-events/:id/guests", async (req, res) => {
    try {
      const { employeeCode } = req.query;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });

      const guestsResult = await pool.query(
        `SELECT id, name, email, is_external, optional FROM calendar_event_guests WHERE employee_code = $1 AND event_id = $2 ORDER BY created_at ASC`,
        [employeeCode, req.params.id]
      );
      const settingsResult = await pool.query(
        `SELECT guests_can_modify, guests_can_invite, guests_can_see_guest_list FROM calendar_event_settings WHERE employee_code = $1 AND event_id = $2`,
        [employeeCode, req.params.id]
      );
      const settings = settingsResult.rows[0] || { guests_can_modify: false, guests_can_invite: true, guests_can_see_guest_list: true };

      res.json({
        guests: guestsResult.rows.map((row) => ({
          id: row.id,
          name: row.name || row.email,
          email: row.email,
          isExternal: !!row.is_external,
          optional: !!row.optional,
        })),
        guestsCanModify: !!settings.guests_can_modify,
        guestsCanInvite: !!settings.guests_can_invite,
        guestsCanSeeGuestList: !!settings.guests_can_see_guest_list,
      });
    } catch (error) {
      console.error("Get calendar event guests error:", error);
      res.status(500).json({ error: "Failed to load guests" });
    }
  });

  app.put("/api/calendar-events/:id/guests", async (req, res) => {
    const client = await pool.connect();
    try {
      const { employeeCode, guests, guestsCanModify, guestsCanInvite, guestsCanSeeGuestList } = req.body;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      const eventId = req.params.id;
      const guestList = Array.isArray(guests) ? guests : [];

      await client.query("BEGIN");
      await client.query(`DELETE FROM calendar_event_guests WHERE employee_code = $1 AND event_id = $2`, [employeeCode, eventId]);
      for (const g of guestList) {
        if (!g?.email) continue;
        await client.query(
          `INSERT INTO calendar_event_guests (event_id, employee_code, name, email, is_external, optional)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [eventId, employeeCode, g.name || g.email, g.email, !!g.isExternal, !!g.optional]
        );
      }
      await client.query(
        `INSERT INTO calendar_event_settings (event_id, employee_code, guests_can_modify, guests_can_invite, guests_can_see_guest_list)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_code, event_id) DO UPDATE SET
           guests_can_modify = EXCLUDED.guests_can_modify,
           guests_can_invite = EXCLUDED.guests_can_invite,
           guests_can_see_guest_list = EXCLUDED.guests_can_see_guest_list`,
        [eventId, employeeCode, !!guestsCanModify, guestsCanInvite !== false, guestsCanSeeGuestList !== false]
      );
      await client.query("COMMIT");

      res.json({ success: true, guests: guestList });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Save calendar event guests error:", error);
      res.status(500).json({ error: "Failed to save guests" });
    } finally {
      client.release();
    }
  });

  // When a manual/plan event is deleted, its guest rows should go with it.
  app.delete("/api/calendar-events/:id/guests", async (req, res) => {
    try {
      const { employeeCode } = req.query;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      await pool.query(`DELETE FROM calendar_event_guests WHERE employee_code = $1 AND event_id = $2`, [employeeCode, req.params.id]);
      await pool.query(`DELETE FROM calendar_event_settings WHERE employee_code = $1 AND event_id = $2`, [employeeCode, req.params.id]);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete calendar event guests error:", error);
      res.status(500).json({ error: "Failed to delete guests" });
    }
  });

  // ============ GOOGLE CALENDAR STATUS (read-only, backed by PMS's DB) ============
  // Connecting Google still has to happen on PMS's server (it holds the
  // OAuth client secret) — the client links out to PMS's own connect URL.
  // Disconnect is a plain DB delete, so it's safe to do from here directly.
  app.get("/api/google/status", async (req, res) => {
    try {
      const { employeeCode } = req.query;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      const status = await getPmsGoogleStatus(employeeCode as string);
      res.json(status);
    } catch (error) {
      console.error("Get PMS Google status error:", error);
      res.status(500).json({ error: "Failed to fetch Google Calendar status" });
    }
  });

  app.post("/api/google/disconnect", async (req, res) => {
    try {
      const { employeeCode } = req.body;
      if (!employeeCode) return res.status(400).json({ error: "employeeCode is required" });
      await disconnectPmsGoogle(employeeCode);
      res.json({ success: true });
    } catch (error) {
      console.error("Disconnect PMS Google error:", error);
      res.status(500).json({ error: "Failed to disconnect Google Calendar" });
    }
  });

  // ============ KEY STEPS ROUTE (PMS) ============
  app.get('/api/key-steps', async (req, res) => {
    const { projectId } = req.query;
    try {
      if (!projectId) return res.json([]);

      // Query PMS DB for key steps tied to the project code
      const query = `
        SELECT ks.id, ks.title AS name
        FROM key_steps ks
        INNER JOIN projects p ON ks.project_id = p.id
        WHERE p.project_code = $1
        ORDER BY ks.title
      `;
      const result = await pmsPool.query(query, [projectId]);
      const rows = result && result.rows ? result.rows : [];
      res.json(rows);
    } catch (error) {
      console.error('❌ Get key steps error for projectId:', projectId, error);
      res.status(500).json([]);
    }
  });

  // ============ LMS ROUTES ============
  const lmsHoursCache = new Map<string, { v: any; exp: number }>();
  app.get("/api/lms/hours", async (req, res) => {
    try {
      const { employeeCode, date } = req.query;
      if (!employeeCode || !date) {
        return res.status(400).json({ error: "employeeCode and date are required" });
      }
      const lmsKey = `${employeeCode}|${date}`;
      const cachedLms = lmsHoursCache.get(lmsKey);
      if (cachedLms && cachedLms.exp > Date.now()) return res.json(cachedLms.v);
      const hours = await getLMSHours(employeeCode as string, date as string);
      if (lmsHoursCache.size > 5000) lmsHoursCache.clear();
      lmsHoursCache.set(lmsKey, { v: hours, exp: Date.now() + 5 * 60 * 1000 });
      res.json(hours);
    } catch (error) {
      console.error("Get LMS hours error:", error);
      res.status(500).json({ error: "Failed to fetch LMS hours" });
    }
  });

  app.get('/api/employee/leave-status', async (req, res) => {
    try {
      const { employeeCode, date } = req.query;
      if (!employeeCode || !date) {
        return res.status(400).json({ error: 'employeeCode and date are required' });
      }

      const status = await getLeaveStatusForDate(String(employeeCode), String(date));
      res.json(status);
    } catch (error) {
      console.error('[LEAVE STATUS] Failed to fetch leave status:', error);
      res.status(500).json({ error: 'Failed to fetch leave status' });
    }
  });

  // ============ TIME ENTRY ROUTES ============

  // Approvals page feed: excludes 'draft' entries (created only when an employee submits
  // their Plan for the Day, before the timesheet itself is submitted) and, by default, is
  // scoped to a date range (the page defaults to the current month) so we don't ship the
  // entire time_entries table to the browser on every load.
  app.get("/api/time-entries/approvals", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const entries = await storage.getApprovalTimeEntries(
        startDate as string | undefined,
        endDate as string | undefined
      );
      const enriched = await batchEnrichEntries(entries);
      res.json(enriched);
    } catch (error) {
      console.error("Get approval time entries error:", error);
      res.status(500).json({ error: "Failed to fetch approval time entries" });
    }
  });

  // ============ ADMIN APPROVAL TAB (automatic timesheet review) ============
  // Approval conditions come from the rules the admin saved in the Admin Approval tab (stage "approve").
  const ADMIN_REVIEW_ELIGIBLE = ["pending", "resubmitted", "manager_approved"];
  const ADMIN_REVIEW_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const ADMIN_REVIEW_MAX_DAYS = 93;

  const loadReviewAdmin = async (adminId: unknown) => {
    if (typeof adminId !== "string" || !adminId) return null;
    const admin = await storage.getEmployee(adminId);
    return admin && admin.role === "admin" ? admin : null;
  };

  const validateReviewRange = (startDate: unknown, endDate: unknown): string | null => {
    if (typeof startDate !== "string" || typeof endDate !== "string" ||
      !ADMIN_REVIEW_DATE_RE.test(startDate) || !ADMIN_REVIEW_DATE_RE.test(endDate)) {
      return "Start Date and End Date must be in YYYY-MM-DD format";
    }
    const s = Date.parse(startDate);
    const e = Date.parse(endDate);
    if (Number.isNaN(s) || Number.isNaN(e)) return "Invalid Start Date or End Date";
    if (s > e) return "Start Date must be on or before End Date";
    if ((e - s) / 86400000 + 1 > ADMIN_REVIEW_MAX_DAYS) return `Date range cannot exceed ${ADMIN_REVIEW_MAX_DAYS} days`;
    return null;
  };

  // ----- Validation rules settings (Admin Approval tab -> Validation Rules) -----
  app.get("/api/timesheet-validation-rules", async (_req, res) => {
    try {
      const record = await loadValidationRulesRecord();
      res.json(record);
    } catch (error) {
      console.error("Get validation rules error:", error);
      res.status(500).json({ error: "Failed to load validation rules" });
    }
  });

  app.put("/api/timesheet-validation-rules", async (req, res) => {
    try {
      const admin = await loadReviewAdmin(req.body?.adminId);
      if (!admin) return res.status(403).json({ error: "Only admins can change the validation rules" });
      if (!req.body?.rules || typeof req.body.rules !== "object") {
        return res.status(400).json({ error: "rules are required" });
      }
      const rules = normalizeValidationRules(req.body.rules);
      await ensureValidationRulesTable();
      await pool.query(
        `INSERT INTO timesheet_validation_settings (id, rules, updated_by, updated_at)
         VALUES ('default', $1::jsonb, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [JSON.stringify(rules), admin.name]
      );
      cachedValidationRules = null;
      const record = await loadValidationRulesRecord();
      broadcast("validation_rules_updated", record);
      res.json(record);
    } catch (error) {
      console.error("Save validation rules error:", error);
      res.status(500).json({ error: "Failed to save validation rules" });
    }
  });

  const reviewEntryLabels = (entry: any) => {
    const parts = String(entry.taskDescription || "").split(" | ");
    return { project: entry.projectName || "", task: [parts[0], parts[1]].filter(Boolean).join(" › ") || "—" };
  };

  app.post("/api/time-entries/admin-review", async (req, res) => {
    try {
      const { adminId, employeeId, startDate, endDate } = req.body || {};
      const admin = await loadReviewAdmin(adminId);
      if (!admin) return res.status(403).json({ error: "Only admins can run the Admin Approval review" });

      const rangeError = validateReviewRange(startDate, endDate);
      if (rangeError) return res.status(400).json({ error: rangeError });
      if (typeof employeeId !== "string" || !employeeId) return res.status(400).json({ error: "Employee is required" });

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ error: "Employee not found" });

      const rules = await getTimesheetRules();

      // Strictly this employee, strictly inside [startDate, endDate], never drafts.
      const all = await storage.getTimeEntriesByEmployee(employeeId);
      const rawInScope = all.filter((e) => {
        const d = String(e.date || "").slice(0, 10);
        return e.employeeId === employeeId && e.status !== "draft" && d >= startDate && d <= endDate;
      });
      // Key Step is resolved from PMS when it is not stored on the entry (same as the Approvals list).
      // If PMS is unreachable we must not mass-reject entries for a "missing" Key Step.
      if (rules.keyStep.approve && rawInScope.some((e) => !e.keyStep && (e.pmsId || e.pmsSubtaskId))) {
        try {
          await pmsPool.query("SELECT 1");
        } catch {
          return res.status(503).json({ error: "PMS is unreachable, so Key Step cannot be verified right now. Please try again shortly." });
        }
      }
      const inScope = await batchEnrichEntries(rawInScope);
      const byDate = new Map<string, typeof inScope>();
      for (const e of inScope) {
        const d = String(e.date).slice(0, 10);
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d)!.push(e);
      }

      const { sendApprovalSummaryEmail, sendAdminReviewRejectionEmail, sendAdminReviewReportEmail } = await import("./email");
      const defaultRecipients = (process.env.SENDER_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);

      const dates: any[] = [];
      const totals = { dates: 0, entries: 0, approved: 0, rejected: 0, skipped: 0 };
      const emailJobs: (() => Promise<void>)[] = [];

      // Days are independent and so are the entries inside a day: update them in parallel
      // (bounded) instead of one database round trip after another.
      const sortedDates = Array.from(byDate.keys()).sort();
      const dayResults = await mapWithConcurrency(sortedDates, 6, async (date) => {
        const dayEntries = byDate.get(date)!.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
        const perEntry = await Promise.all(dayEntries.map(async (e) => {
          const labels = reviewEntryLabels(e);
          const currentStatus = e.status || "pending";
          if (!ADMIN_REVIEW_ELIGIBLE.includes(currentStatus)) {
            return {
              kind: "skipped" as const,
              row: { id: e.id, ...labels, result: "skipped", currentStatus, reasons: [`Already ${currentStatus.replace("_", " ")} — not changed`] },
            };
          }
          const problems = validateWithRules(e, rules, "approve");
          if (problems.length === 0) {
            const updated = await storage.adminApproveTimeEntry(e.id, admin.id);
            if (updated) broadcast("time_entry_updated", updated);
            return { kind: "approved" as const, row: { id: e.id, ...labels, result: "approved", currentStatus: "approved", reasons: [] as string[] } };
          }
          const updated = await storage.updateTimeEntryStatus(e.id, "rejected", admin.id, problems.join("; "));
          if (updated) broadcast("time_entry_updated", updated);
          return {
            kind: "rejected" as const,
            row: { id: e.id, ...labels, result: "rejected", currentStatus: "rejected", reasons: problems },
            item: { ...labels, reasons: problems },
          };
        }));
        return { date, dayEntries, perEntry };
      });

      for (const { date, dayEntries, perEntry } of dayResults) {
        const rows = perEntry.map((r) => r.row);
        const rejectedItems: { project: string; task: string; reasons: string[] }[] = [];
        let approvedCount = 0;
        for (const r of perEntry) {
          if (r.kind === "skipped") totals.skipped++;
          else if (r.kind === "approved") { approvedCount++; totals.approved++; }
          else { rejectedItems.push(r.item); totals.rejected++; }
        }

        // Emails are queued and sent after the response, so the admin does not wait for SMTP.
        // emailSent = "a rejection email has been queued for this date".
        let emailSent = false;
        let emailNote: string | undefined;
        if (rejectedItems.length > 0) {
          if (!employee.email) {
            emailNote = "Employee has no email address on file";
          } else {
            emailSent = true;
            emailJobs.push(async () => {
              const result = await sendAdminReviewRejectionEmail({
                employeeName: employee.name,
                employeeCode: employee.employeeCode,
                date,
                items: rejectedItems,
                approverName: admin.name,
                recipients: [employee.email as string],
              });
              if (!result?.success) console.error(`[EMAIL] admin review rejection email failed for ${date}`);
            });
          }
        } else if (approvedCount > 0) {
          // Same behaviour as the normal approve route: final-approval mail once the whole day is approved.
          emailJobs.push(async () => {
            const dayTasks = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
            if (dayTasks.length > 0 && dayTasks.every((t) => t.status === "approved")) {
              await sendApprovalSummaryEmail({
                employeeId,
                employeeName: employee.name,
                employeeCode: employee.employeeCode,
                date,
                tasks: dayTasks,
                status: "approved",
                recipients: employee.email ? [...defaultRecipients, employee.email] : defaultRecipients,
                approverName: admin.name,
              });
            }
          });
        }

        totals.dates++;
        totals.entries += dayEntries.length;
        dates.push({ date, entries: rows, emailSent, emailNote });
      }

      // Overall report (incl. rejection reasons) to the admin who ran it, queued last.
      const reportEmailSent = !!admin.email && dates.length > 0;
      if (reportEmailSent) {
        const flat = dates.flatMap((d) => d.entries.map((r: any) => ({
          date: d.date, project: r.project, task: r.task, result: r.result, reasons: r.reasons,
        })));
        emailJobs.push(async () => {
          await sendAdminReviewReportEmail({
            adminName: admin.name,
            employeeName: employee.name,
            employeeCode: employee.employeeCode,
            startDate,
            endDate,
            totals: { approved: totals.approved, rejected: totals.rejected, skipped: totals.skipped },
            rows: flat,
            recipients: [admin.email as string],
          });
        });
      }

      res.json({
        employeeId,
        employeeName: employee.name,
        employeeCode: employee.employeeCode,
        startDate,
        endDate,
        rules,
        totals,
        dates,
        reportEmailSent,
      });

      runInBackground("admin-review-emails", async () => {
        for (const job of emailJobs) {
          try {
            await job();
          } catch (err) {
            console.error("[EMAIL] admin review email failed", err);
          }
        }
      });
    } catch (error) {
      console.error("Admin review error:", error);
      res.status(500).json({ error: "Failed to run admin approval review" });
    }
  });

  // Manual approve for one employee + one date, from the Admin Approval tab.
  // Entries are approved only when they satisfy the saved approval conditions; the rest are
  // reported back with the exact reasons and left unchanged.
  app.post("/api/time-entries/admin-review/approve-date", async (req, res) => {
    try {
      const { adminId, employeeId, date, startDate, endDate } = req.body || {};
      const admin = await loadReviewAdmin(adminId);
      if (!admin) return res.status(403).json({ error: "Only admins can approve from the Admin Approval tab" });

      const rangeError = validateReviewRange(startDate, endDate);
      if (rangeError) return res.status(400).json({ error: rangeError });
      if (typeof employeeId !== "string" || !employeeId) return res.status(400).json({ error: "Employee is required" });
      if (typeof date !== "string" || !ADMIN_REVIEW_DATE_RE.test(date) || date < startDate || date > endDate) {
        return res.status(400).json({ error: "Date is outside the selected range" });
      }

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ error: "Employee not found" });

      const rules = await getTimesheetRules();
      const raw = (await storage.getTimeEntriesByEmployeeAndDate(employeeId, date))
        .filter((e) => e.employeeId === employeeId && e.status !== "draft");
      if (raw.length === 0) return res.status(404).json({ error: "No submitted timesheet entries on this date" });

      if (rules.keyStep.approve && raw.some((e) => !e.keyStep && (e.pmsId || e.pmsSubtaskId))) {
        try {
          await pmsPool.query("SELECT 1");
        } catch {
          return res.status(503).json({ error: "PMS is unreachable, so Key Step cannot be verified right now. Please try again shortly." });
        }
      }
      const entries = await batchEnrichEntries(raw);

      const results = await Promise.all(entries.map(async (e) => {
        const labels = reviewEntryLabels(e);
        const currentStatus = e.status || "pending";
        if (currentStatus === "approved") {
          return { id: e.id, ...labels, result: "skipped", currentStatus, reasons: ["Already approved — not changed"] };
        }
        if (!ADMIN_REVIEW_ELIGIBLE.includes(currentStatus)) {
          return { id: e.id, ...labels, result: "skipped", currentStatus, reasons: [`Currently ${currentStatus.replace("_", " ")} — cannot be approved`] };
        }
        const problems = validateWithRules(e, rules, "approve");
        if (problems.length > 0) {
          return { id: e.id, ...labels, result: "blocked", currentStatus, reasons: problems };
        }
        const updated = await storage.adminApproveTimeEntry(e.id, admin.id);
        if (updated) broadcast("time_entry_updated", updated);
        return { id: e.id, ...labels, result: "approved", currentStatus: "approved", reasons: [] as string[] };
      }));

      const approvedCount = results.filter((r) => r.result === "approved").length;
      if (approvedCount > 0) {
        runInBackground("admin-manual-approve-email", async () => {
          const dayTasks = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
          if (dayTasks.length > 0 && dayTasks.every((t) => t.status === "approved")) {
            const { sendApprovalSummaryEmail } = await import("./email");
            const defaultRecipients = (process.env.SENDER_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
            await sendApprovalSummaryEmail({
              employeeId,
              employeeName: employee.name,
              employeeCode: employee.employeeCode,
              date,
              tasks: dayTasks,
              status: "approved",
              recipients: employee.email ? [...defaultRecipients, employee.email] : defaultRecipients,
              approverName: admin.name,
            });
          }
        });
      }

      res.json({ date, employeeId, entries: results });
    } catch (error) {
      console.error("Admin manual approve error:", error);
      res.status(500).json({ error: "Failed to approve timesheet" });
    }
  });

  // Manual reject for one employee + one date, from the Admin Approval tab.
  app.post("/api/time-entries/admin-review/reject-date", async (req, res) => {
    try {
      const { adminId, employeeId, date, startDate, endDate, reason } = req.body || {};
      const admin = await loadReviewAdmin(adminId);
      if (!admin) return res.status(403).json({ error: "Only admins can reject from the Admin Approval tab" });

      const rangeError = validateReviewRange(startDate, endDate);
      if (rangeError) return res.status(400).json({ error: rangeError });
      if (typeof employeeId !== "string" || !employeeId) return res.status(400).json({ error: "Employee is required" });
      if (typeof date !== "string" || !ADMIN_REVIEW_DATE_RE.test(date) || date < startDate || date > endDate) {
        return res.status(400).json({ error: "Date is outside the selected range" });
      }
      const cleanReason = typeof reason === "string" ? reason.trim() : "";
      if (!cleanReason) return res.status(400).json({ error: "A rejection reason is required" });

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ error: "Employee not found" });

      const dayEntries = (await storage.getTimeEntriesByEmployeeAndDate(employeeId, date))
        .filter((e) => e.employeeId === employeeId && e.status !== "draft" && e.status !== "rejected");
      if (dayEntries.length === 0) return res.status(404).json({ error: "No rejectable timesheet entries on this date" });

      const fullReason = `Manually rejected by admin: ${cleanReason}`;
      const rejectedIds: string[] = [];
      const items: { project: string; task: string; reasons: string[] }[] = [];
      const updatedList = await Promise.all(
        dayEntries.map((e) => storage.updateTimeEntryStatus(e.id, "rejected", admin.id, fullReason))
      );
      updatedList.forEach((updated, i) => {
        if (updated) {
          broadcast("time_entry_updated", updated);
          rejectedIds.push(dayEntries[i].id);
          items.push({ ...reviewEntryLabels(dayEntries[i]), reasons: [fullReason] });
        }
      });

      // Email is queued and sent after the response (emailSent = queued).
      let emailSent = false;
      let emailNote: string | undefined;
      if (!employee.email) {
        emailNote = "Employee has no email address on file";
      } else if (items.length > 0) {
        emailSent = true;
        const recipient = employee.email;
        runInBackground("admin-manual-reject-email", async () => {
          const { sendAdminReviewRejectionEmail } = await import("./email");
          const result = await sendAdminReviewRejectionEmail({
            employeeName: employee.name,
            employeeCode: employee.employeeCode,
            date,
            items,
            approverName: admin.name,
            recipients: [recipient],
          });
          if (!result?.success) console.error(`[EMAIL] manual reject email failed for ${date}`);
        });
      }

      res.json({ date, rejectedIds, reason: fullReason, emailSent, emailNote });
    } catch (error) {
      console.error("Admin manual reject error:", error);
      res.status(500).json({ error: "Failed to reject timesheet" });
    }
  });

  app.get("/api/time-entries", async (req, res) => {
    try {
      const entries = await storage.getTimeEntries();

      // Batch enrich entries with key step name from PMS (if linked via pmsId or pmsSubtaskId)
      const enriched = await batchEnrichEntries(entries);
      res.json(enriched);
    } catch (error) {
      console.error("Get time entries error:", error);
      res.status(500).json({ error: "Failed to fetch time entries" });
    }
  });

  app.get("/api/time-entries/pending", async (req, res) => {
    try {
      const entries = await storage.getPendingTimeEntries();
      res.json(entries);
    } catch (error) {
      console.error("Get pending entries error:", error);
      res.status(500).json({ error: "Failed to fetch pending entries" });
    }
  });

  app.get("/api/time-entries/employee/:employeeId", async (req, res) => {
    try {
      const entries = await storage.getTimeEntriesByEmployee(req.params.employeeId);
      const enriched = await batchEnrichEntries(entries);
      res.json(enriched);
    } catch (error) {
      console.error("Get employee entries error:", error);
      res.status(500).json({ error: "Failed to fetch employee entries" });
    }
  });

  app.get("/api/time-entries/:id", async (req, res) => {
    try {
      const entry = await storage.getTimeEntry(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }
      res.json(await enrichEntry(entry));
    } catch (error) {
      console.error("Get time entry error:", error);
      res.status(500).json({ error: "Failed to fetch time entry" });
    }
  });

  app.post("/api/time-entries", async (req, res) => {
    try {
      // Manual field extraction to ensure all data is captured
      const entryData = {
        ...req.body,
        employeeId: req.body.employeeId,
        employeeCode: req.body.employeeCode,
        employeeName: req.body.employeeName,
        date: req.body.date,
        projectName: req.body.projectName,
        taskDescription: req.body.taskDescription,
        problemAndIssues: req.body.problemAndIssues || null,
        quantify: req.body.quantify || "",
        achievements: req.body.achievements || null,
        scopeOfImprovements: req.body.scopeOfImprovements || null,
        toolsUsed: req.body.toolsUsed || [],
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        totalHours: req.body.totalHours,
        percentageComplete: parseInt(req.body.percentageComplete) || 0,
        pmsId: req.body.pmsId || null,
        pmsSubtaskId: req.body.pmsSubtaskId || null,
        keyStep: req.body.keyStep || null,
      };

      const result = insertTimeEntrySchema.safeParse(entryData);
      if (!result.success) {
        console.error("[TIME-ENTRY] Validation error:", result.error);
        return res.status(400).json({ error: result.error });
      }

      // Drafts (Plan for the Day auto-entries) may be incomplete; anything submitted must pass the shared rules.
      if (entryData.status && entryData.status !== "draft") {
        const fieldProblems = validateWithRules(entryData, await getTimesheetRules(), "submit");
        if (fieldProblems.length > 0) {
          return res.status(400).json({
            error: `Timesheet not submitted: ${fieldProblems.join("; ")}`,
            message: `Timesheet not submitted: ${fieldProblems.join("; ")}`,
            problems: fieldProblems,
          });
        }
      }

      // Validate selected tools against TimeGuard Agent's actual usage logs
      // Only for employees who have enforceToolValidation enabled.
      try {
        const employee = await storage.getEmployee(entryData.employeeId);
        console.log(
          `[TOOL-USAGE-VALIDATION][CREATE] employeeId=${entryData.employeeId} enforceToolValidation=${employee?.enforceToolValidation} tools=${JSON.stringify(entryData.toolsUsed)}`
        );
        if (employee && employee.enforceToolValidation) {
          const toolCheck = await validateToolUsage(
            entryData.employeeCode,
            entryData.date,
            entryData.startTime,
            entryData.endTime,
            entryData.toolsUsed
          );
          console.log(`[TOOL-USAGE-VALIDATION][CREATE] result=${JSON.stringify(toolCheck)}`);
          if (!toolCheck.valid) {
            return res.status(400).json({ error: toolCheck.message });
          }
        }
      } catch (toolValidationError) {
        // Fail open: don't block a legitimate submission over a validation-check bug.
        console.error("[TOOL-USAGE-VALIDATION] Error checking tool usage:", toolValidationError);
      }

      const employee = await storage.getEmployee(entryData.employeeId);
      const leaveStatus = employee?.employeeCode
        ? await getLeaveStatusForDate(employee.employeeCode, entryData.date)
        : { hasLeave: false, status: null, details: [] };

      if (leaveStatus.hasLeave) {
        const detail = leaveStatus.status === 'Pending' ? 'pending leave' : 'approved leave';
        return res.status(403).json({
          error: `You are on ${detail} today. Please do not submit a timesheet for this date.`,
          message: `You are on ${detail} today. Please do not submit a timesheet for this date.`
        });
      }

      // Plan for the Day Check (Only for today or future dates)
      const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' in local time equivalent using CA locale format or just ISO up to T
      // To ensure correct comparison, let's just use string comparison with today's date in YYYY-MM-DD
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const localTodayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];

      const isPastDay = entryData.date < localTodayStr;

      if (!isPastDay) {
        const plan = await storage.getDailyPlanByDate(entryData.employeeId, entryData.date);
        if (!plan) {
          return res.status(403).json({ error: "You must submit your 'Plan for the Day' before filling timesheets." });
        }

        // Check if task exists in the plan
        const planTasks = await storage.getPlanTasks(plan.id);
        let isPlanned = planTasks.some(pt => pt.taskId === entryData.pmsId || pt.taskId === entryData.pmsSubtaskId);

        // If not directly planned, check if it's a subtask of a planned task
        if (!isPlanned && entryData.pmsSubtaskId) {
          const { getSubtaskById } = await import('./pmsSupabase');
          const subtask = await getSubtaskById(entryData.pmsSubtaskId);
          if (subtask && subtask.task_id) {
            isPlanned = planTasks.some(pt => pt.taskId === subtask.task_id);
          }
        }

        if (!isPlanned && (entryData.pmsId || entryData.pmsSubtaskId)) {
          // Instead of blocking, we automatically add it as a deviation
          console.log(`[TIME-ENTRY] Task ${entryData.pmsId || entryData.pmsSubtaskId} not in plan. Adding as auto-deviation.`);
          try {
            await storage.createPlanTask({
              planId: plan.id,
              taskId: entryData.pmsId || entryData.pmsSubtaskId || 'unplanned',
              projectName: entryData.projectName,
              taskName: entryData.taskDescription,
              isDeviation: true,
              deviationReason: "Automatically added via timesheet submission",
              status: 'approved'
            });
          } catch (devErr) {
            console.error("[TIME-ENTRY] Failed to auto-create deviation:", devErr);
          }
        }
      }

      const entry = await storage.createTimeEntry(result.data);

      // Handle PMS Status Synchronization & Bottom-Up Aggregation
      try {
        console.log(`[PMS-SYNC] Starting sync. pmsId: ${req.body.pmsId}, pmsSubtaskId: ${req.body.pmsSubtaskId}, progress: ${entryData.percentageComplete}%`);
        const { updateSubtaskProgress, updateTaskProgress, getProjectProgress, getProjects } = await import('./pmsSupabase');

        let targetProjectId: string | null = null;

        // CASE 1: Subtask exists - update subtask progress (triggers bottom-up update)
        if (req.body.pmsSubtaskId) {
          console.log(`[PMS-SYNC] Updating subtask ${req.body.pmsSubtaskId} progress`);
          await updateSubtaskProgress(req.body.pmsSubtaskId, entryData.percentageComplete);

          // Resolve project ID for broadcast
          const res = await pmsPool.query('SELECT project_id FROM project_tasks pt JOIN subtasks s ON pt.id = s.task_id WHERE s.id = $1::uuid', [req.body.pmsSubtaskId]);
          if (res.rows && res.rows.length > 0) targetProjectId = res.rows[0].project_id;
        }
        // CASE 2: No subtask - update task progress directly (triggers bottom-up update)
        else if (req.body.pmsId) {
          console.log(`[PMS-SYNC] Updating task ${req.body.pmsId} progress (no subtask) using date ${entry.date}`);
          await updateTaskProgress(req.body.pmsId, entryData.percentageComplete, entry.date);

          // Resolve project ID for broadcast
          const res = await pmsPool.query('SELECT project_id FROM project_tasks WHERE id = $1::uuid', [req.body.pmsId]);
          if (res.rows && res.rows.length > 0) targetProjectId = res.rows[0].project_id;
        }

        // If we found the project, synchronize points and broadcast
        if (targetProjectId) {
          const finalProgress = await getProjectProgress(targetProjectId);
          console.log(`[PMS-SYNC] Final Project ${targetProjectId} progress: ${finalProgress}%`);

          // Sync with gamification points (Max 600 points = 100%)
          // This ensures the AchievementTree grows based on project completion %
          const targetPoints = Math.round(finalProgress * 6);
          try {
            await pool.query(
              `INSERT INTO project_points (project_id, points, last_active) 
               VALUES ($1, $2, NOW()) 
               ON CONFLICT (project_id) DO UPDATE SET points = EXCLUDED.points, last_active = NOW()`,
              [entry.projectName, targetPoints]
            );
          } catch (pErr) { console.error('Failed to sync project points:', pErr); }

          broadcast("project_progress_updated", {
            projectId: entry.projectName,
            progress: finalProgress,
            points: targetPoints
          });
        }
      } catch (pmsSyncError) {
        console.error("[PMS-SYNC] Error during progress synchronization:", pmsSyncError);
      }
      // ==================================

      broadcast("time_entry_created", entry);

      // NOTE: Email notifications are now sent per day (not per task) via /api/time-entries/submit-daily
      // This prevents multiple emails for multiple tasks submitted on the same day
      console.log('[EMAIL] Task created - email will be sent with daily digest endpoint');

      res.status(201).json(entry);
    } catch (error) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Failed to create time entry" });
    }
  });

  // ============ UPDATE TIME ENTRY (EDIT) ============
  app.put("/api/time-entries/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const entryData = {
        projectName: req.body.projectName,
        taskDescription: req.body.taskDescription,
        problemAndIssues: req.body.problemAndIssues || null,
        quantify: req.body.quantify || "",
        achievements: req.body.achievements || null,
        scopeOfImprovements: req.body.scopeOfImprovements || null,
        toolsUsed: req.body.toolsUsed || [],
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        totalHours: req.body.totalHours,
        percentageComplete: req.body.percentageComplete || 0,
        pmsId: req.body.pmsId || null,
        pmsSubtaskId: req.body.pmsSubtaskId || null,
        keyStep: req.body.keyStep || null,
      };

      // Validate the data
      const result = insertTimeEntrySchema.partial().safeParse(entryData);
      if (!result.success) {
        console.error("[TIME-ENTRY-UPDATE] Validation error:", result.error);
        return res.status(400).json({ error: result.error });
      }

      // Check if time entry exists
      const entry = await storage.getTimeEntry(id);
      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      // Only allow editing draft or pending entries
      if (entry.status && !['draft', 'pending', 'rejected'].includes(entry.status)) {
        return res.status(403).json({ error: "Only pending or draft entries can be edited" });
      }

      // Editing a submitted (pending/rejected) entry must not leave it incomplete.
      if (entry.status && entry.status !== 'draft') {
        const editProblems = validateWithRules({ ...entry, ...entryData }, await getTimesheetRules(), "submit");
        if (editProblems.length > 0) {
          return res.status(400).json({
            error: `Timesheet not updated: ${editProblems.join("; ")}`,
            message: `Timesheet not updated: ${editProblems.join("; ")}`,
            problems: editProblems,
          });
        }
      }

      // Validate selected tools against TimeGuard Agent's actual usage logs
      // Only for employees who have enforceToolValidation enabled.
      try {
        const employee = await storage.getEmployee(entry.employeeId);
        console.log(
          `[TOOL-USAGE-VALIDATION][UPDATE] entryId=${id} employeeId=${entry.employeeId} enforceToolValidation=${employee?.enforceToolValidation} tools=${JSON.stringify(entryData.toolsUsed)}`
        );
        if (employee && employee.enforceToolValidation) {
          const toolCheck = await validateToolUsage(
            entry.employeeCode,
            entry.date,
            entryData.startTime || entry.startTime,
            entryData.endTime || entry.endTime,
            entryData.toolsUsed
          );
          console.log(`[TOOL-USAGE-VALIDATION][UPDATE] result=${JSON.stringify(toolCheck)}`);
          if (!toolCheck.valid) {
            return res.status(400).json({ error: toolCheck.message });
          }
        }
      } catch (toolValidationError) {
        // Fail open: don't block a legitimate edit over a validation-check bug.
        console.error("[TOOL-USAGE-VALIDATION] Error checking tool usage:", toolValidationError);
      }

      // Update the time entry
      const updated = await storage.updateTimeEntry(id, result.data);

      // Handle PMS Status Synchronization if progress changed
      try {
        console.log(`[PMS-SYNC] Starting update sync. pmsId: ${req.body.pmsId}, pmsSubtaskId: ${req.body.pmsSubtaskId}, progress: ${entryData.percentageComplete}%`);
        if (entry.percentageComplete !== entryData.percentageComplete) {
          const { updateSubtaskProgress, updateTaskProgress } = await import('./pmsSupabase');

          let targetProjectId: string | null = null;

          // CASE 1: Subtask exists - update subtask progress
          if (req.body.pmsSubtaskId) {
            console.log(`[PMS-SYNC] Updating subtask ${req.body.pmsSubtaskId} progress during edit`);
            await updateSubtaskProgress(req.body.pmsSubtaskId, entryData.percentageComplete);

            // Resolve project ID for broadcast
            const res = await pmsPool.query('SELECT project_id FROM project_tasks pt JOIN subtasks s ON pt.id = s.task_id WHERE s.id = $1::uuid', [req.body.pmsSubtaskId]);
            if (res.rows && res.rows.length > 0) targetProjectId = res.rows[0].project_id;
          }
          // CASE 2: No subtask - update task progress directly
          else if (req.body.pmsId) {
            console.log(`[PMS-SYNC] Updating task ${req.body.pmsId} progress during edit`);
            await updateTaskProgress(req.body.pmsId, entryData.percentageComplete, entry.date);

            // Resolve project ID for broadcast
            const res = await pmsPool.query('SELECT project_id FROM project_tasks WHERE id = $1::uuid', [req.body.pmsId]);
            if (res.rows && res.rows.length > 0) targetProjectId = res.rows[0].project_id;
          }

          // If we found the project, synchronize points and broadcast
          if (targetProjectId) {
            const { getProjectProgress } = await import('./pmsSupabase');
            const finalProgress = await getProjectProgress(targetProjectId);
            console.log(`[PMS-SYNC] Final Project ${targetProjectId} progress after edit: ${finalProgress}%`);

            // Sync with gamification points (Max 600 points = 100%)
            const targetPoints = Math.round(finalProgress * 6);
            try {
              await pool.query(
                `INSERT INTO project_points (project_id, points, last_active) 
                 VALUES ($1, $2, NOW()) 
                 ON CONFLICT (project_id) DO UPDATE SET points = EXCLUDED.points, last_active = NOW()`,
                [entry.projectName, targetPoints]
              );
            } catch (pErr) { console.error('Failed to sync project points:', pErr); }

            broadcast("project_progress_updated", {
              projectId: entry.projectName,
              progress: finalProgress,
              points: targetPoints
            });
          }
        }
      } catch (pmsSyncError) {
        console.error("[PMS-SYNC] Error during update sync:", pmsSyncError);
      }

      broadcast("time_entry_updated", await enrichEntry(updated!));
      res.json(await enrichEntry(updated!));
    } catch (error) {
      console.error("Update time entry error:", error);
      res.status(500).json({ error: "Failed to update time entry" });
    }
  });

  app.put("/api/time-entries/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, approvedBy, rejectionReason, onHoldReason, managerApprovedBy, approvalComment } = req.body;

      const entry = await storage.getTimeEntry(id);
      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      const updateData: any = { status };

      if (status === 'approved') {
        if (managerApprovedBy) {
          updateData.managerApprovedBy = managerApprovedBy;
          updateData.managerApprovedAt = new Date();
          updateData.managerApproved = true;
          if (approvalComment) updateData.approvalComment = approvalComment;
        } else if (approvedBy) {
          updateData.approvedBy = approvedBy;
          updateData.approvedAt = new Date();
          if (approvalComment) updateData.approvalComment = approvalComment;
        }
      } else if (status === 'rejected') {
        updateData.rejectionReason = rejectionReason;
        updateData.managerApproved = false; // Reset approval status on rejection
        updateData.managerApprovedBy = null;
        updateData.managerApprovedAt = null;
      } else if (status === 'on-hold') {
        updateData.onHoldReason = onHoldReason;
      }

      const updated = await storage.updateTimeEntryStatus(id, updateData);
      broadcast("time_entry_updated", await enrichEntry(updated));
      res.json(await enrichEntry(updated));
    } catch (error) {
      console.error("Update time entry status error:", error);
      res.status(500).json({ error: "Failed to update time entry status" });
    }
  });

  // ============ CALENDAR SYNC TIME ENTRIES ============
  app.post("/api/time-entries/sync-calendar", async (req, res) => {
    try {
      const { employeeId, event } = req.body;
      if (!employeeId || !event) {
        return res.status(400).json({ error: "employeeId and event are required" });
      }

      const isBreak = event.title?.toLowerCase().includes("break") || event.title?.toLowerCase().includes("lunch");
      if (isBreak) {
        return res.json({ success: true, ignored: true });
      }

      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      const date = event.date;
      const tStart = event.startTime;
      const tEnd = event.endTime;
      const [sh, sm] = tStart.split(':').map(Number);
      const [eh, em] = tEnd.split(':').map(Number);
      const diffMin = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
      const totalHours = `${String(Math.floor(diffMin / 60)).padStart(2, '0')}:${String(diffMin % 60).padStart(2, '0')}`;

      // Check for existing entry
      const existingEntries = await storage.getTimeEntriesByEmployee(employeeId);
      const match = existingEntries.find((e: any) => {
        if (e.date !== date) return false;
        if (event.pmsId) return e.pmsId === event.pmsId || e.pmsSubtaskId === event.pmsId;
        return e.taskDescription === event.title;
      });

      if (match) {
        // Update if pending, draft, or rejected. If approved/submitted, skip modifying it to prevent data corruption.
        if (match.status === 'pending' || match.status === 'rejected' || match.status === 'draft') {
          const updated = await pool.query(
            `UPDATE time_entries SET start_time = $1, end_time = $2, total_hours = $3 WHERE id = $4 RETURNING *`,
            [tStart, tEnd, totalHours, match.id]
          );
          broadcast("time_entry_updated", await enrichEntry(updated.rows[0]));
          return res.json({ success: true, action: "updated", entry: await enrichEntry(updated.rows[0]) });
        } else {
          return res.json({ success: true, action: "skipped_locked" });
        }
      } else {
        // Create new
        const entry = await storage.createTimeEntry({
          employeeId,
          employeeCode: employee.employeeCode,
          employeeName: employee.name,
          date: date,
          projectName: event.project || "General",
          taskDescription: event.title,
          quantify: "",
          startTime: tStart,
          endTime: tEnd,
          totalHours,
          pmsId: event.pmsId || null,
          status: 'draft'
        });
        broadcast("time_entry_created", entry);
        return res.json({ success: true, action: "created", entry });
      }
    } catch (error) {
      console.error("Calendar sync time entry error:", error);
      res.status(500).json({ error: "Failed to sync calendar to time entries" });
    }
  });

  // Delete a time entry (only if pending)
  app.delete("/api/time-entries/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const entry = await storage.getTimeEntry(id);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      if (entry.status !== 'pending' && entry.status !== 'draft') {
        return res.status(400).json({ error: "Cannot delete entry that is not pending or draft" });
      }

      await storage.deleteTimeEntry(id);
      broadcast("time_entry_deleted", { id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete time entry error:", error);
      res.status(500).json({ error: "Failed to delete time entry" });
    }
  });

  // Submit daily tasks summary email
  app.post("/api/time-entries/submit-daily/:employeeId/:date", async (req, res) => {
    try {
      const { employeeId, date } = req.params;

      // fetch every entry for the user on the requested date
      const entries = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      if (entries.length === 0) {
        return res.status(404).json({ error: "No tasks found for this date" });
      }

      // Every entry being submitted must satisfy the shared mandatory-field rules, but ONLY while the
      // 24-hour submission period is open. Rejected entries are included so a successful submit clears them.
      const submitRules = await getTimesheetRules();
      const nowForWindow = new Date();
      const invalidEntries = entries
        .filter(e => e.status === 'draft' || e.status === 'pending' || e.status === 'resubmitted' || e.status === 'rejected')
        .filter(e => isWithinSubmissionWindow(date, nowForWindow, e.status === 'rejected' ? e.approvedAt : null))
        .map(e => ({ entry: e, problems: validateWithRules(e, submitRules, "submit") }))
        .filter(x => x.problems.length > 0);
      if (invalidEntries.length > 0) {
        const detail = invalidEntries
          .map(x => `${x.entry.projectName || 'Task'} (${x.entry.startTime}-${x.entry.endTime}): ${x.problems.join(', ')}`)
          .join(' | ');

        // Admin "Auto Reject" switch: reject the invalid entries and e-mail the employee the reasons.
        // When it is OFF the submission is simply blocked (nothing changes, nobody is e-mailed).
        const autoSettings = await readSettings();
        if (autoSettings.autoRejectEnabled === true) {
          const reasonFor = (x: { problems: string[] }) => `Auto rejected: ${x.problems.join("; ")}`;
          const rejectedNow = await Promise.all(
            invalidEntries.map(x => storage.updateTimeEntryStatus(x.entry.id, "rejected", undefined, reasonFor(x)))
          );
          rejectedNow.forEach(u => { if (u) broadcast("time_entry_updated", u); });
          const autoEmployee = await storage.getEmployee(employeeId);
          if (autoEmployee?.email) {
            runInBackground("auto-reject-email", async () => {
              const { sendAdminReviewRejectionEmail } = await import('./email');
              const result = await sendAdminReviewRejectionEmail({
                employeeName: autoEmployee.name,
                employeeCode: autoEmployee.employeeCode,
                date,
                items: invalidEntries.map(x => {
                  const labels = reviewEntryLabels(x.entry);
                  return { ...labels, reasons: x.problems };
                }),
                approverName: "Auto Reject (System)",
                recipients: [autoEmployee.email as string],
              });
              if (!result?.success) console.error(`[EMAIL] auto reject email failed for ${date}`);
            });
          }
          return res.status(400).json({
            error: "Timesheet auto rejected",
            autoRejected: true,
            message: `Timesheet auto rejected. Reasons: ${detail}. Please correct and resubmit. The reasons were also sent to your email.`,
            invalidEntries: invalidEntries.map(x => ({ id: x.entry.id, problems: x.problems })),
          });
        }

        return res.status(400).json({
          error: "Incomplete timesheet",
          message: `Timesheet cannot be submitted. Fix these first: ${detail}`,
          invalidEntries: invalidEntries.map(x => ({ id: x.entry.id, problems: x.problems })),
        });
      }

      // Enrich entries with PMS data (dates, key steps etc)
      const dailyEntries = await Promise.all(entries.map(e => enrichEntry(e)));

      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      const parseDurationToMinutes = (duration: string): number => {
        if (!duration) return 0;
        const hMatch = duration.match(/(\d+)h/);
        const mMatch = duration.match(/(\d+)m/);
        const colonMatch = duration.match(/(\d+):(\d+)/);

        if (hMatch || mMatch) {
          const h = hMatch ? parseInt(hMatch[1], 10) : 0;
          const m = mMatch ? parseInt(mMatch[1], 10) : 0;
          return h * 60 + m;
        } else if (colonMatch) {
          return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
        }
        const digits = parseFloat(duration);
        if (!isNaN(digits)) return digits * 60;
        return 0;
      };

      // Fallback used when an entry's stored totalHours is missing/unparseable
      // (e.g. drafts created via Plan-for-Day auto-sync or calendar sync with a
      // bad/blank total_hours value). Without this, a valid entry with real
      // start/end times could be counted as 0 minutes and wrongly block submission.
      const deriveMinutesFromTimes = (startTime?: string | null, endTime?: string | null): number => {
        if (!startTime || !endTime) return 0;
        try {
          const [sh, sm] = startTime.split(':').map(Number);
          const [eh, em] = endTime.split(':').map(Number);
          const diff = (eh * 60 + em) - (sh * 60 + sm);
          return diff > 0 ? diff : 0;
        } catch {
          return 0;
        }
      };

      const formatDuration = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
      };

      const totalMinutes = dailyEntries.reduce((sum, entry) => {
        const parsed = parseDurationToMinutes(entry.totalHours);
        return sum + (parsed > 0 ? parsed : deriveMinutesFromTimes(entry.startTime, entry.endTime));
      }, 0);

      // Fetch LMS hours to validate 8-hour rule
      const lmsData = await getLMSHours(employee.employeeCode, date);
      const totalLMSMinutes = Math.round(lmsData.totalLMSHours * 60);
      const combinedMinutes = totalMinutes + totalLMSMinutes;

      // Read force-allow setting so admins can bypass the 8-hour check
      const currentSettings = await readSettings();
      const forceAllowFinalSubmit = !!currentSettings.forceAllowFinalSubmit;

      // 2. Working Hours Validation (Enforce 8 hours, unless force-submit is on)
      const REQUIRED_MINUTES = 8 * 60; // 8 hours
      if (!forceAllowFinalSubmit && combinedMinutes < REQUIRED_MINUTES) {
        return res.status(400).json({
          error: "Insufficient hours",
          message: `Total working hours (Timesheet + Leave/Permission) must be at least 8 hours. Current total: ${formatDuration(combinedMinutes)}`,
          workMinutes: totalMinutes,
          lmsMinutes: totalLMSMinutes,
          totalMinutes: combinedMinutes
        });
      }

      const totalHoursFormatted = formatDuration(totalMinutes);

      // Save the daily submission record
      await storage.createDailySubmission({
        employeeId,
        date,
        totalHours: totalHoursFormatted
      });

      // Transition draft time entries to pending upon timesheet submission
      await pool.query(
        "UPDATE time_entries SET status = 'pending' WHERE employee_id = $1 AND date = $2 AND status = 'draft'",
        [employeeId, date]
      );
      // A successful submission also clears this date's rejected entries from the Rejections list
      // (they become 'resubmitted' and wait for review again).
      const clearedRejected = await pool.query(
        "UPDATE time_entries SET status = 'resubmitted', rejection_reason = NULL, submitted_at = NOW() WHERE employee_id = $1 AND date = $2 AND status = 'rejected' RETURNING *",
        [employeeId, date]
      );
      if (clearedRejected.rowCount) {
        const refreshed = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
        refreshed.forEach(e => broadcast("time_entry_updated", e));
      }

      // use the raw entries as tasks so the email helper has full data
      const tasks = dailyEntries;
      const { sendTimesheetSummaryEmail, sendTimesheetConfirmationEmail } = await import('./email');

      // 1. Send summary to Admin/HR (Existing)
      const emailResult = await sendTimesheetSummaryEmail({
        employeeId: employee.id,
        employeeName: employee.name,
        employeeCode: employee.employeeCode,
        date,
        totalHours: totalHoursFormatted,
        tasks,
        status: 'pending',
      });

      // 2. Send confirmation to employee (New)
      if (employee.email) {
        try {
          const confirmResult = await sendTimesheetConfirmationEmail({
            employeeName: employee.name,
            employeeCode: employee.employeeCode,
            employeeEmail: employee.email,
            date,
            totalHours: totalHoursFormatted,
            tasks: tasks.map(t => {
              const parsedMinutes = parseDurationToMinutes(t.totalHours);
              const minutes = parsedMinutes > 0 ? parsedMinutes : deriveMinutesFromTimes(t.startTime, t.endTime);
              return {
                projectName: t.projectName || '—',
                taskDescription: t.taskDescription || '—',
                totalHours: minutes > 0 ? formatDuration(minutes) : (t.totalHours || '—'),
                status: t.status || 'pending',
                startTime: t.startTime,
                endTime: t.endTime,
                percentageComplete: t.percentageComplete,
              };
            })
          });
          if (confirmResult?.success) {
            console.log(`[CONFIRMATION EMAIL] Sent to ${employee.email}`);
          } else {
            console.error('[CONFIRMATION EMAIL] Failed:', confirmResult?.error || 'Unknown error');
          }
        } catch (confirmErr) {
          console.error('[CONFIRMATION EMAIL] Failed with exception:', confirmErr);
        }
      }

      if (!emailResult.success) {
        // Log but don't block — tasks are already transitioned to 'pending'.
        // A failed email notification should not undo a successful submission.
        console.error('[DAILY SUBMIT] Summary email failed (submission still succeeded):', emailResult.error);
      }

      console.log(`[DAILY SUBMIT] Daily summary and confirmation sent for ${employee.name} on ${date}`);
      res.json({
        success: true,
        message: `Daily summary email sent for ${date} with ${dailyEntries.length} tasks`,
        taskCount: dailyEntries.length,
        totalHours: totalHoursFormatted,
        emailId: (emailResult as any).result?.id,
      });
    } catch (error) {
      console.error("Submit daily summary error:", error);
      res.status(500).json({ error: "Failed to submit daily summary" });
    }
  });

  app.get("/api/daily-submission", async (req, res) => {
    try {
      const { employeeId, date } = req.query;
      if (!employeeId || !date) {
        return res.status(400).json({ error: "Missing employeeId or date" });
      }
      const submission = await storage.getDailySubmissionByDate(employeeId as string, date as string);
      res.json(submission || null);
    } catch (error) {
      console.error("Error fetching daily submission:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Manager approval (first stage of dual approval)
  app.patch("/api/time-entries/:id/manager-approve", async (req, res) => {
    try {
      const { approvedBy } = req.body;
      const entry = await storage.managerApproveTimeEntry(req.params.id, approvedBy);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      broadcast("time_entry_updated", entry);
      res.json(entry);

      // Reply first; the summary email (only when every task of the day is manager approved) goes out afterwards.
      runInBackground("manager-approve-email", () => sendDayApprovalEmail(entry, approvedBy, 'manager_approved'));
    } catch (error) {
      console.error("Manager approve entry error:", error);
      res.status(500).json({ error: "Failed to approve entry" });
    }
  });

  // Admin approval (final stage of dual approval)
  app.patch("/api/time-entries/:id/approve", async (req, res) => {
    try {
      const { approvedBy } = req.body;
      const entry = await storage.adminApproveTimeEntry(req.params.id, approvedBy);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      broadcast("time_entry_updated", entry);
      res.json(entry);

      // Reply first; the final-approval email (only when the whole day is approved) goes out afterwards.
      runInBackground("approve-email", () => sendDayApprovalEmail(entry, approvedBy, 'approved'));
    } catch (error) {
      console.error("Approve entry error:", error);
      res.status(500).json({ error: "Failed to approve entry" });
    }
  });

  // Bulk approve / reject: one request instead of one per entry, one email per employee + date.
  const BULK_MAX_IDS = 500;
  const parseBulkIds = (value: unknown): string[] | null =>
    Array.isArray(value) && value.length > 0 && value.length <= BULK_MAX_IDS && value.every((v) => typeof v === "string" && v)
      ? Array.from(new Set(value as string[]))
      : null;
  const groupByEmployeeDate = (entries: any[]) => {
    const groups = new Map<string, any>();
    for (const e of entries) groups.set(`${e.employeeId}|${e.date}`, e);
    return Array.from(groups.values());
  };

  app.post("/api/time-entries/bulk-approve", async (req, res) => {
    try {
      const ids = parseBulkIds(req.body?.ids);
      const { approvedBy, stage } = req.body || {};
      if (!ids) return res.status(400).json({ error: `ids must be a list of 1 to ${BULK_MAX_IDS} entry ids` });
      if (typeof approvedBy !== "string" || !approvedBy) return res.status(400).json({ error: "approvedBy is required" });

      const manager = stage === "manager";
      const results = await mapWithConcurrency(ids, 10, (id) =>
        manager ? storage.managerApproveTimeEntry(id, approvedBy) : storage.adminApproveTimeEntry(id, approvedBy)
      );
      const updated = results.filter((e): e is NonNullable<typeof e> => !!e);
      updated.forEach((e) => broadcast("time_entry_updated", e));
      res.json({ requested: ids.length, updated: updated.length });

      runInBackground("bulk-approve-emails", async () => {
        for (const rep of groupByEmployeeDate(updated)) {
          try {
            await sendDayApprovalEmail(rep, approvedBy, manager ? "manager_approved" : "approved");
          } catch (err) {
            console.error("[EMAIL] bulk approve email failed", err);
          }
        }
      });
    } catch (error) {
      console.error("Bulk approve error:", error);
      res.status(500).json({ error: "Failed to approve entries" });
    }
  });

  app.post("/api/time-entries/bulk-reject", async (req, res) => {
    try {
      const ids = parseBulkIds(req.body?.ids);
      const { approvedBy, reason } = req.body || {};
      if (!ids) return res.status(400).json({ error: `ids must be a list of 1 to ${BULK_MAX_IDS} entry ids` });
      if (typeof approvedBy !== "string" || !approvedBy) return res.status(400).json({ error: "approvedBy is required" });
      if (typeof reason !== "string" || !reason.trim()) return res.status(400).json({ error: "A rejection reason is required" });

      const results = await mapWithConcurrency(ids, 10, (id) =>
        storage.updateTimeEntryStatus(id, "rejected", approvedBy, reason)
      );
      const updated = results.filter((e): e is NonNullable<typeof e> => !!e);
      updated.forEach((e) => broadcast("time_entry_updated", e));
      res.json({ requested: ids.length, updated: updated.length });

      runInBackground("bulk-reject-emails", async () => {
        for (const rep of groupByEmployeeDate(updated)) {
          try {
            await sendDayRejectionEmail(rep, approvedBy, reason);
          } catch (err) {
            console.error("[EMAIL] bulk reject email failed", err);
          }
        }
      });
    } catch (error) {
      console.error("Bulk reject error:", error);
      res.status(500).json({ error: "Failed to reject entries" });
    }
  });

  // ============ SITE REPORT ROUTES ============
  app.get("/api/site-reports", async (req, res) => {
    try {
      const { employeeId } = req.query;
      const reports = await storage.getSiteReports(employeeId as string);
      res.json(reports);
    } catch (error) {
      console.error("Get site reports error:", error);
      res.status(500).json({ error: "Failed to fetch site reports" });
    }
  });

  app.get("/api/site-reports/:id", async (req, res) => {
    try {
      const report = await storage.getSiteReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      const attachments = await storage.getSiteReportAttachments(req.params.id);
      res.json({ ...report, attachments });
    } catch (error) {
      console.error("Get site report error:", error);
      res.status(500).json({ error: "Failed to fetch site report" });
    }
  });

  app.post("/api/site-reports", async (req, res) => {
    try {
      const result = insertSiteReportSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      const report = await storage.createSiteReport(result.data);

      try {
        await saveSiteReportToPMS(report);
      } catch (pmsErr) {
        console.error("Failed to save site report to PMS:", pmsErr);
      }

      broadcast("site_report_created", report);
      res.status(201).json(report);
    } catch (error) {
      console.error("Create site report error:", error);
      res.status(500).json({ error: "Failed to create site report" });
    }
  });

  // Upload attachment for site report (stores base64 data)
  app.post("/api/site-reports/upload", async (req, res) => {
    try {
      const { reportId, fileName, fileType, base64Data } = req.body;
      if (!reportId || !fileName || !fileType || !base64Data) {
        return res.status(400).json({ error: "Missing required fields: reportId, fileName, fileType, base64Data" });
      }

      // Store as data URI so it can be embedded in emails
      const fileUrl = `data:${fileType};base64,${base64Data}`;

      const attachment = await storage.createSiteReportAttachment({
        reportId,
        fileName,
        fileType,
        fileUrl,
        fileSize: Math.round(base64Data.length * 0.75), // approximate decoded size
      });

      res.status(201).json(attachment);
    } catch (error) {
      console.error("Upload attachment error:", error);
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  });

  app.post("/api/site-reports/:id/send-email", async (req, res) => {
    try {
      const reportId = req.params.id;
      const report = await storage.getSiteReport(reportId);
      if (!report) return res.status(404).json({ error: "Report not found" });

      const attachments = await storage.getSiteReportAttachments(reportId);
      const { sendSiteReportEmail } = await import('./email');

      const emailResult = await sendSiteReportEmail({
        employeeName: report.employeeName,
        projectName: report.projectName,
        date: report.date,
        workCategory: report.workCategory,
        startTime: report.startTime,
        endTime: report.endTime,
        duration: report.duration,
        workDone: report.workDone,
        issuesFaced: report.issuesFaced || undefined,
        materialsUsed: report.materialsUsed || undefined,
        laborCount: report.laborCount || 0,
        laborDetails: (report as any).laborDetails || undefined,
        sqftCovered: (report as any).sqftCovered || undefined,
        laborData: (report as any).laborData || undefined,
        location: report.locationLat && report.locationLng ? { lat: report.locationLat, lng: report.locationLng } : undefined,
        attachments: attachments.map(a => ({ fileName: a.fileName, fileUrl: a.fileUrl, fileType: a.fileType })),
        recipients: (report as any).emailRecipients ? (report as any).emailRecipients.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      });

      if (!emailResult.success) {
        return res.status(500).json({ error: "Failed to send email", details: emailResult.error });
      }

      res.json({ success: true, message: "Professional report emailed successfully" });
    } catch (error) {
      console.error("Send site report email error:", error);
      res.status(500).json({ error: "Failed to send site report email" });
    }
  });

  app.patch("/api/site-reports/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const report = await storage.updateSiteReport(req.params.id, { status });
      if (!report) return res.status(404).json({ error: "Report not found" });
      broadcast("site_report_updated", report);
      res.json(report);
    } catch (error) {
      console.error("Update site report status error:", error);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  app.post("/api/site-reports/upload", async (req, res) => {
    try {
      const { reportId, fileName, fileType, base64Data } = req.body;
      if (!reportId || !fileName || !fileType || !base64Data) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');
      const filePath = `site-reports/${reportId}/${Date.now()}_${fileName}`;

      const { data, error } = await supabase.storage
        .from('site-reports')
        .upload(filePath, buffer, {
          contentType: fileType,
          upsert: true
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('site-reports')
        .getPublicUrl(filePath);

      const attachment = await storage.createSiteReportAttachment({
        reportId,
        fileName,
        fileType,
        fileUrl: publicUrl,
        fileSize: buffer.length,
      });

      res.status(201).json(attachment);
    } catch (error) {
      console.error("Upload site report attachment error:", error);
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  });

  app.patch("/api/time-entries/:id/reject", async (req, res) => {
    try {
      const { approvedBy, reason } = req.body;
      const entry = await storage.updateTimeEntryStatus(req.params.id, "rejected", approvedBy, reason);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      broadcast("time_entry_updated", entry);
      res.json(entry);

      // Reply first; the rejection email (lists every rejected task of that day) goes out afterwards.
      runInBackground("reject-email", () => sendDayRejectionEmail(entry, approvedBy, reason));
    } catch (error) {
      console.error("Reject entry error:", error);
      res.status(500).json({ error: "Failed to reject entry" });
    }
  });

  app.patch("/api/time-entries/:id/reopen", async (req, res) => {
    try {
      const entry = await storage.reopenTimeEntry(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }
      broadcast("time_entry_updated", entry);
      res.json(entry);
    } catch (error) {
      console.error("Reopen entry error:", error);
      res.status(500).json({ error: "Failed to reopen entry" });
    }
  });

  app.patch("/api/time-entries/:id/resubmit", async (req, res) => {
    try {
      const existing = await storage.getTimeEntry(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Time entry not found" });
      }
      // Validated only inside the 24-hour period (from the work date, or from the rejection for rejected entries).
      const resubmitInWindow = isWithinSubmissionWindow(
        String(existing.date),
        new Date(),
        existing.status === 'rejected' ? existing.approvedAt : null
      );
      const resubmitProblems = resubmitInWindow
        ? validateWithRules({ ...existing, ...(req.body || {}) }, await getTimesheetRules(), "submit")
        : [];
      if (resubmitProblems.length > 0) {
        return res.status(400).json({
          error: `Cannot resubmit: ${resubmitProblems.join("; ")}`,
          message: `Cannot resubmit: ${resubmitProblems.join("; ")}. Edit the task and fill these in first.`,
          problems: resubmitProblems,
        });
      }
      const entry = await storage.resubmitTimeEntry(req.params.id, req.body);
      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }
      broadcast("time_entry_updated", entry);
      res.json(entry);

      // Notify admin/HR and the employee that a resubmission has been filed.
      runInBackground("resubmit-emails", async () => {
        try {
          const employee = await storage.getEmployee(entry.employeeId);
          const allTasks = await storage.getTimeEntriesByEmployeeAndDate(entry.employeeId, String(entry.date));
          const { sendTimesheetSummaryEmail, sendTimesheetConfirmationEmail } = await import('./email');

          // 1. Notify admin / HR (same audience as the initial submission)
          await sendTimesheetSummaryEmail({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            employeeCode: entry.employeeCode,
            date: String(entry.date),
            totalHours: allTasks.reduce((s, t) => s + (t.totalHours ? 1 : 0), 0).toString(),
            tasks: allTasks,
            status: 'resubmitted' as any,
          }).catch(e => console.error("[EMAIL] resubmit summary email failed", e));

          // 2. Confirmation back to the employee
          if (employee?.email) {
            await sendTimesheetConfirmationEmail({
              employeeName: employee.name,
              employeeCode: employee.employeeCode,
              employeeEmail: employee.email,
              date: String(entry.date),
              totalHours: entry.totalHours || "—",
              tasks: allTasks.map(t => ({
                projectName: t.projectName || "—",
                taskDescription: t.taskDescription || "—",
                totalHours: t.totalHours || "—",
                status: t.status || "resubmitted",
                startTime: t.startTime,
                endTime: t.endTime,
                percentageComplete: t.percentageComplete,
              })),
            }).catch(e => console.error("[EMAIL] resubmit confirmation email failed", e));
          }
        } catch (emailErr) {
          console.error("[EMAIL] resubmit notification failed:", emailErr);
        }
      });
    } catch (error) {
      console.error("Resubmit entry error:", error);
      res.status(500).json({ error: "Failed to resubmit entry" });
    }
  });

  app.patch("/api/time-entries/:id/on-hold", async (req, res) => {
    try {
      const { reason, managerId } = req.body;
      if (!reason || !managerId) {
        return res.status(400).json({ error: "Reason and managerId are required" });
      }
      const entry = await storage.onHoldTimeEntry(req.params.id, reason, managerId);
      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }
      broadcast("time_entry_updated", entry);
      res.json(entry);
    } catch (error) {
      console.error("On-hold entry error:", error);
      res.status(500).json({ error: "Failed to set entry on hold" });
    }
  });

  // ============ DISCUSSION ROUTES ============
  app.get("/api/discussions", async (req, res) => {
    try {
      const { entryId, employeeId } = req.query;
      let discussions;
      if (entryId) {
        discussions = await storage.getDiscussionsByEntry(entryId as string);
      } else if (employeeId) {
        discussions = await storage.getDiscussionsByEmployee(employeeId as string);
      } else {
        discussions = await storage.getAllDiscussions();
      }
      res.json(discussions);
    } catch (error) {
      console.error("Get discussions error:", error);
      res.status(500).json({ error: "Failed to fetch discussions" });
    }
  });

  app.post("/api/discussions", async (req, res) => {
    try {
      const discussion = await storage.createDiscussion(req.body);
      broadcast("new_discussion", discussion);
      res.json(discussion);
    } catch (error) {
      console.error("Create discussion error:", error);
      res.status(500).json({ error: "Failed to create discussion" });
    }
  });

  // ============ NOTIFICATION ROUTES ============
  app.post("/api/notifications/timesheet-submitted", async (req, res) => {
    try {
      const { employeeId, employeeName, employeeCode, date } = req.body;

      console.log(`[NOTIFICATION] grouping submission for ${employeeName} (${employeeCode}) on ${date}`);

      const allTasks = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      console.log(`[NOTIFICATION] fetched ${allTasks.length} tasks from database`);
      if (allTasks.length === 0) {
        console.warn(`[NOTIFICATION] no tasks found for ${employeeId} on ${date}`);
        return res.status(404).json({ error: "No tasks found for that date" });
      }

      const parseDurationToMinutes = (duration: string): number => {
        if (!duration) return 0;
        const hMatch = duration.match(/(\d+)h/);
        const mMatch = duration.match(/(\d+)m/);
        const colonMatch = duration.match(/(\d+):(\d+)/);

        if (hMatch || mMatch) {
          const h = hMatch ? parseInt(hMatch[1], 10) : 0;
          const m = mMatch ? parseInt(mMatch[1], 10) : 0;
          return h * 60 + m;
        } else if (colonMatch) {
          return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
        }
        const digits = parseFloat(duration);
        if (!isNaN(digits)) return digits * 60;
        return 0;
      };

      const formatDuration = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
      };

      const totalMinutes = allTasks.reduce((acc, t) => acc + parseDurationToMinutes(t.totalHours || "0"), 0);
      const totalHours = formatDuration(totalMinutes);

      let lmsHoursText: string | undefined = undefined;
      let combinedTotalHours: string = totalHours;

      try {
        const employee = await storage.getEmployee(employeeId);
        if (employee) {
          const lmsData = await getLMSHours(employee.employeeCode, date);
          if (lmsData && lmsData.totalLMSHours > 0) {
            lmsHoursText = `${lmsData.totalLMSHours}h`;
            const combinedMinutes = totalMinutes + Math.round(lmsData.totalLMSHours * 60);
            combinedTotalHours = formatDuration(combinedMinutes);
          }
        }
      } catch (lmsErr) {
        console.error('[NOTIFICATION] Failed to fetch LMS hours for email:', lmsErr);
      }

      try {
        const { sendTimesheetSummaryEmail } = await import('./email');
        const emailResult = await sendTimesheetSummaryEmail({
          employeeId,
          employeeName,
          employeeCode,
          date,
          totalHours: combinedTotalHours,
          taskHours: totalHours,
          lmsHours: lmsHoursText,
          tasks: allTasks,
          status: 'pending',
        });
        console.log('[EMAIL] Grouped submission email sent, result:', emailResult);
      } catch (emailError) {
        console.error('[EMAIL] Failed to send grouped summary:', emailError);
      }

      // notify front end if needed
      broadcast("timesheet_submitted", { employeeName, employeeCode, date, totalHours });

      res.json({ success: true, taskCount: allTasks.length, totalHours });
    } catch (error) {
      console.error("Notification error:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // ============ PMS INTEGRATION ROUTES ============
  // Settings storage for timesheet blocking policy
  const SETTINGS_PATH = path.join(__dirname, '..', 'server-settings.json');

  async function readSettings() {
    try {
      const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
      return JSON.parse(raw || '{}');
    } catch (e) {
      return { blockUnassignedProjectTasks: false };
    }
  }

  async function writeSettings(s: any) {
    try {
      await fs.writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.error('Failed to write settings', e);
      return false;
    }
  }
  app.get("/api/projects", async (req, res) => {
    try {
      const { userRole, userEmpCode, userDepartment } = req.query;
      const { getProjects } = await import('./pmsSupabase');
      const pmsProjects = await getProjects(userRole as string, userEmpCode as string, userDepartment as string);

      // Add isExpired flag to each project
      const projectsWithExpiry = pmsProjects.map(p => ({
        ...p,
        isExpired: isProjectExpired(p.end_date || null),
      }));

      res.json(projectsWithExpiry);
    } catch (error) {
      console.error("PMS projects error:", error);
      res.status(500).json({ error: "Failed to fetch PMS projects" });
    }
  });

  app.get("/api/tasks", async (req, res) => {
    try {
      const { projectId, userDepartment, userEmpCode, userRole } = req.query;
      const { getTasks } = await import('./pmsSupabase');
      const tasks = await getTasks(
        projectId as string,
        userDepartment as string,
        userEmpCode as string,
        userRole as string
      );
      res.json(tasks);
    } catch (error) {
      console.error("PMS tasks error:", error);
      res.status(500).json({ error: "Failed to fetch PMS tasks" });
    }
  });

  // Helper to determine if a PMS task should be auto-synced based on its schedule
  function shouldSyncPMSTask(task: PMSTask, targetDateStr: string): boolean {
    if (!task.schedule_type || task.schedule_type === 'None') return false;

    const targetDate = new Date(targetDateStr);
    const dayName = format(targetDate, 'EEEE'); // e.g. "Monday"
    const dayOfMonth = targetDate.getDate();

    switch (task.schedule_type) {
      case 'Daily':
        return true;
      case 'Weekly':
        const weeklyDays = Array.isArray(task.schedule_data?.weekdays) ? task.schedule_data.weekdays : [];
        return weeklyDays.includes(dayName);
      case 'Monthly':
        const monthlyDates = Array.isArray(task.schedule_data?.dates) ? task.schedule_data.dates : [];
        return monthlyDates.includes(dayOfMonth);
      case 'Custom':
        if (!task.start_date || !task.end_date) return false;
        const start = new Date(task.start_date);
        const end = new Date(task.end_date);
        // Normalize to compare just dates
        const t = new Date(targetDateStr).getTime();
        return t >= start.getTime() && t <= end.getTime();
      default:
        return false;
    }
  }

  // Return pending tasks assigned to employee that are due on given date and not completed
  app.get('/api/pending-deadline-tasks', async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string;
      const dateStr = req.query.date as string; // yyyy-mm-dd
      if (!employeeId || !dateStr) return res.status(400).json({ error: 'employeeId and date are required' });

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const userDept = employee.department || '';
      const { getProjects, getTasks, updateTaskInPMS } = await import('./pmsSupabase');
      const projects = await getProjects(employee.role, employee.employeeCode, userDept);

      const pending: any[] = [];
      const target = new Date(dateStr);

      // Normalize date to local yyyy-mm-dd key to avoid timezone shifts
      const formatDateLocal = (d: Date) => {
        const dt = new Date(d);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };

      const targetKey = formatDateLocal(target);

      const settings = await readSettings();
      const includeProjectTasks = !!settings.blockUnassignedProjectTasks;

      for (const project of projects) {
        const tasks = await getTasks(project.project_code, userDept, employee.employeeCode);
        for (const t of tasks) {
          // determine assignee match
          const assignedTo = (t.assignee || (t as any).assigned_to || '').toString();
          const members = Array.isArray((t as any).task_members) ? (t as any).task_members : [];
          const isAssigned = assignedTo === employee.employeeCode || members.includes(employee.employeeCode) || false;

          const taskDeadline = t.end_date ? new Date(t.end_date) : null;
          const taskKey = taskDeadline ? formatDateLocal(taskDeadline) : null;

          const notCompleted = !((t as any).is_completed || (t.status && t.status.toLowerCase() === 'completed'));

          // Diagnostic logging: why a task is included/excluded
          try {
            const debugInfo: any = {
              taskId: t.id,
              taskName: (t as any).task_name || (t as any).name || null,
              assignedTo: assignedTo || null,
              members: members || null,
              taskKey,
              targetKey,
              notCompleted,
              isAssignedMatch: isAssigned || false,
            };
            console.log('[PENDING-CHECK] task debug:', JSON.stringify(debugInfo));
          } catch (e) {
            // ignore logging errors
          }

          // Include task as pending if its deadline matches target and it's not completed.
          // Previously we filtered by assignment/settings; to ensure users cannot submit when any
          // task is due today, ignore those criteria here.
          const shouldInclude = taskKey && taskKey === targetKey && notCompleted;
          if (shouldInclude) {
            pending.push({
              ...t,
              projectCode: project.project_code,
              projectName: project.project_name,
              projectDeadline: project.end_date || null,
              // expose whether the task was explicitly assigned to employee
              isAssignedToEmployee: isAssigned || false,
            });
            console.log('[PENDING-CHECK] Included task:', t.id, (t as any).task_name || '');
          } else {
            // log exclusion reason lightly
            if (taskKey && taskKey === targetKey && !notCompleted) {
              console.log('[PENDING-CHECK] Excluded (already completed):', t.id);
            } else if (!taskKey) {
              console.log('[PENDING-CHECK] Excluded (no deadline):', t.id);
            } else if (taskKey !== targetKey) {
              console.log('[PENDING-CHECK] Excluded (date mismatch):', t.id, 'taskKey=', taskKey, 'targetKey=', targetKey);
            } else {
              console.log('[PENDING-CHECK] Excluded (other):', t.id);
            }
          }
        }
      }

      res.json(pending);
    } catch (error) {
      console.error('Pending deadline tasks error:', error);
      res.status(500).json({ error: 'Failed to compute pending tasks', details: String(error) });
    }
  });

  // Postpone a task: record postponement in local DB and update PMS
  app.post('/api/tasks/:id/postpone', async (req, res) => {
    try {
      const taskId = req.params.id;
      const { previousDueDate, newDueDate, reason, postponedBy, taskName } = req.body;
      if (!newDueDate || !reason) return res.status(400).json({ error: 'newDueDate and reason are required' });

      // Use raw DB via storage
      // ensure table exists (best-effort)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS task_postponements (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id varchar NOT NULL,
            task_name text,
            previous_due_date text,
            new_due_date text NOT NULL,
            reason text NOT NULL,
            postponed_by varchar,
            postponed_at timestamp default now(),
            postpone_count integer default 1
          )`);
      } catch (e) {
        // ignore
      }

      // determine previous postpone count for this task
      const countRes = await pool.query(`SELECT COUNT(*)::int as cnt FROM task_postponements WHERE task_id = $1`, [taskId]);
      const previousCount = countRes.rows && countRes.rows[0] ? parseInt(countRes.rows[0].cnt, 10) : 0;
      const newCount = previousCount + 1;

      // insert postponement record with incremented count
      const insertRes = await pool.query(
        `INSERT INTO task_postponements (task_id, task_name, previous_due_date, new_due_date, reason, postponed_by, postpone_count) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [taskId, taskName || null, previousDueDate || null, newDueDate, reason, postponedBy || null, newCount]
      );
      const dbRes = insertRes.rows && insertRes.rows[0] ? insertRes.rows[0] : null;

      // update PMS task
      const { updateTaskInPMS } = await import('./pmsSupabase');
      const updated = await updateTaskInPMS(taskId, { end_date: newDueDate });

      // Notify HR and Admin
      try {
        // Get project details to find organization, but generic HR/Admin notification is acceptable as per request
        // We'll Notify all admins and HRs
        // In a real app we might filter by project's organization, but for now we broadcast to role
        const employees = await storage.getEmployees();
        const notifyList = employees.filter(e => e.role === 'admin' || e.role === 'hr' || e.department === 'HR & Admin');
        const recipientEmails = notifyList.map(e => e.email).filter(Boolean) as string[];

        // Also notify the employee who postponed (confirmation)
        let actorName = postponedBy || 'Unknown User';
        if (postponedBy) {
          const actor = await storage.getEmployee(postponedBy);
          if (actor) {
            if (actor.email) recipientEmails.push(actor.email);
            actorName = `${actor.name} (${actor.employeeCode})`;
          }
        }

        const uniqueRecipients = Array.from(new Set(recipientEmails));

        if (uniqueRecipients.length > 0) {
          try {
            const { sendTaskPostponementEmail } = await import('./email');

            const fmtPrev = previousDueDate && !isNaN(new Date(previousDueDate).getTime())
              ? new Date(previousDueDate).toLocaleDateString('en-IN')
              : (previousDueDate ? previousDueDate.split('T')[0] : 'N/A');

            const fmtNew = newDueDate && !isNaN(new Date(newDueDate).getTime())
              ? new Date(newDueDate).toLocaleDateString('en-IN')
              : newDueDate;

            await sendTaskPostponementEmail({
              recipients: uniqueRecipients,
              taskName: taskName || taskId,
              postponedByDetails: actorName,
              reason: reason,
              newDueDate: fmtNew,
              previousDueDate: fmtPrev
            });
          } catch (e) {
            console.error("Failed to send extension email:", e);
          }
          console.log(`[EMAIL] Postponement notification sent to ${uniqueRecipients.length} recipients`);
        }
      } catch (notifyErr) {
        console.error('[EMAIL] Failed to send postponement notification:', notifyErr);
      }

      res.json({ success: true, postponement: dbRes, updatedPMS: updated });
    } catch (error) {
      console.error('Postpone task error:', error);
      res.status(500).json({ error: 'Failed to postpone task', details: String(error) });
    }
  });

  // Acknowledge task deadline without extending
  app.post('/api/tasks/:id/acknowledge', async (req, res) => {
    try {
      const taskId = req.params.id;
      const { acknowledgedBy, projectCode } = req.body;

      if (!acknowledgedBy) return res.status(400).json({ error: 'acknowledgedBy is required' });

      // ensure table exists
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS task_deadline_acknowledgements (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id varchar NOT NULL,
            acknowledged_by varchar NOT NULL,
            acknowledged_at timestamp default now(),
            project_code text
          )`);
      } catch (e) {
        // ignore
      }

      const result = await pool.query(
        `INSERT INTO task_deadline_acknowledgements (task_id, acknowledged_by, project_code) VALUES ($1, $2, $3) RETURNING *`,
        [taskId, acknowledgedBy, projectCode || null]
      );

      res.json({ success: true, acknowledgement: result.rows[0] });
    } catch (error) {
      console.error('Acknowledge task error:', error);
      res.status(500).json({ error: 'Failed to acknowledge task', details: String(error) });
    }
  });

  // Get all postponement history for Admin
  app.get('/api/admin/postponements', async (req, res) => {
    try {
      console.log(`[ADMIN-POSTPONEMENTS] Received request for history`);
      const postponements = await storage.getAllTaskPostponements();
      console.log(`[ADMIN-POSTPONEMENTS] Found ${postponements.length} records`);

      if (postponements.length > 0) {
        console.log(`[ADMIN-POSTPONEMENTS] Sample:`, JSON.stringify(postponements[0]).substring(0, 100));
      } else {
        // Run a manual check if empty
        const manualCheck = await pool.query('SELECT COUNT(*) FROM task_postponements');
        console.log(`[ADMIN-POSTPONEMENTS] Manual count check: ${manualCheck.rows[0].count}`);
      }

      res.json(postponements);
    } catch (error) {
      console.error('Get admin postponements error:', error);
      res.status(500).json({ error: 'Failed to fetch postponements' });
    }
  });

  app.get('/api/tasks/:id/postponements', async (req, res) => {
    try {
      const taskId = req.params.id;
      // ensure table exists (best-effort)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS task_postponements (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id varchar NOT NULL,
            previous_due_date text,
            new_due_date text NOT NULL,
            reason text NOT NULL,
            postponed_by varchar,
            postponed_at timestamp default now(),
            postpone_count integer default 1
          )`);
      } catch (e) {
        // ignore
      }

      const q = await pool.query(`SELECT id, task_id as "taskId", previous_due_date as "previousDueDate", new_due_date as "newDueDate", reason, postponed_by as "postponedBy", postponed_at as "postponedAt", postpone_count as "postponeCount" FROM task_postponements WHERE task_id = $1 ORDER BY postponed_at DESC`, [taskId]);
      res.json(Array.isArray(q.rows) ? q.rows : []);
    } catch (error) {
      console.error('Get postponements error:', error);
      res.status(500).json({ error: 'Failed to fetch postponements', details: String(error) });
    }
  });

  // (duplicate GET /api/subtasks handler removed — see the single implementation
  // under "============ SUBTASKS ROUTES ============" earlier in this file)

  // ============ DAILY PLAN ROUTES ============
  app.get("/api/daily-plans/today/:employeeId", async (req, res) => {
    try {
      const { employeeId } = req.params;
      const date = new Date().toISOString().split('T')[0];
      const plan = await storage.getDailyPlanByDate(employeeId, date);

      if (!plan) {
        return res.json({ submitted: false });
      }

      const tasks = await storage.getPlanTasks(plan.id);
      const { toTaskUuid } = await import("./Pmscalendarevents");
      const enhancedTasks = tasks.map(t => ({
        ...t,
        hashedTaskId: toTaskUuid(t.taskId)
      }));

      res.json({ submitted: true, plan, tasks: enhancedTasks });
    } catch (error) {
      console.error("Get today's plan error:", error);
      res.status(500).json({ error: "Failed to fetch today's plan" });
    }
  });

  app.get("/api/daily-plans/:date/:employeeId", async (req, res) => {
    try {
      const { date, employeeId } = req.params;
      const plan = await storage.getDailyPlanByDate(employeeId, date);

      if (!plan) {
        return res.json({ submitted: false });
      }

      const tasks = await storage.getPlanTasks(plan.id);
      const { toTaskUuid } = await import("./Pmscalendarevents");
      const enhancedTasks = tasks.map(t => ({
        ...t,
        hashedTaskId: toTaskUuid(t.taskId)
      }));

      // Fetch postponements for this employee on this specific date
      const postponements = await pool.query(
        `SELECT task_name, reason, new_due_date FROM task_postponements WHERE postponed_by = $1 AND DATE(postponed_at) = $2::date`,
        [employeeId, date]
      );

      res.json({
        submitted: true,
        plan,
        tasks: enhancedTasks,
        postponedTasks: postponements.rows || []
      });
    } catch (error) {
      console.error("Get plan by date error:", error);
      res.status(500).json({ error: "Failed to fetch plan for this date" });
    }
  });

  app.delete("/api/daily-plans/:date/:employeeId", async (req, res) => {
    try {
      const { date, employeeId } = req.params;

      // Authorization: check if requester is the plan owner or has elevated role
      const requester = (req as any).user;
      if (requester) {
        const isOwner = requester.id === employeeId;
        const isPrivileged = ['manager', 'hr', 'admin'].includes(requester.role);
        if (!isOwner && !isPrivileged) {
          return res.status(403).json({ error: "Access denied: you can only delete your own plan." });
        }
      }

      const plan = await storage.getDailyPlanByDate(employeeId, date);

      if (!plan) {
        return res.status(404).json({ error: "No plan found for this date" });
      }

      // Remove the matching rows from PMS's shared calendar_events table so a
      // deleted plan doesn't leave stale entries behind on either calendar.
      // Best-effort: a failure here shouldn't block the plan deletion itself.
      try {
        const employee = await storage.getEmployee(employeeId);
        if (employee?.employeeCode) {
          const planTaskRows = await pool.query('SELECT task_id FROM plan_tasks WHERE plan_id = $1', [plan.id]);
          for (const row of planTaskRows.rows) {
            if (row.task_id) {
              await deletePmsPlanCalendarEvent(employee.employeeCode, row.task_id);
            }
          }
        }
      } catch (pmsCleanupError) {
        console.error(`Failed to clean up PMS calendar events for deleted plan ${plan.id}:`, pmsCleanupError);
      }

      // Delete tasks associated with the plan
      await pool.query('DELETE FROM plan_tasks WHERE plan_id = $1', [plan.id]);

      // Delete the plan itself
      await pool.query('DELETE FROM daily_plans WHERE id = $1', [plan.id]);

      // Delete postponements for this employee on this date
      await pool.query(
        `DELETE FROM task_postponements WHERE postponed_by = $1 AND DATE(postponed_at) = $2::date`,
        [employeeId, date]
      );

      broadcast("daily_plan_deleted", { employeeId, date });
      res.json({ success: true, message: "Daily plan deleted successfully" });
    } catch (error) {
      console.error("Delete plan error:", error);
      res.status(500).json({ error: "Failed to delete daily plan" });
    }
  });

  // ---- Plan Window Control (E0046 only) ----
  app.get("/api/plan-window", async (req, res) => {
    const { employeeId } = req.query;
    const settings = await readSettings();
    const now = new Date();
    const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istNow = new Date(utcNow + (5.5 * 60 * 60 * 1000));
    const today = format(istNow, "yyyy-MM-dd");

    const isAutomatedClosed = await storage.isDailyPlanClosed(today);

    // OD (On-Duty) exemption: if this employee has an approved OD for today,
    // work out whether they're exempt right now and/or whether the standard
    // 12:30 PM cutoff needs to be pushed out to the end of their OD window.
    let odExempt = false;
    let odWindow: { from: string; to: string } | null = null;
    let odIsFullDay = false;
    let effectiveCutoffMinutes = 12 * 60 + 30;

    if (employeeId) {
      try {
        const employee = await storage.getEmployee(employeeId as string);
        if (employee) {
          const exemption = await getODExemption(employee.employeeCode, today);
          if (exemption.hasApprovedOD) {
            odIsFullDay = exemption.isFullDay;
            odExempt = isWithinApprovedOD(exemption, now);
            effectiveCutoffMinutes = getEffectivePlanCutoffMinutes(exemption, effectiveCutoffMinutes);
            if (exemption.windows.length > 0) {
              odWindow = { from: exemption.windows[0].from, to: exemption.windows[0].to };
            }
          }
        }
      } catch (err) {
        console.error("[PLAN WINDOW] Failed to check OD exemption:", err);
      }
    }

    const isPastCutoff = isAfterPlanCutoff(effectiveCutoffMinutes);

    // Manual override logic: If admin explicitly toggled today, use that state.
    // Otherwise, use the default automated logic (open until cutoff), with the
    // OD exemption always keeping the window open while the employee is
    // currently within their approved OD time (or all day, for a Full Day OD).
    const isOverrideToday = settings.planWindowLastModifiedDate === today;
    const planWindowOpen = isOverrideToday
      ? !!settings.planWindowOpen
      : ((!isAutomatedClosed && !isPastCutoff) || odExempt || odIsFullDay);

    res.json({
      planWindowOpen,
      isAutomatedClosed,
      isPastCutoff,
      isOverrideToday,
      cutoffTime: "12:30 PM",
      serverTime: new Date().toISOString(),
      odExempt: odExempt || odIsFullDay,
      odIsFullDay,
      odWindow
    });
  });

  app.patch("/api/plan-window", async (req, res) => {
    try {
      const { employeeId, open } = req.body;
      const employee = await storage.getEmployee(employeeId);
      if (employee?.employeeCode !== 'E0046') {
        return res.status(403).json({ error: "Only E0046 can control the plan window." });
      }
      const settings = await readSettings();
      const wasOpen = !!settings.planWindowOpen;

      const now = new Date();
      const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
      const istNow = new Date(utcNow + (5.5 * 60 * 60 * 1000));
      const today = format(istNow, "yyyy-MM-dd");

      settings.planWindowOpen = !!open;
      settings.planWindowLastModifiedDate = today;
      await writeSettings(settings);

      // Trigger email if portal is closed
      if (wasOpen && !open) {
        try {
          const { sendPlanWindowClosedEmail } = await import('./email');
          const allEmployees = await storage.getEmployees();
          const recipients = allEmployees.filter(e => e.isActive && e.email).map(e => e.email) as string[];
          const today = new Date().toLocaleDateString('en-IN');

          if (recipients.length > 0) {
            await sendPlanWindowClosedEmail({
              recipients,
              closedBy: employee.name,
              date: today
            });
            console.log(`[PLAN CLOSED EMAIL] Sent to ${recipients.length} employees`);
          }
        } catch (emailErr) {
          console.error('[PLAN CLOSED EMAIL] Failed:', emailErr);
        }
      }

      broadcast("plan_window_changed", { planWindowOpen: !!open, changedBy: employee.name });
      res.json({ planWindowOpen: !!open });
    } catch (err) {
      res.status(500).json({ error: "Failed to update plan window." });
    }
  });
  // ---- End Plan Window Control ----

  app.post("/api/daily-plans", async (req, res) => {
    try {
      const { employeeId, date, selectedTasks, unselectedTasks } = req.body;
      const istNowForPlan = new Date(new Date().getTime() + (new Date().getTimezoneOffset() * 60000) + (5.5 * 60 * 60 * 1000));
      const todayString = istNowForPlan.toISOString().split('T')[0];
      const planDate = date || todayString;

      const employee = await storage.getEmployee(employeeId);
      if (employee?.employeeCode) {
        const leaveStatus = await getLeaveStatusForDate(employee.employeeCode, planDate);
        if (leaveStatus.hasLeave) {
          const detail = leaveStatus.status === 'Pending' ? 'pending leave' : 'approved leave';
          return res.status(403).json({
            error: `You are on ${detail} today, so the plan for this day is blocked.`,
            message: `You are on ${detail} today, so the plan for this day is blocked.`
          });
        }
      }

      // Check if plan window is open (manual override has priority)
      const settings = await readSettings();
      const allowLatePlanSubmission = !!settings.allowLatePlanSubmission;

      const istNow = new Date(new Date().getTime() + (new Date().getTimezoneOffset() * 60000) + (5.5 * 60 * 60 * 1000));
      const today = format(istNow, "yyyy-MM-dd");
      const isAutomatedClosed = await storage.isDailyPlanClosed(today);

      // OD (On-Duty) exemption: an approved OD pushes the cutoff to the end
      // of the OD window (or exempts the whole day, for a Full Day OD), so
      // the employee isn't blocked from submitting/exempted incorrectly
      // while genuinely on approved OD.
      let odExempt = false;
      let effectiveCutoffMinutes = 12 * 60 + 30;
      try {
        const employeeForOD = await storage.getEmployee(employeeId);
        if (employeeForOD) {
          const exemption = await getODExemption(employeeForOD.employeeCode, today);
          if (exemption.hasApprovedOD) {
            odExempt = exemption.isFullDay || isWithinApprovedOD(exemption, new Date());
            effectiveCutoffMinutes = getEffectivePlanCutoffMinutes(exemption, effectiveCutoffMinutes);
          }
        }
      } catch (odErr) {
        console.error("[DAILY PLANS] Failed to check OD exemption:", odErr);
      }

      const isPastCutoff = isAfterPlanCutoff(effectiveCutoffMinutes);

      const isOverrideToday = settings.planWindowLastModifiedDate === today;
      const planWindowOpen = isOverrideToday
        ? !!settings.planWindowOpen
        : ((!isAutomatedClosed && !isPastCutoff) || odExempt || allowLatePlanSubmission);

      if (!planWindowOpen) {
        const reason = isPastCutoff ? "12:30 PM cutoff" : "administrative closure";
        return res.status(403).json({
          error: `Plan window is closed (${reason}). Contact your administrator to reopen.`,
          message: `Plan window is closed (${reason})`
        });
      }

      // Portal is manually OPEN and not past cutoff - allow submissions

      // Enforce auto-selected PMS tasks are included
      const { getProjects } = await import('./pmsSupabase');
      if (employee) {
        const userDept = employee.department || '';
        const projects = await getProjects(employee.role, employee.employeeCode, userDept);
        const { getTasks } = await import('./pmsSupabase');
        const getISTTodayKey = (): string => {
          const now = new Date();
          // Adjust for IST (UTC+5.5) regardless of server locale
          const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
          const istNow = new Date(utcNow + (5.5 * 60 * 60 * 1000));
          return istNow.toISOString().split('T')[0];
        };
        const todayKey = getISTTodayKey();

        // Fetch all project tasks in parallel instead of sequentially
        const allProjectTasks = await Promise.all(
          projects.map((project: any) =>
            getTasks(project.project_code, userDept, employee.employeeCode, employee.role)
          )
        );
        for (const projectTasks of allProjectTasks) {
          const mandatoryTasks = projectTasks.filter((t: any) => shouldSyncPMSTask(t, todayKey));
          for (const mt of mandatoryTasks) {
            const isIncluded = selectedTasks.some((st: any) => st.id === mt.id);
            if (!isIncluded) {
              return res.status(400).json({
                error: `Mandatory PMS task '${mt.task_name}' is missing from your plan.`,
                taskId: mt.id
              });
            }
          }
        }
      }

      // Plan window is always open unless explicitly restricted by other future logic
      const isInTimeWindow = true;
      let plan;
      const existingPlan = await storage.getDailyPlanByDate(employeeId, planDate);

      if (existingPlan) {
        // If plan exists, we'll "re-submit" it by clearing tasks and starting over
        // This is only allowed if the window is forced open or during the 9-12 AM window
        plan = existingPlan;
        // Delete existing tasks for this plan
        await pool.query('DELETE FROM plan_tasks WHERE plan_id = $1', [plan.id]);
      } else {
        plan = await storage.createDailyPlan({ employeeId, date: planDate });
      }

      // Fetch existing time entries for today to avoid duplicates
      const existingEntries = await storage.getTimeEntriesByEmployee(employeeId);
      const todayEntries = existingEntries.filter((e: any) => e.date === planDate);

      // Save all selected tasks in parallel — createPlanTask + createTimeEntry
      // are batched with Promise.all so the 20+ DB round-trips run concurrently
      // instead of sequentially, reducing total wait time to ~1 round-trip.
      await Promise.all(selectedTasks.map(async (t: any) => {
        // Tool the employee expects to use for this planned task, selected via
        // the Plan for the Day's "Tool Selection" field. Falls back to
        // scheduleData.tool in case the client only nested it there.
        const tTool: string | null = t.tool || t.scheduleData?.tool || null;

        await storage.createPlanTask({
          planId: plan.id,
          taskId: t.id,
          projectName: t.projectName || t.project_code,
          taskName: t.task_name,
          isDeviation: false,
          status: 'approved',
          source: t.source || 'Manual',
          isLocked: !!t.isLocked,
          tool: tTool,
          scheduleData: t.scheduleData || {
            startTime: t.startTime,
            endTime: t.endTime,
            durationMinutes: t.durationMinutes,
            order: t.order ?? 0,
            extensionReason: t.extensionReason || null,
          }
        });

        if (employee) {
          const tStart = t.scheduleData?.startTime || t.startTime || null;
          const tEnd = t.scheduleData?.endTime || t.endTime || null;
          let totalHours = '00:00';
          if (tStart && tEnd) {
            const [sh, sm] = tStart.split(':').map(Number);
            const [eh, em] = tEnd.split(':').map(Number);
            const diffMin = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
            totalHours = `${String(Math.floor(diffMin / 60)).padStart(2, '0')}:${String(diffMin % 60).padStart(2, '0')}`;
          }

          // Carry the subtask the user picked on Plan-for-Day through to the generated
          // time entry, the same way it's carried on manually-created entries (TaskEntryPage/
          // TrackerPage), so it shows up correctly downstream in the Tracker, Approvals,
          // Rejections, and any other module that reads pmsSubtaskId off a time entry.
          const tSubtaskId = t.scheduleData?.subtaskId || t.subtaskId || null;
          const tSubtaskName = t.scheduleData?.subtaskName || t.subtaskName || null;
          const entryDescription = tSubtaskName ? `${t.task_name} | ${tSubtaskName}` : t.task_name;

          // Check if we already created a time entry for this task (and, if picked, subtask)
          // on this date with the exact same time block.
          const alreadyExists = todayEntries.some((e: any) => {
            const sameTask = (t.id && !t.id.startsWith('planned-') && !t.id.startsWith('break-'))
              ? (e.pmsId === t.id || e.pmsSubtaskId === t.id)
              : (e.taskDescription === t.task_name);
            const sameSubtask = (e.pmsSubtaskId || null) === (tSubtaskId || null);
            return sameTask && sameSubtask && e.startTime === tStart && e.endTime === tEnd;
          });

          const isBreakTask = t.isBreak || (t.id && String(t.id).startsWith('break-'));

          if (!alreadyExists && !isBreakTask) {
            await storage.createTimeEntry({
              employeeId,
              employeeCode: employee.employeeCode,
              employeeName: employee.name,
              date: planDate,
              projectName: t.projectName || t.project_code || "General",
              taskDescription: entryDescription,
              quantify: "",
              startTime: tStart,
              endTime: tEnd,
              totalHours,
              toolsUsed: tTool ? [tTool] : [],
              pmsId: t.id && !t.id.startsWith('planned-') && !t.id.startsWith('break-') ? t.id : null,
              pmsSubtaskId: tSubtaskId,
              status: 'draft'
            });
          }
        }
      }));

      // Save unselected tasks as postponements — also in parallel
      if (unselectedTasks && unselectedTasks.length > 0) {
        await Promise.all(unselectedTasks.map((t: any) =>
          pool.query(
            `INSERT INTO task_postponements (task_id, task_name, reason, previous_due_date, new_due_date, postponed_by, postponed_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [t.taskId, t.taskName, t.reason, null, t.newDueDate, employeeId]
          )
        ));
      }

      broadcast("daily_plan_submitted", { plan, employeeId });

      // ✅ Respond immediately — the client gets instant confirmation.
      // All remaining work (PMS calendar sync, emails) runs fire-and-forget
      // in the background so it never blocks the 201 response.
      res.status(201).json(plan);

      // Mirror the submitted plan into PMS's shared calendar_events table so
      // it shows up immediately in both Timestrap's and PMS's calendar views.
      // Best-effort / fire-and-forget: runs in the background so it NEVER
      // blocks or delays the plan submission response (prevents 504 timeouts
      // for test employees or when PMS DB is slow/unreachable).
      if (employee?.employeeCode) {
        const _empCode = employee.employeeCode;
        const _tasks = [...selectedTasks];
        const _planDate = planDate;
        (async () => {
          console.log(`[SYNC] Starting plan sync for employee ${_empCode} with ${_tasks.length} tasks.`);
          for (const t of _tasks) {
            const tStart = t.scheduleData?.startTime || t.startTime || null;
            const tEnd = t.scheduleData?.endTime || t.endTime || null;
            if (!tStart || !tEnd) {
              console.log(`[SYNC] Skipping task ${t.id} due to missing time slot.`);
              continue; // skip tasks without a scheduled time slot
            }
            if (!t.id) {
              console.log(`[SYNC] Skipping task due to missing id.`);
              continue; // need some stable id to key the calendar row on
            }

            try {
              console.log(`[SYNC] Calling upsertPmsPlanCalendarEvent for task ${t.id} (${tStart}-${tEnd}).`);
              const syncedEvent = await upsertPmsPlanCalendarEvent(_empCode, {
                taskId: t.id,
                title: t.task_name || (t.id.startsWith('break-') ? 'Break' : 'Task'),
                project: t.projectName || t.project_code,
                date: _planDate,
                startTime: tStart,
                endTime: tEnd,
              }, { matchBySlot: true });
              console.log(`[SYNC] Successfully synced task ${t.id}. Event ID: ${syncedEvent?.id}`);
            } catch (pmsSyncError) {
              console.error(`[SYNC ERROR] Failed to sync plan task ${t.id} to PMS calendar:`, pmsSyncError);
            }
          }
        })().catch((err) => console.error('[SYNC] Unexpected error in background PMS sync:', err));
      } else {
        console.warn(`[SYNC WARNING] No employee code found for ${employeeId}.`);
      }

      // Fire-and-forget: send email notifications in the background.
      // The client already received the 201 response above; emails must
      // never block or delay the submission confirmation.
      (async () => {
        try {
          const sortedTasksForEmail = [...selectedTasks].sort((a: any, b: any) => {
            const aStart = a.scheduleData?.startTime || a.startTime || "00:00";
            const bStart = b.scheduleData?.startTime || b.startTime || "00:00";
            return aStart.localeCompare(bStart);
          });
          const { sendDailyPlanSubmittedEmail, sendDailyPlanConfirmationEmail } = await import('./email');
          const emp = await storage.getEmployee(employeeId);
          if (emp) {
            // Send to Admin/HR and employee confirmation in parallel
            await Promise.all([
              sendDailyPlanSubmittedEmail({
                employeeName: emp.name,
                employeeCode: emp.employeeCode,
                selectedTasks: sortedTasksForEmail,
                unselectedTasks: unselectedTasks || []
              }),
              emp.email ? sendDailyPlanConfirmationEmail({
                employeeName: emp.name,
                employeeCode: emp.employeeCode,
                employeeEmail: emp.email,
                date: planDate,
                selectedTasks: sortedTasksForEmail,
                unselectedTasks: unselectedTasks || []
              }) : Promise.resolve(),
            ]);
          }
        } catch (emailErr) {
          console.error('[EMAIL] Daily plan notification failed:', emailErr);
        }
      })().catch((err) => console.error('[EMAIL] Unexpected error in background email:', err));
    } catch (error) {
      console.error("Create daily plan error:", error);
      res.status(500).json({ error: "Failed to create daily plan" });
    }
  });

  app.post("/api/daily-plans/reminder", async (req, res) => {
    try {
      const { employeeId } = req.body;

      // Validate request
      if (!employeeId) {
        return res.status(400).json({ error: "Missing employeeId in request body" });
      }

      const actor = await storage.getEmployee(employeeId);

      // Access Restricted: Only E0046 and E0048 can send reminders
      if (!actor || (actor.employeeCode !== 'E0046' && actor.employeeCode !== 'E0048')) {
        console.warn(`[REMINDER API] Unauthorized access attempt by: ${employeeId}`);
        return res.status(403).json({ error: "Unauthorized. Access limited to E0046 and E0048." });
      }

      console.log(`[REMINDER API] Starting reminder send by ${actor.employeeCode}...`);

      const allEmployees = await storage.getEmployees();
      if (!allEmployees || allEmployees.length === 0) {
        console.warn("[REMINDER API] No employees found in database");
        return res.status(200).json({ success: true, count: 0, failed: [], message: "No employees to send reminders to" });
      }

      const activeEmployees = allEmployees.filter(e => e.isActive && e.role !== 'admin' && e.email);
      console.log(`[REMINDER API] Found ${activeEmployees.length} active employees with email`);

      const today = format(new Date(), 'yyyy-MM-dd');

      let { sendDailyPlanReminderEmail } = await import('./email');
      if (!sendDailyPlanReminderEmail) {
        throw new Error("sendDailyPlanReminderEmail function not found");
      }

      let sentCount = 0;
      const failed: Array<{ employeeCode: string; email: string | null; error: any }> = [];

      for (const emp of activeEmployees) {
        try {
          // Verify email is valid string (should already be verified by filter, but double-check)
          if (!emp.email || typeof emp.email !== 'string') {
            console.warn(`[REMINDER API] Employee ${emp.employeeCode} has invalid email: ${emp.email}`);
            failed.push({
              employeeCode: emp.employeeCode,
              email: emp.email || null,
              error: 'Invalid email address'
            });
            continue;
          }

          // Fetch tasks for employee
          let pendingTasks: string[] = [];
          try {
            const tasks = await getTasks(undefined, undefined, emp.employeeCode);
            if (Array.isArray(tasks) && tasks.length > 0) {
              pendingTasks = tasks
                .filter((t: any) => t && t.task_name)
                .map((t: any) => String(t.task_name).trim())
                .filter((name: string) => name.length > 0);
            }
          } catch (taskErr) {
            console.warn(`[REMINDER API] Failed to fetch tasks for ${emp.employeeCode}:`, taskErr);
            // Continue without tasks - this is not a blocker
          }

          // Send reminder email to all active employees (regardless of submission status)
          const result = await sendDailyPlanReminderEmail({
            recipients: [emp.email],
            pendingTasks
          });

          if (result?.success) {
            sentCount += 1;
            console.log(`[REMINDER API] ✓ Sent to ${emp.employeeCode} (${emp.email})`);
          } else {
            failed.push({
              employeeCode: emp.employeeCode,
              email: emp.email,
              error: result?.error || 'Unknown error'
            });
            console.error(`[REMINDER API] ✗ Failed for ${emp.employeeCode}: ${result?.error || 'unknown'}`);
          }
        } catch (empErr) {
          console.error(`[REMINDER API] Error processing ${emp.employeeCode}:`, empErr);
          failed.push({
            employeeCode: emp.employeeCode,
            email: emp.email,
            error: empErr instanceof Error ? empErr.message : String(empErr)
          });
        }
      }

      console.log(`[REMINDER API] Summary: Sent=${sentCount}, Failed=${failed.length}`);

      if (sentCount === 0 && failed.length > 0) {
        return res.status(400).json({
          error: "Failed to send any reminder emails",
          details: { failed, sentCount }
        });
      }

      return res.json({
        success: true,
        count: sentCount,
        failed,
        summary: `Sent ${sentCount} reminder(s) to all active employees. ${failed.length} failed.`
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[REMINDER API] Failed:", err);
      res.status(500).json({
        error: "Server error while sending reminders",
        details: process.env.NODE_ENV === 'development' ? errorMsg : undefined
      });
    }
  });

  // ============ END OF DAY TRACKING ROUTE ============
  app.post("/api/admin/check-missing-submissions", async (req, res) => {
    try {
      const { actorId } = req.body;
      const actor = await storage.getEmployee(actorId);
      if (!actor || (actor.role !== 'admin' && actor.role !== 'hr')) {
        return res.status(403).json({ error: "Unauthorized. Admin/HR only." });
      }

      const now = new Date();
      const hour = now.getHours();
      if (hour < 12) {
        return res.status(403).json({ error: "Close Alert can only be sent at or after 12:00 PM." });
      }

      const today = now.toISOString().split('T')[0];
      const allEmployees = await storage.getEmployees();
      const activeEmployees = allEmployees.filter(e => e.isActive && e.role === 'employee');

      const missedTimesheet: any[] = [];
      const missedDailyPlan: any[] = [];
      const missedByEmployee = new Map<string, any>();

      for (const emp of activeEmployees) {
        const plan = await storage.getDailyPlanByDate(emp.id, today);
        const entries = await storage.getTimeEntriesByEmployeeAndDate(emp.id, today);
        const missedItems: string[] = [];

        // OD (On-Duty) exemption: an employee on an approved Full Day OD, or
        // currently within their approved OD window, should not be flagged
        // as having missed their Plan of the Day.
        let odExemptToday = false;
        try {
          const exemption = await getODExemption(emp.employeeCode, today);
          odExemptToday = exemption.hasApprovedOD && (exemption.isFullDay || isWithinApprovedOD(exemption, now));
        } catch (odErr) {
          console.error(`[END OF DAY CHECK] OD lookup failed for ${emp.employeeCode}:`, odErr);
        }

        if (!plan && !odExemptToday) missedItems.push('daily_plan');
        if (entries.length === 0) missedItems.push('timesheet');

        if (missedItems.length > 0) {
          missedByEmployee.set(emp.employeeCode, {
            employeeName: emp.name,
            employeeCode: emp.employeeCode,
            department: emp.department,
            email: emp.email,
            missedItems,
          });
        }

        if (!plan && !odExemptToday) {
          missedDailyPlan.push({
            employeeName: emp.name,
            employeeCode: emp.employeeCode,
            department: emp.department,
            email: emp.email
          });
        }

        if (entries.length === 0) {
          missedTimesheet.push({
            employeeName: emp.name,
            employeeCode: emp.employeeCode,
            department: emp.department,
            email: emp.email
          });
        }
      }

      const { generateAndSendEODReport } = await import('./scheduler');
      await generateAndSendEODReport(today, 'Manual Alert');

      res.json({
        success: true,
        summary: {
          missedDailyPlan: missedDailyPlan.length,
          missedTimesheet: missedTimesheet.length,
          affectedEmployees: missedByEmployee.size,
        }
      });
    } catch (err) {
      console.error("[END OF DAY CHECK] Failed:", err);
      res.status(500).json({ error: "Failed to run missed submission check." });
    }
  });

  app.post("/api/daily-plans/deviations", async (req, res) => {
    try {
      const { employeeId, taskId, taskName, projectName, reason } = req.body;
      const date = new Date().toISOString().split('T')[0];
      const plan = await storage.getDailyPlanByDate(employeeId, date);
      if (!plan) return res.status(400).json({ error: "Plan for the day must be submitted first." });

      const existingTasks = await storage.getPlanTasks(plan.id);
      const deviationsCount = existingTasks.filter(t => t.isDeviation).length;
      if (deviationsCount >= 10) {
        return res.status(403).json({ error: "Maximum limit of 10 deviations per day reached. Please contact your manager if you need more." });
      }

      const task = await storage.createPlanTask({
        planId: plan.id,
        taskId,
        taskName,
        projectName,
        isDeviation: true,
        deviationReason: reason,
        status: 'pending'
      });

      // Notify manager of deviation
      try {
        const { sendDeviationNotificationEmail } = await import('./email');
        const employee = await storage.getEmployee(employeeId);
        const emailResult = await sendDeviationNotificationEmail({
          employeeName: employee?.name || 'Employee',
          employeeCode: employee?.employeeCode || employeeId,
          taskName,
          projectName,
          reason
        });
        if (emailResult?.success) {
          console.log('[EMAIL] Deviation notification email sent successfully');
        } else {
          console.error('[EMAIL] Failed to send deviation notification email:', emailResult?.error || 'Unknown error');
        }
      } catch (e) {
        console.error('[EMAIL] Deviation notification failed with exception:', e);
      }

      broadcast("daily_plan_deviation", { task, employeeId });
      res.status(201).json(task);
    } catch (error) {
      console.error("Deviation error:", error);
      res.status(500).json({ error: "Failed to add deviation" });
    }
  });

  app.get("/api/pending-deadline-tasks", async (req, res) => {
    try {
      const { employeeId, date } = req.query;
      res.json([]); // Placeholder
    } catch (err) {
      res.status(500).json([]);
    }
  });

  app.get("/api/daily-plans/all", async (req, res) => {
    try {
      const plans = await storage.getAllDailyPlans();
      if (plans.length === 0) return res.json([]);

      const employeeIds = Array.from(new Set(plans.map(p => p.employeeId)));
      const planIds = plans.map(p => p.id);

      // 1. Batch fetch employees
      const employeeMap = new Map<string, any>();
      const allEmps = await storage.getEmployees();
      allEmps.forEach(e => employeeMap.set(e.id, e));

      // 2. Batch fetch plan tasks
      const tasksByPlan = new Map<string, any[]>();
      try {
        const allTasks = await storage.getBatchPlanTasksByPlanIds(planIds);
        allTasks.forEach(t => {
          const list = tasksByPlan.get(t.planId) || [];
          list.push(t);
          tasksByPlan.set(t.planId, list);
        });
      } catch (e) {
        console.error("Batch plan tasks fetch failed:", e);
      }

      // 3. Batch fetch postponements
      const postponementsByEmpDate = new Map<string, any[]>();
      try {
        const postRes = await pool.query(
          `SELECT task_name, reason, new_due_date, postponed_by, DATE(postponed_at)::text as p_date 
           FROM task_postponements 
           WHERE postponed_by = ANY($1::varchar[])`,
          [employeeIds]
        );
        postRes.rows.forEach(row => {
          const key = `${row.postponed_by}_${row.p_date}`;
          const list = postponementsByEmpDate.get(key) || [];
          list.push(row);
          postponementsByEmpDate.set(key, list);
        });
      } catch (e) {
        console.error("Batch postponements fetch failed:", e);
      }

      const enrichedPlans = plans.map(p => {
        const employee = employeeMap.get(p.employeeId);
        const tasks = tasksByPlan.get(p.id) || [];
        const postKey = `${p.employeeId}_${p.date}`;
        const postponedTasks = postponementsByEmpDate.get(postKey) || [];

        return {
          ...p,
          employeeName: employee?.name || 'Unknown',
          employeeCode: employee?.employeeCode || 'Unknown',
          tasks,
          postponedTasks
        };
      });

      res.json(enrichedPlans);
    } catch (error) {
      console.error("Get all daily plans error:", error);
      res.status(500).json({ error: "Failed to fetch daily plans" });
    }
  });

  app.patch("/api/daily-plans/tasks/:taskId/status", async (req, res) => {
    try {
      const { taskId } = req.params;
      const { status } = req.body; // 'approved' or 'rejected'
      await storage.updatePlanTask(taskId, { status });
      res.json({ success: true });
    } catch (error) {
      console.error("Update plan task status error:", error);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // Get available PMS tasks grouped by project for the employee's department
  app.get("/api/available-tasks", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string;

      console.log("[AVAILABLE-TASKS] Request received for employee:", employeeId);

      if (!employeeId) {
        return res.status(400).json({ error: "Employee ID is required" });
      }

      // Get employee info to get department
      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        console.error("[AVAILABLE-TASKS] Employee not found in database:", employeeId);
        return res.status(404).json({ error: "Employee not found" });
      }

      const viewType = req.query.viewType as string;

      console.log("[AVAILABLE-TASKS] Fetching for employee:", {
        name: employee.name,
        code: employee.employeeCode,
        dept: employee.department,
        role: employee.role,
        viewType
      });

      let userDepartment = employee.department || '';

      // Specific requirement for E0001 Sam Prakash to be presales department
      if (employee.employeeCode === 'E0001' || employee.employeeCode === 'E0000') {
        userDepartment = 'presales';
      }

      let effectiveRole = employee.role;
      let effectiveEmpCode = employee.employeeCode;
      // When admin/manager picks "My Tasks" we should ONLY return tasks assigned
      // to that user (i.e. tasks where they are a task member). The default
      // `getDepartmentTasks` query also includes unassigned tasks
      // (`tm.task_id IS NULL`); to honor "My Tasks" we pass a flag so the helper
      // can drop those unassigned rows for this view.
      let myTasksOnly = false;

      // Override for Admin/Manager to get specific views
      if ((employee.role === 'admin' || employee.role === 'manager' || employee.employeeCode === 'E0000' || employee.employeeCode === 'E0001') && viewType) {
        if (viewType === 'my-tasks') {
          effectiveRole = 'employee';
          // effectiveEmpCode remains employee.employeeCode
          myTasksOnly = true;
        } else if (viewType === 'department') {
          effectiveRole = 'employee';
          effectiveEmpCode = null as any;
        }
      }


      // Get projects for this employee's department
      const { getProjects } = await import('./pmsSupabase');
      const projects = await getProjects(effectiveRole, effectiveEmpCode, userDepartment);
      console.log(`[AVAILABLE-TASKS] Found ${projects.length} projects for department "${userDepartment}"`);

      // Fetch tasks for each project and group them
      const { getTasks } = await import('./pmsSupabase');
      const tasksWithProjects: any[] = [];

      // Extract just YYYY-MM-DD from a date string to avoid UTC conversion issues.
      // E.g. "2026-04-16T00:00:00+05:30" → "2026-04-16" (no Date object created, no timezone shift)
      const extractDatePart = (dateStr: string | null | undefined): string | null => {
        if (!dateStr) return null;
        return String(dateStr).substring(0, 10); // Always "YYYY-MM-DD"
      };

      // Compute today's date in IST (UTC+5:30) so the server's UTC clock doesn't cause off-by-one day errors
      const getISTTodayKey = (): string => {
        const now = new Date();
        const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
        const istNow = new Date(utcNow + (5.5 * 60 * 60 * 1000));
        return istNow.toISOString().split('T')[0];
      };
      const todayKey = getISTTodayKey();

      // Fetch all tasks for the department in a single query
      const { getDepartmentTasks } = await import('./pmsSupabase');
      const allProjectTasks = await getDepartmentTasks(userDepartment, effectiveEmpCode, effectiveRole, myTasksOnly);


      console.log(`[AVAILABLE-TASKS] Found ${allProjectTasks.length} tasks across all projects`);

      // Fetch subtasks for every task in one batched query (grouped by task_id) so we
      // don't issue a separate DB round-trip per task. Tasks with no subtasks simply
      // get an empty array back — they render normally with nothing nested beneath them.
      const { getSubtasksForTaskIds } = await import('./pmsSupabase');
      const subtasksByTaskId = await getSubtasksForTaskIds(allProjectTasks.map((t: any) => t.id));

      for (const task of allProjectTasks) {
        const project = task.project;
        if (!project) continue;

        const projectKey = extractDatePart(project.end_date);
        const isProjectOverdue = projectKey ? projectKey < todayKey : false;
        const taskKey = extractDatePart(task.end_date);
        const isTaskOverdue = taskKey ? taskKey < todayKey : false;

        const isAutoSelected = shouldSyncPMSTask(task, todayKey);

        tasksWithProjects.push({
          ...task,
          projectCode: project.project_code,
          projectName: project.project_name,
          projectDescription: project.description,
          projectDeadline: project.end_date || null,
          taskDeadline: task.end_date || null,
          isProjectOverdue: isProjectOverdue || false,
          isTaskOverdue: isTaskOverdue || false,
          isOverdue: (isTaskOverdue || isProjectOverdue) ? true : false,
          source: "PMS",
          isLocked: isAutoSelected,
          isAutoSelected: isAutoSelected,
          subtasks: subtasksByTaskId[String(task.id)] || []
        });
      }

      console.log(`[AVAILABLE-TASKS] Total tasks processed for ${employee.name}: ${tasksWithProjects.length}`);
      res.json(tasksWithProjects);
    } catch (error) {
      console.error("[AVAILABLE-TASKS] Error:", error);
      res.status(500).json({ error: "Failed to fetch available tasks", details: String(error) });
    }
  });

  // ============ AUTO REJECT TOGGLE (Admin > Settings) ============
  app.get('/api/settings/auto-reject', async (_req, res) => {
    try {
      const settings = await readSettings();
      res.json({ autoRejectEnabled: settings.autoRejectEnabled === true });
    } catch (error) {
      console.error('[SETTINGS] Failed to read auto reject:', error);
      res.status(500).json({ error: 'Failed to get auto reject setting' });
    }
  });

  app.patch('/api/settings/auto-reject', async (req, res) => {
    try {
      const admin = await loadReviewAdmin(req.body?.adminId);
      if (!admin) return res.status(403).json({ error: 'Only admins can change Auto Reject' });
      if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
      const settings = await readSettings();
      settings.autoRejectEnabled = req.body.enabled;
      const success = await writeSettings(settings);
      if (!success) return res.status(500).json({ error: 'Failed to write settings' });
      broadcast('settings_updated', { autoRejectEnabled: settings.autoRejectEnabled });
      res.json({ autoRejectEnabled: settings.autoRejectEnabled });
    } catch (error) {
      console.error('[SETTINGS] Failed to update auto reject:', error);
      res.status(500).json({ error: 'Failed to update auto reject setting' });
    }
  });

  // ============ DEFAULT REJECTION REASON (saved text pre-fills the Reject dialog) ============
  app.get('/api/settings/default-rejection-reason', async (_req, res) => {
    try {
      const settings = await readSettings();
      res.json({ defaultRejectionReason: settings.defaultRejectionReason || '' });
    } catch (error) {
      console.error('[SETTINGS] Failed to read default rejection reason:', error);
      res.status(500).json({ error: 'Failed to get default rejection reason' });
    }
  });

  app.patch('/api/settings/default-rejection-reason', async (req, res) => {
    try {
      const admin = await loadReviewAdmin(req.body?.adminId);
      if (!admin) return res.status(403).json({ error: 'Only admins can change this setting' });
      if (typeof req.body?.reason !== 'string') return res.status(400).json({ error: 'reason must be a string' });
      const settings = await readSettings();
      settings.defaultRejectionReason = req.body.reason.trim();
      const success = await writeSettings(settings);
      if (!success) return res.status(500).json({ error: 'Failed to write settings' });
      broadcast('settings_updated', { defaultRejectionReason: settings.defaultRejectionReason });
      res.json({ defaultRejectionReason: settings.defaultRejectionReason });
    } catch (error) {
      console.error('[SETTINGS] Failed to update default rejection reason:', error);
      res.status(500).json({ error: 'Failed to update default rejection reason' });
    }
  });

  // ============ DEFAULT APPROVAL NOTE (saved text shown inside the Approval conditions box) ============
  app.get('/api/settings/default-approval-note', async (_req, res) => {
    try {
      const settings = await readSettings();
      res.json({ defaultApprovalNote: settings.defaultApprovalNote || '' });
    } catch (error) {
      console.error('[SETTINGS] Failed to read default approval note:', error);
      res.status(500).json({ error: 'Failed to get default approval note' });
    }
  });

  app.patch('/api/settings/default-approval-note', async (req, res) => {
    try {
      const admin = await loadReviewAdmin(req.body?.adminId);
      if (!admin) return res.status(403).json({ error: 'Only admins can change this setting' });
      if (typeof req.body?.note !== 'string') return res.status(400).json({ error: 'note must be a string' });
      const settings = await readSettings();
      settings.defaultApprovalNote = req.body.note.trim();
      const success = await writeSettings(settings);
      if (!success) return res.status(500).json({ error: 'Failed to write settings' });
      broadcast('settings_updated', { defaultApprovalNote: settings.defaultApprovalNote });
      res.json({ defaultApprovalNote: settings.defaultApprovalNote });
    } catch (error) {
      console.error('[SETTINGS] Failed to update default approval note:', error);
      res.status(500).json({ error: 'Failed to update default approval note' });
    }
  });


  app.get('/api/settings/timesheet-blocking', async (req, res) => {
    try {
      const settings = await readSettings();
      res.json({ blockUnassignedProjectTasks: !!settings.blockUnassignedProjectTasks });
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  // ============ TIMEGUARD SUGGESTIONS GLOBAL TOGGLE ============
  // Global switch controlling whether the "Suggest from TimeGuard" feature
  // is visible/usable for all users. Defaults to enabled unless explicitly
  // disabled by an admin/HR user in User Management.
  app.get('/api/settings/timeguard-suggestions', async (req, res) => {
    try {
      const settings = await readSettings();
      res.json({ timeguardSuggestionsEnabled: settings.timeguardSuggestionsEnabled !== false });
    } catch (error) {
      console.error('Get TimeGuard suggestions setting error:', error);
      res.status(500).json({ error: 'Failed to get TimeGuard suggestions setting' });
    }
  });

  app.patch('/api/settings/timeguard-suggestions', async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      const settings = await readSettings();
      settings.timeguardSuggestionsEnabled = enabled;
      const success = await writeSettings(settings);
      if (!success) {
        return res.status(500).json({ error: 'Failed to write settings' });
      }
      broadcast('timeguard_suggestions_setting_changed', { timeguardSuggestionsEnabled: enabled });
      res.json({ timeguardSuggestionsEnabled: enabled });
    } catch (error) {
      console.error('Update TimeGuard suggestions setting error:', error);
      res.status(500).json({ error: 'Failed to update TimeGuard suggestions setting' });
    }
  });

  // Project points storage endpoints (safe: creates its own table if missing)
  app.get('/api/project-points/:projectId', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const { getProjectProgress } = await import('./pmsSupabase');

      // ensure table exists
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS project_points (
            project_id text PRIMARY KEY,
            points integer NOT NULL DEFAULT 0,
            last_active timestamptz
          )`);
      } catch (e) { /* ignore */ }

      // SYNC WITH PMS: Fetch real-time progress from hierarchy
      const progress = await getProjectProgress(projectId);
      const targetPoints = Math.round(progress * 10);

      // Upsert into local points table
      await pool.query(
        `INSERT INTO project_points (project_id, points, last_active) 
         VALUES ($1, $2, COALESCE((SELECT last_active FROM project_points WHERE project_id = $1), NOW())) 
         ON CONFLICT (project_id) DO UPDATE SET points = EXCLUDED.points`,
        [projectId, targetPoints]
      );

      const q = await pool.query('SELECT project_id as "projectId", points, last_active as "lastActive" FROM project_points WHERE project_id = $1', [projectId]);
      if (q.rows && q.rows.length > 0) return res.json(q.rows[0]);
      return res.json({ projectId, points: targetPoints, lastActive: null });
    } catch (err) {
      console.error('Get project points error:', err);
      res.status(500).json({ error: 'Failed to fetch project points' });
    }
  });

  // Patch project points: body { delta?: number, set?: number, touchLastActive?: boolean }
  app.patch('/api/project-points/:projectId', async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const { delta, set, touchLastActive } = req.body || {};

      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS project_points (
            project_id text PRIMARY KEY,
            points integer NOT NULL DEFAULT 0,
            last_active timestamptz
          )`);
      } catch (e) { /* ignore */ }

      // upsert logic
      if (typeof set === 'number') {
        await pool.query(`INSERT INTO project_points (project_id, points, last_active) VALUES ($1, $2, $3) ON CONFLICT (project_id) DO UPDATE SET points = EXCLUDED.points, last_active = EXCLUDED.last_active`, [projectId, Math.max(0, Math.floor(set)), touchLastActive ? new Date() : null]);
      } else if (typeof delta === 'number') {
        // update points by delta, clamp at 0
        const cur = await pool.query('SELECT points FROM project_points WHERE project_id = $1', [projectId]);
        const prev = (cur.rows && cur.rows[0] && typeof cur.rows[0].points === 'number') ? parseInt(cur.rows[0].points) : 0;
        const next = Math.max(0, prev + Math.floor(delta));
        await pool.query(`INSERT INTO project_points (project_id, points, last_active) VALUES ($1, $2, $3) ON CONFLICT (project_id) DO UPDATE SET points = $2, last_active = COALESCE($3, project_points.last_active)`, [projectId, next, touchLastActive ? new Date() : null]);
      } else {
        return res.status(400).json({ error: 'delta or set required' });
      }

      const q = await pool.query('SELECT project_id as "projectId", points, last_active as "lastActive" FROM project_points WHERE project_id = $1', [projectId]);
      return res.json(q.rows && q.rows[0] ? q.rows[0] : { projectId, points: 0, lastActive: null });
    } catch (err) {
      console.error('Patch project points error:', err);
      res.status(500).json({ error: 'Failed to update project points' });
    }
  });

  // Update timesheet blocking settings
  app.patch('/api/settings/timesheet-blocking', async (req, res) => {
    try {
      const { blockUnassignedProjectTasks } = req.body;
      const settings = await readSettings();
      settings.blockUnassignedProjectTasks = !!blockUnassignedProjectTasks;
      const success = await writeSettings(settings);
      if (!success) {
        return res.status(500).json({ error: 'Failed to write settings' });
      }
      res.json({ blockUnassignedProjectTasks: !!settings.blockUnassignedProjectTasks });
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // Toggle force allow final submit (E0046, E0048 only)
  app.patch('/api/settings/force-allow-final-submit', async (req, res) => {
    try {
      const { employeeId, enabled } = req.body;
      const actor = await storage.getEmployee(employeeId);
      if (!actor || (actor.employeeCode !== 'E0046' && actor.employeeCode !== 'E0048')) {
        return res.status(403).json({ error: 'Unauthorized. Only E0046 and E0048 can toggle this setting.' });
      }
      const settings = await readSettings();
      settings.forceAllowFinalSubmit = !!enabled;
      const success = await writeSettings(settings);
      if (!success) {
        return res.status(500).json({ error: 'Failed to write settings' });
      }
      broadcast('force_allow_final_submit_changed', { enabled: !!enabled, changedBy: actor.name });
      res.json({ success: true, settings });
    } catch (err) {
      console.error('[SETTINGS] Failed to toggle force allow final submit:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.patch('/api/settings/late-plan-override', async (req, res) => {
    try {
      const { employeeId, enabled } = req.body;
      const actor = await storage.getEmployee(employeeId);
      if (!actor || !['admin', 'manager', 'hr'].includes(actor.role) && actor.employeeCode !== 'E0046') {
        return res.status(403).json({ error: 'Unauthorized. Only admins/managers/HR can toggle this setting.' });
      }
      const settings = await readSettings();
      settings.allowLatePlanSubmission = !!enabled;
      const success = await writeSettings(settings);
      if (!success) {
        return res.status(500).json({ error: 'Failed to write settings' });
      }
      broadcast('late_plan_override_changed', { enabled: !!enabled, changedBy: actor.name });
      res.json({ success: true, settings });
    } catch (err) {
      console.error('[SETTINGS] Failed to toggle late plan override:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get settings
  app.get('/api/settings', async (req, res) => {
    try {
      const settings = await readSettings();
      res.json(settings);
    } catch (err) {
      console.error('[SETTINGS] Failed to read settings:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ============ EOD REPORTS ROUTE ============
  app.get("/api/reports/eod", async (req, res) => {
    try {
      const { date, startDate, endDate } = req.query;

      let targetDates: string[] = [];
      let rangeStart: string;
      let rangeEnd: string;

      if (startDate && endDate) {
        rangeStart = startDate as string;
        rangeEnd = endDate as string;
        const start = parseISO(rangeStart);
        const end = parseISO(rangeEnd);
        targetDates = eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'));
      } else if (date) {
        rangeStart = date as string;
        rangeEnd = date as string;
        targetDates = [date as string];
      } else {
        return res.status(400).json({ error: "Date or date range is required" });
      }

      const { getBatchLMSHours } = await import('./lmsSupabase');

      // Optimization: Batch fetch all required data in parallel
      const [
        allEmployees,
        flatEntries,
        flatSubs,
        batchLMS,
        batchPlanTasks
      ] = await Promise.all([
        storage.getEmployees(),
        storage.getTimeEntriesByDateRange(rangeStart, rangeEnd),
        storage.getDailySubmissionsByDateRange(rangeStart, rangeEnd),
        getBatchLMSHours(rangeStart, rangeEnd),
        storage.getBatchPlanTasksByDateRange(rangeStart, rangeEnd)
      ]);

      const parseDurationToMinutes = (duration: string): number => {
        if (!duration) return 0;
        const hMatch = duration.match(/(\d+)h/);
        const mMatch = duration.match(/(\d+)m/);
        const colonMatch = duration.match(/(\d+):(\d+)/);

        if (hMatch || mMatch) {
          const h = hMatch ? parseInt(hMatch[1], 10) : 0;
          const m = mMatch ? parseInt(mMatch[1], 10) : 0;
          return h * 60 + m;
        } else if (colonMatch) {
          return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
        }
        const digits = parseFloat(duration);
        if (!isNaN(digits)) return digits * 60;
        return 0;
      };

      const finalReport: any[] = [];

      for (const dStr of targetDates) {
        const dateEntries = flatEntries.filter(e => e.date === dStr);
        const dailySubs = flatSubs.filter(s => s.date === dStr);

        for (const emp of allEmployees) {
          if (emp.role === 'admin' && emp.employeeCode === 'ADMIN') continue;

          // Check batch LMS data
          const lmsData = batchLMS[emp.employeeCode]?.[dStr] || {
            leaveHours: 0,
            permissionHours: 0,
            odHours: 0,
            totalLMSHours: 0,
            details: { leaves: [], permissions: [] },
            odWindows: []
          };

          const hasLeave = lmsData.leaveHours >= 4;
          const isFullLeave = lmsData.leaveHours >= 8;
          const hasOD = (lmsData.odHours || 0) > 0;
          const isFullOD = (lmsData.odHours || 0) >= 8;

          // Check if final submitted
          const isFinalSubmitted = dailySubs.some(s => s.employeeId === emp.id);

          const empEntries = dateEntries.filter(e =>
            e.employeeId === emp.id ||
            (e.employeeCode && e.employeeCode.toUpperCase() === emp.employeeCode.toUpperCase())
          );

          // Get planned projects from batchPlanTasks
          let plannedProjects: string[] = [];
          if (empEntries.length === 0) {
            const empPlanTasks = batchPlanTasks.filter(pt =>
              pt.daily_plans.employeeId === emp.id &&
              pt.daily_plans.date === dStr
            );
            plannedProjects = Array.from(new Set(empPlanTasks.map(pt => pt.plan_tasks.projectName)));
          }

          const totalMinutes = empEntries.reduce((sum, entry) => sum + parseDurationToMinutes(entry.totalHours), 0);
          const totalHours = totalMinutes / 60;

          const isSunday = parseISO(dStr).getDay() === 0;

          let status = "Not Submitted";
          if (isFinalSubmitted) {
            status = "Submitted";
          } else if (isFullLeave) {
            status = "On Leave";
          } else if (isFullOD) {
            // Full Day approved OD — treated like On Leave, not a missed submission.
            status = "On OD";
          } else if (empEntries.length > 0) {
            status = "Incomplete";
          } else if (hasLeave) {
            status = "On Leave";
          } else if (hasOD) {
            // Partial-day OD (Half Day / Hourly) — not yet submitted, but the
            // OD duration itself is a valid exemption rather than "missing".
            status = "On OD";
          } else if (isSunday) {
            status = "Sunday";
          }

          let remark = "";
          if (status === "Submitted") remark = "Final timesheet submitted.";
          else if (status === "Sunday") remark = "Weekly Holiday (Sunday).";
          else if (status === "On Leave") remark = `Employee on approved leave (${lmsData.leaveHours}h).`;
          else if (status === "Incomplete") remark = `Draft entries exist (${totalHours.toFixed(1)}h), but final submission missing.`;
          else remark = "No timesheet entries or leave found.";

          finalReport.push({
            employeeId: emp.id,
            employeeName: emp.name,
            employeeCode: emp.employeeCode,
            email: emp.email || "N/A",
            department: emp.department || "N/A",
            date: dStr,
            status,
            workingHours: totalHours.toFixed(1),
            lmsHours: (lmsData.totalLMSHours || 0).toFixed(1),
            requiredHours: 8,
            remark,
            entries: empEntries,
            plannedProjects
          });
        }
      }

      res.json(finalReport);
    } catch (error) {
      console.error("EOD Report error:", error);
      res.status(500).json({ error: "Failed to fetch EOD report" });
    }
  });

  // ============ ALERTS ROUTES ============
  app.get("/api/alerts/:employeeId", async (req, res) => {
    try {
      const alerts = await storage.getAlertsByEmployee(req.params.employeeId);
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.post("/api/alerts/:id/read", async (req, res) => {
    try {
      await storage.markAlertAsRead(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark alert as read" });
    }
  });

  // ============ RAG CHAT & SYNC ROUTES ============
  app.post("/api/rag/chat", async (req, res) => {
    const { message, history, employeeId, employeeCode, role, department, lmsUserId } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      // Resolve employeeName from body, auth context, or database query
      let employeeName = req.body.employeeName || (req as any).user?.name || (req as any).user?.employeeName || "";
      if (!employeeName && employeeId) {
        const emp = await storage.getEmployee(employeeId);
        if (emp) {
          employeeName = emp.name || "";
        }
      }

      const { runCoordinator } = await import("./rag/coordinator");
      const u = (req as any).user || {};
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      await runCoordinator({
        message,
        userContext: {
          employeeId: u.employeeId || employeeId,
          employeeCode: u.employeeCode || employeeCode,
          role: u.role || role,
          department: u.department || department,
          lmsUserId: req.body.lmsUserId || u.employeeCode || employeeCode,
          employeeName: u.name || u.employeeName || req.body.employeeName || employeeName || "",
          baseUrl,
        },
        history: history || [],
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
      });
    } catch (err: any) {
      console.error("RAG chat error:", err);
      res.write(`data: ${JSON.stringify({ type: "text", content: `\n⚠️ Error processing chat: ${err.message}` })}\n\n`);
    } finally {
      res.end();
    }
  });

  // ── Route 1: Save or update a chat session ──────────────────
  app.post("/api/chat-sessions", async (req, res) => {
    try {
      const { employeeId, sessionId, title, messages } = req.body;
      if (!employeeId) return res.status(400).json({ error: "employeeId required" });

      if (sessionId) {
        // Update existing session
        const updateTitle = title || (messages?.[0]?.content?.slice(0, 60) + "...") || "Chat";
        await pool.query(
          `UPDATE chat_sessions 
           SET messages = $1, title = COALESCE(NULLIF($2,''), title), updated_at = NOW()
           WHERE id = $3 AND employee_id = $4`,
          [JSON.stringify(messages || []), updateTitle, sessionId, employeeId]
        );
        return res.json({ success: true, sessionId });
      } else {
        // Create new session
        const autoTitle = messages?.[0]?.content?.slice(0, 60) || "New Chat";
        const result = await pool.query(
          `INSERT INTO chat_sessions (employee_id, title, messages)
           VALUES ($1, $2, $3) RETURNING id`,
          [employeeId, autoTitle, JSON.stringify(messages || [])]
        );
        return res.json({ success: true, sessionId: result.rows[0].id });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Route 2: Get all chat sessions for an employee ──────────
  app.get("/api/chat-sessions/:employeeId", async (req, res) => {
    try {
      const { employeeId } = req.params;
      const result = await pool.query(
        `SELECT id, title, created_at, updated_at,
                LEFT(messages::text, 200) as preview
         FROM chat_sessions
         WHERE employee_id = $1
         ORDER BY updated_at DESC
         LIMIT 50`,
        [employeeId]
      );
      res.json({ sessions: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Route 3: Get a single chat session with full messages ────
  app.get("/api/chat-sessions/:employeeId/:sessionId", async (req, res) => {
    try {
      const { employeeId, sessionId } = req.params;
      const result = await pool.query(
        `SELECT id, title, messages, created_at, updated_at
         FROM chat_sessions
         WHERE id = $1 AND employee_id = $2`,
        [sessionId, employeeId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Route 4: Delete a chat session ──────────────────────────
  app.delete("/api/chat-sessions/:employeeId/:sessionId", async (req, res) => {
    try {
      const { employeeId, sessionId } = req.params;
      await pool.query(
        `DELETE FROM chat_sessions WHERE id = $1 AND employee_id = $2`,
        [sessionId, employeeId]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rag/sync", async (req, res) => {
    try {
      const { syncDatabaseRecords } = await import("./rag/pipeline");
      await syncDatabaseRecords();
      res.json({ success: true, message: "Manual sync triggered successfully" });
    } catch (err: any) {
      console.error("RAG sync error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rag/webhook", async (req, res) => {
    try {
      const { table, record, type } = req.body;
      const { queueWebhookJob } = await import("./rag/pipeline");
      await queueWebhookJob(table, record, type);
      res.json({ success: true });
    } catch (err: any) {
      console.error("RAG webhook error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Action Proxy Routes for RAG
  // LMS
  app.get("/api/leaves/pending", async (req, res) => {
    try {
      const { lmsPool } = await import("./lmsSupabase");
      const result = await lmsPool.query("SELECT * FROM leaves WHERE status ILIKE 'pending'");
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/leaves/:id/approve", async (req, res) => {
    try {
      const { lmsPool } = await import("./lmsSupabase");
      const result = await lmsPool.query("UPDATE leaves SET status = 'Approved' WHERE id = $1 RETURNING *", [req.params.id]);
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/leaves/:id/reject", async (req, res) => {
    try {
      const { lmsPool } = await import("./lmsSupabase");
      const result = await lmsPool.query("UPDATE leaves SET status = 'Rejected' WHERE id = $1 RETURNING *", [req.params.id]);
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PMS
  app.patch("/api/tasks/:id/complete", async (req, res) => {
    try {
      const { pmsPool } = await import("./pmsSupabase");
      const result = await pmsPool.query("UPDATE project_tasks SET status = 'Completed', progress = 100, updated_at = NOW() WHERE id = $1::uuid RETURNING *", [req.params.id]);
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/tasks/:id/assign", async (req, res) => {
    try {
      const { employeeCode } = req.body;
      const { pmsPool } = await import("./pmsSupabase");
      const result = await pmsPool.query("UPDATE project_tasks SET assignee = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING *", [req.params.id, employeeCode]);
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/tasks/:id/deadline", async (req, res) => {
    try {
      const { deadline } = req.body;
      const { pmsPool } = await import("./pmsSupabase");
      const result = await pmsPool.query("UPDATE project_tasks SET end_date = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING *", [req.params.id, deadline]);
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Timestrap Approve/Reject
  app.patch("/api/timesheets/:id/approve", async (req, res) => {
    try {
      const { approvedBy } = req.body;
      const entry = await storage.adminApproveTimeEntry(req.params.id, approvedBy);
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/timesheets/:id/reject", async (req, res) => {
    try {
      const { approvedBy } = req.body;
      const entry = await storage.updateTimeEntryStatus(req.params.id, "rejected", approvedBy, "Rejected by AI Assistant");
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans", async (req, res) => {
    try {
      const { employeeId, date, tasks } = req.body;
      const plan = await storage.createDailyPlan({ employeeId, date });
      for (const t of tasks) {
        await storage.createPlanTask({
          planId: plan.id,
          taskId: t.taskId,
          projectName: t.projectName,
          taskName: t.taskName,
          isDeviation: false,
          deviationReason: null,
          status: "approved"
        });
      }
      res.status(201).json({ success: true, plan });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}