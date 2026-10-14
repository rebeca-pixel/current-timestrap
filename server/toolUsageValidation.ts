import pkg from "pg";
const { Pool } = pkg;

/**
 * TimeGuard's tool-usage data lives in a SEPARATE Supabase/Postgres database
 * from TimeStrap's own tables — NOT the same database as `DATABASE_URL`
 * (see server/db.ts). This mirrors how PMS gets its own dedicated `pmsPool`
 * in server/pmsSupabase.ts, rather than reusing TimeStrap's main pool.
 */
const timeguardDatabaseUrl = process.env.TIMEGUARD_DATABASE_URL;

if (!timeguardDatabaseUrl) {
  console.error(
    "⚠️  TIMEGUARD_DATABASE_URL is not set — TimeGuard tool-usage validation will be skipped (fails open) until it is configured."
  );
}

export const timeguardPool = timeguardDatabaseUrl
  ? new Pool({
    connectionString: timeguardDatabaseUrl,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: {
      rejectUnauthorized: false,
    },
  })
  : null;

if (timeguardDatabaseUrl) {
  const maskedUrl = timeguardDatabaseUrl.replace(/:[^:@]+@/, ":****@");
  console.log(`🔌 TimeGuard Database initialized with host: ${maskedUrl.split("@")[1]?.split("/")[0] || "Unknown"}`);
}

/**
 * Read-only TimeGuard query used by the suggestion / activity-timeline features. If the TimeGuard database
 * is missing an expected table or column (Postgres 42P01 / 42703 — e.g. `employee_tool_usage` not created, or
 * TIMEGUARD_DATABASE_URL pointing at the wrong database) it returns "no rows" instead of throwing, so the
 * feature degrades to "nothing to suggest" rather than a 500 error. Any other error still propagates.
 */
const warnedMissing = new Set<string>();
async function tgQuery(sql: string, params: any[]): Promise<{ rows: any[]; rowCount: number | null }> {
  try {
    return await timeguardPool!.query(sql, params);
  } catch (err: any) {
    if (err?.code !== "42P01" && err?.code !== "42703") throw err;
    const key = String(err?.message);
    if (!warnedMissing.has(key)) {
      warnedMissing.add(key);
      console.warn(`⚠️  TimeGuard DB schema problem (${err.message}). Treating as "no data". Check that TIMEGUARD_DATABASE_URL points at the TimeGuard database.`);
    }
    return { rows: [], rowCount: 0 };
  }
}

/**
 * Validates the "Tools Used" selected on a timesheet entry against TimeGuard
 * Agent's actual tool-usage logs (table: employee_tool_usage).
 *
 * A tool is considered "actually used" if TimeGuard recorded a usage session
 * for that tool whose [start_time, end_time) window overlaps the timesheet
 * entry's [startTime, endTime) window on the given date, for that employee.
 *
 * Design notes / fail-safe behavior:
 * - Comparison is case-insensitive and trims whitespace, since TimeGuard's
 *   `tool_name` and the timesheet's free-text tool selections may differ in
 *   casing (e.g. "Photoshop" vs "photoshop").
 * - `date` + `startTime`/`endTime` on the timesheet are treated as IST
 *   (Asia/Kolkata, UTC+5:30) — matching how the rest of TimeStrap handles
 *   local times — and converted to UTC instants to compare against
 *   TimeGuard's `timestamptz` columns.
 * - If TimeGuard has ZERO usage rows at all for this employee on this date
 *   (e.g. agent wasn't running, employee was doing field/site work with no
 *   PC involved), validation is SKIPPED rather than blocking submission —
 *   otherwise this would incorrectly block legitimate work that TimeGuard
 *   simply has no visibility into. This preserves existing functionality
 *   for employees/scenarios TimeGuard doesn't cover.
 */

export interface ToolUsageValidationResult {
  valid: boolean;
  /** Tools the user selected that have no matching usage during the window. */
  invalidTools: string[];
  /** Tool names TimeGuard actually recorded during the window (for reference/debugging). */
  actuallyUsedTools: string[];
  /** True if we skipped validation because TimeGuard had no data at all for this employee/date. */
  skippedNoData: boolean;
  message?: string;
}

