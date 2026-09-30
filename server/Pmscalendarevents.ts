// server/pmsCalendarEvents.ts
//
// Reads/writes PMS's `calendar_events` and `google_calendar_accounts` tables
// directly over Postgres (reusing the existing pmsPool connection — same
// approach already used elsewhere in this codebase for projects/tasks).
//
// IDENTITY: PMS's calendar_events.user_id is a foreign key into PMS's OWN
// `users` table (a UUID from PMS's login system) — it is NOT the same as
// Timestrap's own user id. The two apps share identity only through employee
// code:
//   Timestrap `employeeCode`  ==  PMS `employees.emp_code`
//   PMS `users.employee_id`   ->  PMS `employees.id`
// Every function here takes an `employeeCode` and resolves the real PMS
// `users.id` first. If no PMS user account exists for that employee code,
// these functions no-op / return empty rather than writing a user_id that
// doesn't exist in PMS (which would violate PMS's own FK constraint).
//
// SCOPE: two kinds of rows share this table, distinguished by calendar_type:
//   - 'meeting' = "manual" events created directly on the Calendar page
//   - 'task'    = plan-for-the-day tasks (written on plan submission, and
//                 kept in sync on edit/drag/delete from the Calendar page)
// Both are one shared source of truth — PMS's own calendar UI and
// Timestrap's Calendar page both read/write the same rows.
//
// KNOWN GAP: because we write to PMS's DB directly instead of going through
// PMS's own Express routes, PMS's automatic "push new/changed event to
// Google" logic (which lives inside those route handlers) does NOT fire for
// events created here. Google sync for these events will only happen once
// PMS's own sync mechanism (manual "Sync now" on the PMS side, or a future
// poller) picks them up.

import { pmsPool } from "./pmsSupabase";
import crypto from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PmsCalendarEvent {
  id: string;
  userId: string;
  title: string;
  project: string; // maps to project_title
  projectId?: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  colorIdx: number;
  googleEventId?: string | null;
  source: "manual" | "plan";
  pmsId?: string; // task_id, present for 'task' rows
  description?: string;
  location?: string;
  videoLink?: string;
  allDay?: boolean;
  calendarType?: string;
  repeat?: string;
  reminders?: number[];
  visibility?: string;
  busy?: boolean;
  guestsCanModify?: boolean;
  guestsCanInvite?: boolean;
  guestsCanSeeGuestList?: boolean;
  guests?: any[];
}

async function getCalendarEventColumns(): Promise<Set<string>> {
  const result = await pmsPool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    ["calendar_events"]
  );
  return new Set(result.rows.map((row: any) => String(row.column_name)));
}

function parseReminders(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  }
  if (typeof value === "string") {
    const parsed = value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
    return parsed.length > 0 ? parsed : undefined;
  }
  return undefined;
}

function normalizeVisibility(value: unknown): PmsCalendarEvent["visibility"] {
  if (value === "public" || value === "private") return value;
  return "default";
}

function normalizeBusy(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "false") return false;
    if (normalized === "true") return true;
  }
  return undefined;
}

function parseMetadata(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as Record<string, any>;
  }
  return {};
}

export function buildCalendarEventMetadata(evt: Partial<PmsCalendarEvent> = {}) {
  return {
    description: evt.description ?? "",
    location: evt.location ?? "",
    videoLink: evt.videoLink ?? "",
    allDay: !!evt.allDay,
    calendarType: evt.calendarType || "meeting",
    repeat: evt.repeat || "none",
    reminders: evt.reminders ?? [30],
    visibility: evt.visibility || "default",
    busy: evt.busy !== false,
  };
}