export function istDateTimeToUtcIso(date: string, time: string): string {
  // date: "YYYY-MM-DD", time: "HH:mm" (or "HH:mm:ss")
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  // Asia/Kolkata is a fixed UTC+5:30 offset (no DST), so this is safe.
  return new Date(`${date}T${normalizedTime}+05:30`).toISOString();
}

export async function validateToolUsage(
  employeeCode: string,
  date: string,
  startTime: string,
  endTime: string,
  toolsUsed: string[] | null | undefined
): Promise<ToolUsageValidationResult> {
  const requestedTools = (toolsUsed || []).map((t) => t.trim()).filter(Boolean);

  if (requestedTools.length === 0 || !employeeCode || !date || !startTime || !endTime) {
    // Nothing selected, or not enough info to validate — nothing to block.
    return { valid: true, invalidTools: [], actuallyUsedTools: [], skippedNoData: false };
  }

  if (!timeguardPool) {
    // TIMEGUARD_DATABASE_URL not configured — fail open rather than block
    // every submission because of a missing env var.
    return { valid: true, invalidTools: [], actuallyUsedTools: [], skippedNoData: true };
  }

  let entryStartUtc: string;
  let entryEndUtc: string;
  try {
    entryStartUtc = istDateTimeToUtcIso(date, startTime);
    entryEndUtc = istDateTimeToUtcIso(date, endTime);
  } catch {
    // If the date/time can't be parsed, don't block submission over it —
    // that's a separate validation concern handled elsewhere.
    return { valid: true, invalidTools: [], actuallyUsedTools: [], skippedNoData: false };
  }

  // First: does TimeGuard have ANY data for this employee on this date at all?
  // If not, we can't meaningfully validate — skip rather than block.
  const anyDataResult = await timeguardPool.query(
    `SELECT 1 FROM employee_tool_usage WHERE employee_code = $1 AND date = $2 LIMIT 1`,
    [employeeCode, date]
  );
  if (anyDataResult.rowCount === 0) {
    return { valid: true, invalidTools: [], actuallyUsedTools: [], skippedNoData: true };
  }

  // Tools actually used during a window overlapping the entry's time range.
  // Overlap condition: usage.start_time < entry.end AND usage.end_time > entry.start
  const usageResult = await timeguardPool.query(
    `SELECT DISTINCT tool_name
     FROM employee_tool_usage
     WHERE employee_code = $1
       AND start_time < $3::timestamptz
       AND end_time > $2::timestamptz`,
    [employeeCode, entryStartUtc, entryEndUtc]
  );

  const actuallyUsedTools: string[] = usageResult.rows.map((r: any) => r.tool_name);
  const actuallyUsedNormalized = new Set(actuallyUsedTools.map((t) => t.trim().toLowerCase()));

  const invalidTools = requestedTools.filter(
    (t) => !actuallyUsedNormalized.has(t.trim().toLowerCase())
  );

  if (invalidTools.length > 0) {
    return {
      valid: false,
      invalidTools,
      actuallyUsedTools,
      skippedNoData: false,
      message:
        invalidTools.length === 1
          ? `The selected tool "${invalidTools[0]}" was not used during the selected time period. Please select only the tools actually used.`
          : `The selected tools (${invalidTools.join(", ")}) were not used during the selected time period. Please select only the tools actually used.`,
    };
  }

  return { valid: true, invalidTools: [], actuallyUsedTools, skippedNoData: false };
}

export interface ToolActivitySummaryEntry {
  toolName: string;
  minutes: number;
}

export interface ToolActivitySummary {
  entries: ToolActivitySummaryEntry[];
  totalMinutes: number;
  /** True if TimeGuard has no data at all for this employee/date. */
  noData: boolean;
}

/**
 * Aggregates TimeGuard's actual tool-usage durations (clipped to the entry's
 * time window) for an employee/date/time-range — used to give the employee a
 * factual starting draft for Description/Achievements. This never invents
 * content; it only reports tool names and minutes TimeGuard actually logged,
 * so the employee still writes the narrative themselves.
 */
export async function getToolActivitySummary(
  employeeCode: string,
  date: string,
  startTime: string,
  endTime: string
): Promise<ToolActivitySummary> {
  if (!timeguardPool || !employeeCode || !date || !startTime || !endTime) {
    return { entries: [], totalMinutes: 0, noData: true };
  }

  let entryStartUtc: string;
  let entryEndUtc: string;
  try {
    entryStartUtc = istDateTimeToUtcIso(date, startTime);
    entryEndUtc = istDateTimeToUtcIso(date, endTime);
  } catch {
    return { entries: [], totalMinutes: 0, noData: true };
  }

  const result = await tgQuery(
    `SELECT tool_name,
            GREATEST(start_time, $2::timestamptz) AS clipped_start,
            LEAST(end_time, $3::timestamptz) AS clipped_end
     FROM employee_tool_usage
     WHERE employee_code = $1
       AND start_time < $3::timestamptz
       AND end_time > $2::timestamptz`,
    [employeeCode, entryStartUtc, entryEndUtc]
  );

  if (result.rowCount === 0) {
    return { entries: [], totalMinutes: 0, noData: true };
  }

  const minutesByTool = new Map<string, number>();
  for (const row of result.rows as any[]) {
    const mins = Math.max(
      0,
      (new Date(row.clipped_end).getTime() - new Date(row.clipped_start).getTime()) / 60000
    );
    const key = String(row.tool_name).trim();
    minutesByTool.set(key, (minutesByTool.get(key) || 0) + mins);
  }

  const entries = Array.from(minutesByTool.entries())
    .map(([toolName, minutes]) => ({ toolName, minutes: Math.round(minutes) }))
    .filter((e) => e.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  return {
    entries,
    totalMinutes: entries.reduce((sum, e) => sum + e.minutes, 0),
    noData: false,
  };
}

export interface ActivityLogEntry {
  activityType: string;
  appName: string;
  title: string;
  windowTitle: string;
  website: string;
  url: string;
  durationSeconds: number;
  productive: boolean;
}

/**
 * Pulls TimeGuard's raw activity_logs rows (window titles, URLs, app names —
 * NOT just "which app was open") for an employee/date/time-window. This is
 * the richer signal needed to infer what work was actually done, as opposed
 * to getToolActivitySummary()'s app-time totals.
 *
 * activity_logs.employee_id is a uuid, unlike employee_tool_usage's text
 * employee_code — so this first resolves employee_code -> employees.id via
 * TimeGuard's own `employees` table before querying activity_logs.
 *
 * Rows are filtered to activity_type IN ('app','website') (skips idle/away),
 * deduped/collapsed by (title/window_title/url), sorted by duration desc,
 * and capped so the AI prompt built from this stays small and cheap.
 */
export async function getActivityLogEntries(
  employeeCode: string,
  date: string,
  startTime: string,
  endTime: string,
  maxEntries = 40
): Promise<ActivityLogEntry[]> {
  if (!timeguardPool || !employeeCode || !date || !startTime || !endTime) {
    return [];
  }

  let entryStartUtc: string;
  let entryEndUtc: string;
  try {
    entryStartUtc = istDateTimeToUtcIso(date, startTime);
    entryEndUtc = istDateTimeToUtcIso(date, endTime);
  } catch {
    return [];
  }

  const employeeResult = await tgQuery(
    `SELECT id FROM employees WHERE UPPER(TRIM(employee_code)) = UPPER(TRIM($1)) LIMIT 1`,
    [employeeCode]
  );
  const employeeId = employeeResult.rows[0]?.id;
  if (!employeeId) {
    // No matching employee in TimeGuard's own employees table — nothing to fetch.
    return [];
  }

  const result = await tgQuery(
    `SELECT activity_type,
            COALESCE(app_name, '') AS app_name,
            COALESCE(title, '') AS title,
            COALESCE(window_title, '') AS window_title,
            COALESCE(website, '') AS website,
            COALESCE(url, '') AS url,
            COALESCE(productive, productivity, true) AS productive,
            GREATEST(
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(end_time, $3::timestamptz), $3::timestamptz)
                - GREATEST(start_time, $2::timestamptz)
              )),
              0
            ) AS clipped_duration_seconds
     FROM activity_logs
     WHERE employee_id = $1
       AND activity_type IN ('app', 'website')
       AND start_time < $3::timestamptz
       AND COALESCE(end_time, start_time + make_interval(secs => COALESCE(duration_seconds, 0))) > $2::timestamptz
     ORDER BY clipped_duration_seconds DESC
     LIMIT $4`,
    [employeeId, entryStartUtc, entryEndUtc, maxEntries]
  );

  // Collapse rows that share the same meaningful text (title/window_title/url)
  // so the same file/page opened multiple times isn't repeated in the prompt.
  const seen = new Map<string, ActivityLogEntry>();
  for (const row of result.rows as any[]) {
    const label = (row.window_title || row.title || row.url || row.website || row.app_name || "").trim();
    if (!label) continue;
    const key = `${row.app_name}::${label}`.toLowerCase();
    const durationSeconds = Math.round(Number(row.clipped_duration_seconds) || 0);
    const existing = seen.get(key);
    if (existing) {
      existing.durationSeconds += durationSeconds;
    } else {
      seen.set(key, {
        activityType: row.activity_type,
        appName: row.app_name,
        title: row.title,
        windowTitle: row.window_title,
        website: row.website,
        url: row.url,
        durationSeconds,
        productive: !!row.productive,
      });
    }
  }

  return Array.from(seen.values())
    .filter((e) => e.durationSeconds > 0)
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
}

export interface ActualWorkedToolEntry {
  /** "app" or "website" — mirrors activity_logs.activity_type */
  activityType: string;
  /** Application/Tool name (e.g. VS Code, Excel, Figma). For browser rows this is the browser (Chrome, Edge, Firefox…), since that's what activity_logs.app_name records for a browser tab. */
  appName: string;
  /**
   * Browser name. Populated whenever the row is recognizably a browser —
   * either activity_type === 'website', or activity_type === 'app' but
   * app_name matches a known browser (TimeGuard sometimes can't resolve a
   * specific site — e.g. a new-tab page or a chrome:// URL — and logs the
   * window as a plain 'app' row even though it's still browser activity).
   */
  browserName: string | null;
  /** Website URL/domain visited, whenever TimeGuard captured one — regardless of activity_type. */
  websiteUrl: string | null;
  /** Window/page title. */
  windowTitle: string;
  /** Activity start time, clipped to the Timestrap session window (ISO string). */
  startTime: string;
  /** Activity end time, clipped to the Timestrap session window (ISO string). */
  endTime: string;
  /** Duration in seconds, clipped to the Timestrap session window. */
  durationSeconds: number;
}

/** Known browser app names, matched case-insensitively as a substring of app_name. */
const KNOWN_BROWSER_APP_NAMES = [
  "chrome",
  "google chrome",
  "microsoft edge",
  "msedge",
  "edge",
  "firefox",
  "mozilla firefox",
  "brave",
  "opera",
  "safari",
  "vivaldi",
  "chromium",
];

function isBrowserAppName(appName: string | null | undefined): boolean {
  if (!appName) return false;
  const normalized = appName.trim().toLowerCase();
  return KNOWN_BROWSER_APP_NAMES.some((name) => normalized.includes(name));
}

/**
 * "Actual Worked Tools" — a read-only, un-collapsed, chronological pull of
 * every TimeGuard activity_logs row (app + website activity, i.e. the
 * activity/tool log) whose window overlaps the Timestrap entry's
 * [startTime, endTime) session, for the given employee/date.
 *
 * Unlike getActivityLogEntries() (which dedupes/collapses and caps rows for
 * a cheap AI prompt), this returns every individual activity row — one line
 * per app/website session actually recorded — since it's meant to be
 * displayed verbatim as the employee's complete work history for that
 * Timestrap session. No manual entry, no AI involved.
 */
export async function getActualWorkedTools(
  employeeCode: string,
  date: string,
  startTime: string,
  endTime: string,
  maxRows = 500
): Promise<ActualWorkedToolEntry[]> {
  if (!timeguardPool || !employeeCode || !date || !startTime || !endTime) {
    return [];
  }

  let entryStartUtc: string;
  let entryEndUtc: string;
  try {
    entryStartUtc = istDateTimeToUtcIso(date, startTime);
    entryEndUtc = istDateTimeToUtcIso(date, endTime);
  } catch {
    return [];
  }

  const employeeResult = await tgQuery(
    `SELECT id FROM employees WHERE UPPER(TRIM(employee_code)) = UPPER(TRIM($1)) LIMIT 1`,
    [employeeCode]
  );
  const employeeId = employeeResult.rows[0]?.id;
  if (!employeeId) {
    return [];
  }

  const result = await tgQuery(
    `SELECT activity_type,
            COALESCE(app_name, '') AS app_name,
            COALESCE(title, '') AS title,
            COALESCE(window_title, '') AS window_title,
            COALESCE(website, '') AS website,
            COALESCE(url, '') AS url,
            GREATEST(start_time, $2::timestamptz) AS clipped_start,
            LEAST(
              COALESCE(end_time, start_time + make_interval(secs => COALESCE(duration_seconds, 0))),
              $3::timestamptz
            ) AS clipped_end
     FROM activity_logs
     WHERE employee_id = $1
       AND activity_type IN ('app', 'website')
       AND start_time < $3::timestamptz
       AND COALESCE(end_time, start_time + make_interval(secs => COALESCE(duration_seconds, 0))) > $2::timestamptz
     ORDER BY start_time ASC
     LIMIT $4`,
    [employeeId, entryStartUtc, entryEndUtc, maxRows]
  );

  const entries: ActualWorkedToolEntry[] = [];
  for (const row of result.rows as any[]) {
    const start = new Date(row.clipped_start);
    const end = new Date(row.clipped_end);
    const durationSeconds = Math.round(Math.max(0, (end.getTime() - start.getTime()) / 1000));
    if (durationSeconds <= 0) continue;

    const isWebsite = row.activity_type === "website";
    // The query already selects website/url for every row — don't discard
    // that data just because a browser tab happened to be logged as a plain
    // 'app' row. Likewise, recognize known browser app names even without a
    // captured URL, so "Chrome" still shows up under Browser rather than
    // silently falling into a generic app bucket.
    const capturedUrl = row.url || row.website || null;
    const isRecognizedBrowser = isWebsite || isBrowserAppName(row.app_name);
    entries.push({
      activityType: row.activity_type,
      appName: row.app_name,
      browserName: isRecognizedBrowser ? (row.app_name || null) : null,
      websiteUrl: capturedUrl,
      windowTitle: row.window_title || row.title || "",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationSeconds,
    });
  }

  return entries;
}
/**
 * Self-check for the TimeGuard connection, used by GET /api/timeguard/diagnose.
 * Answers "why is the Activity Timeline / Suggest from TimeGuard empty?" by checking, step by step:
 * the connection, which of the expected tables exist, their column types, whether the employee exists
 * in TimeGuard's own `employees` table, and whether activity_logs has rows for that employee / window.
 * Returns metadata only (no window titles / URLs).
 */
export async function diagnoseTimeGuard(employeeCode: string, date?: string, startTime?: string, endTime?: string) {
  const report: Record<string, any> = { configured: !!timeguardPool, checks: {} as Record<string, any>, problems: [] as string[] };
  if (!timeguardPool) {
    report.problems.push("TIMEGUARD_DATABASE_URL is not set in .env, so no TimeGuard data can be read.");
    return report;
  }
  const run = async (name: string, sql: string, params: any[] = []) => {
    try {
      const r = await timeguardPool!.query(sql, params);
      report.checks[name] = r.rows;
      return r.rows as any[];
    } catch (err: any) {
      report.checks[name] = { error: err?.message, code: err?.code };
      return null;
    }
  };

  const who = await run("connection", `SELECT current_database() AS database, current_schema() AS schema, current_setting('TimeZone') AS session_timezone`);
  if (!who) {
    report.problems.push("Could not connect/query the TimeGuard database. Check TIMEGUARD_DATABASE_URL and network access.");
    return report;
  }

  const tables = (await run(
    "tables",
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_name IN ('employees','activity_logs','employee_tool_usage') ORDER BY table_name`
  )) || [];
  const have = new Set(tables.map((t: any) => t.table_name));
  for (const t of ["employees", "activity_logs"]) {
    if (!have.has(t)) report.problems.push(`Table "${t}" does not exist in this database — the Activity Timeline and Suggest need it. This URL probably points at the wrong database/schema.`);
  }
  if (!have.has("employee_tool_usage")) {
    report.problems.push(`Table "employee_tool_usage" does not exist (only needed for Tool Validation).`);
  }

  await run(
    "activity_logs_columns",
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'activity_logs' ORDER BY ordinal_position`
  );
  await run(
    "employees_columns",
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'employees' ORDER BY ordinal_position`
  );

  if (!have.has("employees") || !have.has("activity_logs")) return report;

  const emp = await run(
    "employee_lookup",
    `SELECT id FROM employees WHERE UPPER(TRIM(employee_code)) = UPPER(TRIM($1)) LIMIT 1`,
    [employeeCode]
  );
  const employeeId = emp?.[0]?.id;
  if (!employeeId) {
    report.problems.push(`Employee code "${employeeCode}" was not found in TimeGuard's employees table (matched on employee_code), so no activity can be linked to this user.`);
    return report;
  }

  const range = await run(
    "activity_logs_for_employee",
    `SELECT COUNT(*)::int AS rows, MIN(start_time)::text AS earliest, MAX(start_time)::text AS latest
     FROM activity_logs WHERE employee_id = $1`,
    [employeeId]
  );
  if (range?.[0]?.rows === 0) {
    report.problems.push("activity_logs has no rows at all for this employee. Is the TimeGuard agent running/syncing for them?");
    return report;
  }

  if (date) {
    await run(
      "activity_logs_by_type_near_date",
      `SELECT activity_type, COUNT(*)::int AS rows, MIN(start_time)::text AS earliest, MAX(start_time)::text AS latest
       FROM activity_logs
       WHERE employee_id = $1
         AND start_time >= ($2::date - interval '1 day') AND start_time < ($2::date + interval '2 day')
       GROUP BY activity_type ORDER BY rows DESC`,
      [employeeId, date]
    );
  }
  if (date && startTime && endTime) {
    let s: string, e: string;
    try {
      s = istDateTimeToUtcIso(date, startTime);
      e = istDateTimeToUtcIso(date, endTime);
      report.window_utc = { start: s, end: e };
      const inWindow = await run(
        "activity_logs_in_window",
        `SELECT COUNT(*)::int AS rows FROM activity_logs
         WHERE employee_id = $1 AND activity_type IN ('app','website')
           AND start_time < $3::timestamptz
           AND COALESCE(end_time, start_time + make_interval(secs => COALESCE(duration_seconds, 0))) > $2::timestamptz`,
        [employeeId, s, e]
      );
      if (inWindow?.[0]?.rows === 0) {
        report.problems.push("No 'app'/'website' rows overlap this entry's start–end window. Compare window_utc with the earliest/latest times above: a ~5h30m shift means start_time is stored as local (IST) time without a time zone; otherwise the agent simply logged nothing in that window.");
      }
    } catch {
      report.problems.push("Could not parse date/startTime/endTime.");
    }
  }
  if (report.problems.length === 0) report.problems.push("No problems found: TimeGuard returns rows for this employee/window.");
  return report;
}