export function serializeCalendarEventDbValues(evt: Partial<PmsCalendarEvent> = {}, includeDefaults: boolean = true) {
  const payload: Record<string, any> = {};
  const hasField = (fieldName: string) => includeDefaults || Object.prototype.hasOwnProperty.call(evt, fieldName);

  if (hasField("description")) payload.description = evt.description ?? "";
  if (hasField("location")) payload.location = evt.location ?? "";
  if (hasField("videoLink")) payload.video_link = evt.videoLink ?? "";
  if (hasField("allDay")) payload.all_day = evt.allDay ?? false;
  if (hasField("calendarType")) payload.calendar_type = evt.calendarType || "meeting";
  if (hasField("repeat")) payload.repeat = evt.repeat || "none";
  if (hasField("reminders")) payload.reminders = JSON.stringify(Array.isArray(evt.reminders) ? evt.reminders : (evt.reminders ? [evt.reminders] : []));
  if (hasField("visibility")) payload.visibility = evt.visibility || "default";
  if (hasField("busy")) payload.busy = evt.busy !== false;
  if (hasField("guestsCanModify")) payload.guests_can_modify = !!evt.guestsCanModify;
  if (hasField("guestsCanInvite")) payload.guests_can_invite = evt.guestsCanInvite !== false;
  if (hasField("guestsCanSeeGuestList")) payload.guests_can_see_guest_list = evt.guestsCanSeeGuestList !== false;
  if (hasField("guests")) payload.guests = JSON.stringify(Array.isArray(evt.guests) ? evt.guests : []);
  if (hasField("projectId") && (evt as any).projectId) payload.project_id = (evt as any).projectId;
  if (hasField("taskId") && (evt as any).taskId) payload.task_id = (evt as any).taskId;

  payload.metadata = buildCalendarEventMetadata(evt);
  return payload;
}

async function buildInsertPayload(evt: Partial<PmsCalendarEvent> = {}) {
  const columns = await getCalendarEventColumns();
  const payload = serializeCalendarEventDbValues(evt, true);
  const values: Record<string, any> = {};

  const allowedColumns = [
    "description", "location", "video_link", "all_day", "calendar_type",
    "repeat", "reminders", "visibility", "busy", "guests_can_modify",
    "guests_can_invite", "guests_can_see_guest_list", "guests", "project_id", "task_id"
  ];

  for (const col of allowedColumns) {
    if (columns.has(col) && Object.prototype.hasOwnProperty.call(payload, col)) {
      values[col] = payload[col];
    }
  }

  // Strip non-UUID project_id / task_id — PMS's columns are real uuid types
  if (values.project_id && !UUID_RE.test(values.project_id)) delete values.project_id;
  if (values.task_id && !UUID_RE.test(values.task_id)) values.task_id = toTaskUuid(values.task_id);

  if (columns.has("metadata") && Object.prototype.hasOwnProperty.call(payload, "metadata")) values.metadata = payload.metadata;
  if (columns.has("event_metadata") && Object.prototype.hasOwnProperty.call(payload, "metadata")) values.event_metadata = payload.metadata;
  return values;
}

async function buildUpdatePayload(evt: Partial<PmsCalendarEvent> = {}) {
  const columns = await getCalendarEventColumns();
  const payload = serializeCalendarEventDbValues(evt, false);
  const values: Record<string, any> = {};

  const allowedColumns = [
    "description", "location", "video_link", "all_day", "calendar_type",
    "repeat", "reminders", "visibility", "busy", "guests_can_modify",
    "guests_can_invite", "guests_can_see_guest_list", "guests", "project_id", "task_id"
  ];

  for (const col of allowedColumns) {
    if (columns.has(col) && Object.prototype.hasOwnProperty.call(payload, col)) {
      values[col] = payload[col];
    }
  }

  // Strip non-UUID project_id / task_id — PMS's columns are real uuid types
  if (values.project_id && !UUID_RE.test(values.project_id)) delete values.project_id;
  if (values.task_id && !UUID_RE.test(values.task_id)) values.task_id = toTaskUuid(values.task_id);

  if (columns.has("metadata") && Object.prototype.hasOwnProperty.call(payload, "metadata")) values.metadata = payload.metadata;
  if (columns.has("event_metadata") && Object.prototype.hasOwnProperty.call(payload, "metadata")) values.event_metadata = payload.metadata;
  return values;
}

async function getCalendarEventSelectColumns(): Promise<string[]> {
  const columns = await getCalendarEventColumns();
  const selectColumns = [
    "id",
    "user_id",
    "title",
    "project_title",
    "date",
    "end_date",
    "start_time",
    "end_time",
    "color_key",
    "google_event_id",
    "calendar_type",
    "task_id",
  ];
  if (columns.has("project_id")) selectColumns.push("project_id");
  if (columns.has("description")) selectColumns.push("description");
  if (columns.has("location")) selectColumns.push("location");
  if (columns.has("video_link")) selectColumns.push("video_link");
  if (columns.has("all_day")) selectColumns.push("all_day");
  if (columns.has("repeat")) selectColumns.push("repeat");
  if (columns.has("reminders")) selectColumns.push("reminders");
  if (columns.has("visibility")) selectColumns.push("visibility");
  if (columns.has("busy")) selectColumns.push("busy");
  if (columns.has("guests_can_modify")) selectColumns.push("guests_can_modify");
  if (columns.has("guests_can_invite")) selectColumns.push("guests_can_invite");
  if (columns.has("guests_can_see_guest_list")) selectColumns.push("guests_can_see_guest_list");
  if (columns.has("guests")) selectColumns.push("guests");
  if (columns.has("metadata")) selectColumns.push("metadata");
  if (columns.has("event_metadata")) selectColumns.push("event_metadata");
  return selectColumns;
}

// PMS's calendar_events.task_id column is a real Postgres `uuid`. Plan-for-Day
// "pseudo tasks" — the built-in Morning Break / Lunch / Evening Break slots —
// use non-UUID string ids ("break-morning", "break-lunch", "break-evening"),
// which Postgres rejects outright with "invalid input syntax for type uuid".
// Deterministically derive a stable UUID (v5-style, SHA-1 based) from any
// non-UUID id so the same pseudo task always maps to the same PMS row across
// edits/refreshes, without needing to change PMS's column type.
export function toTaskUuid(taskId: string): string {
  if (UUID_RE.test(taskId)) return taskId;
  const hash = crypto.createHash("sha1").update(`timestrap-plan-task:${taskId}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function resolvePmsUserId(employeeCode: string): Promise<string | null> {
  if (!employeeCode) return null;
  try {
    // Use a 5-second timeout so test/unknown employees don't hang the request
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    const queryPromise = pmsPool.query(
      `SELECT u.id FROM users u JOIN employees e ON u.employee_id = e.id WHERE e.emp_code = $1 LIMIT 1`,
      [employeeCode]
    ).then((result: any) => result.rows[0]?.id || null);
    const result = await Promise.race([queryPromise, timeoutPromise]);
    return result;
  } catch (err) {
    console.warn(`[PMS] resolvePmsUserId failed for ${employeeCode}:`, err);
    return null;
  }
}

// PMS's color_key column is a free-text string (e.g. "peacock"). Timestrap's
// UI only needs a numeric palette index, so we round-trip it as a plain
// string in that column rather than adding a new column to PMS's table.
const colorIdxToColorKey = (idx: number) => String(idx ?? 0);
const colorKeyToColorIdx = (key: string | null) => {
  const n = Number(key);
  return Number.isFinite(n) ? n : 0;
};

function mapRow(row: any): PmsCalendarEvent {
  const metadata = parseMetadata(row.metadata || row.event_metadata);
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    project: row.project_title || "",
    projectId: row.project_id || undefined,
    date: row.date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    colorIdx: colorKeyToColorIdx(row.color_key),
    googleEventId: row.google_event_id,
    source: row.calendar_type === "task" ? "plan" : "manual",
    pmsId: row.task_id || undefined,
    description: row.description ?? metadata.description ?? "",
    location: row.location ?? metadata.location ?? "",
    videoLink: row.video_link ?? row.videoLink ?? metadata.videoLink ?? "",
    allDay: typeof row.all_day === "boolean" ? row.all_day : !!metadata.allDay,
    // row.calendar_type is the source discriminator ('meeting' vs 'task'),
    // not the display TYPE label — read the label from metadata instead
    // (see notes in createCalendarEvent/updateCalendarEvent). Plan/task rows
    // don't have a user-picked label, so they always display as "task".
    calendarType: row.calendar_type === "task" ? "task" : (row.calendar_type && row.calendar_type !== 'meeting' ? row.calendar_type : (metadata.calendarType || "meeting")),
    repeat: row.repeat ?? metadata.repeat ?? "none",
    reminders: parseReminders(row.reminders) ?? (Array.isArray(metadata.reminders) ? metadata.reminders : [30]),
    visibility: normalizeVisibility(row.visibility ?? metadata.visibility),
    busy: normalizeBusy(row.busy ?? metadata.busy) ?? true,
    guestsCanModify: typeof row.guests_can_modify === "boolean" ? row.guests_can_modify : false,
    guestsCanInvite: typeof row.guests_can_invite === "boolean" ? row.guests_can_invite : true,
    guestsCanSeeGuestList: typeof row.guests_can_see_guest_list === "boolean" ? row.guests_can_see_guest_list : true,
    guests: (typeof row.guests === 'string' ? JSON.parse(row.guests) : row.guests) || [],
  };
}

// Returns BOTH manual ('meeting') and plan ('task') rows for the day — this
// is the single shared read path both calendar UIs should use.
export async function getCalendarEvents(employeeCode: string, date?: string): Promise<PmsCalendarEvent[]> {
  console.log(`[PMS EVENT SYNC] getCalendarEvents called for employee: ${employeeCode}, date: ${date}`);
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) {
    console.log(`[PMS EVENT SYNC] getCalendarEvents Aborted: Could not resolve PMS user ID for employeeCode ${employeeCode}`);
    return [];
  }

  const selectColumns = await getCalendarEventSelectColumns();
  const params: any[] = [pmsUserId];
  let query = `
    SELECT ${selectColumns.join(", ")}
    FROM calendar_events
    WHERE user_id = $1 AND source = 'app'
  `;
  if (date) {
    params.push(date);
    query += ` AND date = $2`;
  }
  query += ` ORDER BY start_time ASC`;

  const result = await pmsPool.query(query, params);
  console.log(`[PMS EVENT SYNC] getCalendarEvents fetched ${result.rows.length} rows for employee ${employeeCode}`);
  return result.rows.map(mapRow);
}

export async function createCalendarEvent(employeeCode: string, evt: {
  title: string;
  project?: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  colorIdx?: number;
  description?: string;
  location?: string;
  videoLink?: string;
  allDay?: boolean;
  calendarType?: string;
  repeat?: string;
  reminders?: number[];
  visibility?: string;
  busy?: boolean;
}): Promise<PmsCalendarEvent | null> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return null;

  const selectColumns = await getCalendarEventSelectColumns();
  const extraPayload = await buildInsertPayload(evt as any);
  const insertColumns = [
    "user_id",
    "title",
    "project_title",
    "date",
    "end_date",
    "start_time",
    "end_time",
    "color_key",
    "source",
  ];
  const insertValues: any[] = [
    pmsUserId,
    evt.title || "Untitled event",
    evt.project || null,
    evt.date,
    evt.endDate || evt.date,
    evt.startTime,
    evt.endTime,
    colorIdxToColorKey(evt.colorIdx ?? 0),
    "app",
  ];
  const columnNames: string[] = [...insertColumns];
  const placeholders: string[] = insertColumns.map((_, index) => `$${index + 1}`);

  Object.entries(extraPayload).forEach(([columnName, value]) => {
    columnNames.push(columnName);
    insertValues.push(value);
    placeholders.push(`$${insertValues.length}`);
  });

  const query = `
    INSERT INTO calendar_events
      (${columnNames.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING ${selectColumns.join(", ")}
  `;
  const result = await pmsPool.query(query, insertValues);
  return mapRow(result.rows[0]);
}

export async function updateCalendarEvent(id: string, employeeCode: string, evt: {
  title?: string;
  project?: string;
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  colorIdx?: number;
  description?: string;
  location?: string;
  videoLink?: string;
  allDay?: boolean;
  calendarType?: string;
  repeat?: string;
  reminders?: number[];
  visibility?: string;
  busy?: boolean;
}): Promise<PmsCalendarEvent | null> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return null;

  const selectColumns = await getCalendarEventSelectColumns();
  const extraPayload = await buildUpdatePayload(evt as any);
  const setClauses = [
    "title = COALESCE($3, title)",
    "project_title = COALESCE($4, project_title)",
    "date = COALESCE($5, date)",
    "end_date = COALESCE($6, end_date)",
    "start_time = COALESCE($7, start_time)",
    "end_time = COALESCE($8, end_time)",
    "color_key = COALESCE($9, color_key)",
  ];
  const values: any[] = [
    id,
    pmsUserId,
    evt.title ?? null,
    evt.project ?? null,
    evt.date ?? null,
    evt.endDate ?? null,
    evt.startTime ?? null,
    evt.endTime ?? null,
    evt.colorIdx !== undefined ? colorIdxToColorKey(evt.colorIdx) : null,
  ];
  const columnAssignments: string[] = [...setClauses];
  // Deliberately NOT touching calendar_type here. It's the row's SOURCE
  // discriminator ('meeting' vs 'task'), not the user-facing TYPE label —
  // see the matching note in createCalendarEvent. The WHERE clause below
  // already requires calendar_type = 'meeting', so leaving it untouched is
  // correct; the TYPE label update flows through metadata.calendarType via
  // extraPayload instead.

  Object.entries(extraPayload).forEach(([columnName, value]) => {
    columnAssignments.push(`${columnName} = $${values.length + 1}`);
    values.push(value);
  });

  const query = `
    UPDATE calendar_events
    SET
      ${columnAssignments.join(",\n      ")}
    WHERE id = $1 AND user_id = $2 AND source = 'app'
    RETURNING ${selectColumns.join(", ")}
  `;
  const result = await pmsPool.query(query, values);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function deleteCalendarEvent(id: string, employeeCode: string): Promise<boolean> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return false;

  const result = await pmsPool.query(
    `DELETE FROM calendar_events WHERE id = $1 AND user_id = $2 AND source = 'app' RETURNING id`,
    [id, pmsUserId]
  );
  return result.rows.length > 0;
}

// ─── Plan-for-the-day events ────────────────────────────────────────────────
// Written on plan submission (POST /api/daily-plans), and kept in sync when
// a plan task is edited/dragged/deleted on the Calendar page. Matched on
// task_id so re-saving updates the same row instead of duplicating it.

export async function upsertPlanCalendarEvent(
  employeeCode: string,
  evt: Partial<PmsCalendarEvent> & { taskId: string },
  options: { matchBySlot?: boolean } = {}
): Promise<PmsCalendarEvent | null> {
  console.log(`[PMS EVENT SYNC] Called upsertPlanCalendarEvent for employee: ${employeeCode}, task: ${evt.taskId}`);
  if (!evt.taskId) {
    console.log(`[PMS EVENT SYNC] Aborted: No taskId provided.`);
    return null;
  }
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) {
    console.log(`[PMS EVENT SYNC] Aborted: Could not resolve PMS user ID for employeeCode ${employeeCode}`);
    return null;
  }
  console.log(`[PMS EVENT SYNC] Resolved PMS User ID: ${pmsUserId}`);

  const taskUuid = toTaskUuid(evt.taskId);
  const selectColumns = await getCalendarEventSelectColumns();

  // Two matching strategies:
  //  - task-only (default): used by the Calendar page's drag/edit-in-place
  //    sync, where a single task's event should be found and moved no
  //    matter what date/time it's dragged to.
  //  - slot (date + start_time): used on plan submission, where the SAME
  //    PMS task can legitimately appear on multiple days (recurring /
  //    mandatory tasks) or more than once in the same day's plan at
  //    different times. Matching on task_id alone in that case made every
  //    later occurrence overwrite the previous one, so only the last
  //    slot for a given task ever survived in PMS's calendar. Matching on
  //    task_id + date + start_time gives each occurrence its own row.
  const matchBySlot = !!options.matchBySlot;
  const existing = matchBySlot
    ? await pmsPool.query(
      `SELECT id FROM calendar_events WHERE user_id = $1 AND task_id = $2 AND date = $3 AND start_time = $4 AND calendar_type = 'task'`,
      [pmsUserId, taskUuid, evt.date ?? null, evt.startTime ?? null]
    )
    : await pmsPool.query(
      `SELECT id FROM calendar_events WHERE user_id = $1 AND task_id = $2 AND calendar_type = 'task'`,
      [pmsUserId, taskUuid]
    );

  // UUID regex for validating values before they hit UUID columns
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (existing.rows.length > 0) {
    const extraPayload = await buildUpdatePayload(evt);
    // task_id is handled separately via toTaskUuid — the raw evt.taskId
    // (e.g. "P-1777351314512") is NOT a valid UUID and must not leak through.
    delete extraPayload.task_id;
    // calendar_type is the source discriminator ('meeting' vs 'task'), not
    // the user-facing type label. Plan rows must stay 'task'.
    delete extraPayload.calendar_type;
    // Guard project_id: only pass it if it's a proper UUID
    if (extraPayload.project_id && !UUID_RE.test(extraPayload.project_id)) {
      delete extraPayload.project_id;
    }

    const setClauses = [
      "title = COALESCE($3, title)",
      "project_title = COALESCE($4, project_title)",
      "date = COALESCE($5, date)",
      "end_date = COALESCE($6, end_date)",
      "start_time = COALESCE($7, start_time)",
      "end_time = COALESCE($8, end_time)",
      "color_key = COALESCE($9, color_key)",
    ];
    const values: any[] = [
      existing.rows[0].id,
      pmsUserId,
      evt.title ?? null,
      evt.project ?? null,
      evt.date ?? null,
      evt.endDate ?? evt.date ?? null,
      evt.startTime ?? null,
      evt.endTime ?? null,
      evt.colorIdx !== undefined ? colorIdxToColorKey(evt.colorIdx) : null,
    ];
    const columnAssignments: string[] = [...setClauses];

    Object.entries(extraPayload).forEach(([columnName, value]) => {
      columnAssignments.push(`${columnName} = $${values.length + 1}`);
      values.push(value);
    });

    const query = `
      UPDATE calendar_events
      SET
        ${columnAssignments.join(",\n        ")}
      WHERE id = $1 AND user_id = $2 AND source = 'app'
      RETURNING ${selectColumns.join(", ")}
    `;
    console.log(`[PMS EVENT SYNC] Updating existing event ID: ${existing.rows[0].id}`);
    const result = await pmsPool.query(query, values);
    if (result.rows.length === 0) {
      console.log(`[PMS EVENT SYNC] Failed to update event ID: ${existing.rows[0].id}`);
      return null;
    }
    console.log(`[PMS EVENT SYNC] Successfully updated event ID: ${existing.rows[0].id}`);
    return mapRow(result.rows[0]);
  }

  const insertPayload = await buildInsertPayload(evt);
  // Force plan-specific values and sanitize UUID fields
  insertPayload.calendar_type = "task";
  insertPayload.task_id = taskUuid;
  // Guard project_id: only keep it if it's a proper UUID
  if (insertPayload.project_id && !UUID_RE.test(insertPayload.project_id)) {
    delete insertPayload.project_id;
  }

  const columnNames = ["user_id", "source", "title", "project_title", "date", "end_date", "start_time", "end_time", "color_key"];
  const insertValues: any[] = [
    pmsUserId,
    "app",
    evt.title || "Untitled task",
    evt.project || null,
    evt.date,
    evt.endDate || evt.date,
    evt.startTime,
    evt.endTime,
    colorIdxToColorKey(evt.colorIdx ?? 0),
  ];

  Object.entries(insertPayload).forEach(([columnName, value]) => {
    if (!columnNames.includes(columnName)) {
      columnNames.push(columnName);
      insertValues.push(value);
    }
  });

  const placeholders = insertValues.map((_, i) => `$${i + 1}`);
  const query = `
    INSERT INTO calendar_events
      (${columnNames.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING ${selectColumns.join(", ")}
  `;
  console.log(`[PMS EVENT SYNC] Inserting new event for task ${evt.taskId}`);
  const result = await pmsPool.query(query, insertValues);
  console.log(`[PMS EVENT SYNC] Successfully inserted event ID: ${result.rows[0].id}`);
  return mapRow(result.rows[0]);
}

export async function deletePlanCalendarEvent(employeeCode: string, taskId: string): Promise<void> {
  if (!taskId) return;
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return;

  await pmsPool.query(
    `DELETE FROM calendar_events WHERE user_id = $1 AND task_id = $2 AND calendar_type = 'task'`,
    [pmsUserId, toTaskUuid(taskId)]
  );
}

export interface PmsGoogleStatus {
  connected: boolean;
  googleEmail?: string;
  lastSyncedAt?: string | null;
}

export async function getGoogleStatus(employeeCode: string): Promise<PmsGoogleStatus> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return { connected: false };

  const result = await pmsPool.query(
    `SELECT google_email, last_synced_at FROM google_calendar_accounts WHERE user_id = $1`,
    [pmsUserId]
  );
  if (result.rows.length === 0) return { connected: false };
  const row = result.rows[0];
  return { connected: true, googleEmail: row.google_email, lastSyncedAt: row.last_synced_at };
}

export async function disconnectGoogle(employeeCode: string): Promise<void> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return;
  await pmsPool.query(`DELETE FROM google_calendar_accounts WHERE user_id = $1`, [pmsUserId]);
}