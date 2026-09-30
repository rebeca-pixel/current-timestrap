import { pool } from "../db";
import { pmsPool } from "../pmsSupabase";
import { lmsPool } from "../lmsSupabase";

// ── HELPERS ──────────────────────────────────────────────────────────────────

function getRiskLevel(score: number, thresholds: [number, number]): string {
  if (score >= thresholds[1]) return "HIGH";
  if (score >= thresholds[0]) return "MEDIUM";
  return "LOW";
}

function formatDate(d: any): string {
  if (!d) return "N/A";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d;
  }
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "N/A";
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  } catch {
    return "N/A";
  }
}

function daysDiff(date: string): number {
  const now = new Date();
  const target = new Date(date);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

// ── 1. PRODUCTIVITY SCORE ────────────────────────────────────────────────────

export async function getEmployeeProductivityScore(
  employeeCode: string,
  days: number = 30
): Promise<{
  score: number;
  taskCompletionAvg: number;
  hoursScore: number;
  riskLevel: string;
  trend: string;
}> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = startDate.toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];

  // Calculate actual calendar days in this month range up to today
  const actualDays = Math.max(1, Math.ceil((now.getTime() - startDate.getTime()) / 86400000) + 1);

  const res = await pool.query(
    `SELECT 
       COUNT(DISTINCT date) as days_worked,
       AVG(percentage_complete) as avg_completion,
       SUM(
         EXTRACT(HOUR FROM (end_time::time - start_time::time)) +
         EXTRACT(MINUTE FROM (end_time::time - start_time::time)) / 60.0
       ) as total_hours
     FROM time_entries
     WHERE LOWER(employee_code) = LOWER($1)
       AND date BETWEEN $2 AND $3`,
    [employeeCode, start, today]
  );

  const row = res.rows[0];
  const avgCompletion = Number(row?.avg_completion || 0);
  const totalHours = Number(row?.total_hours || 0);

  const expectedHours = actualDays * 0.7 * 8; // 70% of days are working days
  const hoursScore = Math.min(100, (totalHours / expectedHours) * 100);
  const score = Math.round((avgCompletion * 0.6) + (hoursScore * 0.4));

  // Trend — compare last 7 days vs previous 7 days
  const week1Start = new Date();
  week1Start.setDate(week1Start.getDate() - 7);
  const week2Start = new Date();
  week2Start.setDate(week2Start.getDate() - 14);

  const trendRes = await pool.query(
    `SELECT 
       AVG(CASE WHEN date >= $3 THEN percentage_complete END) as recent_avg,
       AVG(CASE WHEN date < $3 AND date >= $4 THEN percentage_complete END) as prev_avg
     FROM time_entries
     WHERE LOWER(employee_code) = LOWER($1)
       AND date BETWEEN $2 AND $5`,
    [
      employeeCode,
      week2Start.toISOString().split("T")[0],
      week1Start.toISOString().split("T")[0],
      week2Start.toISOString().split("T")[0],
      today,
    ]
  );

  const recentAvg = Number(trendRes.rows[0]?.recent_avg || 0);
  const prevAvg = Number(trendRes.rows[0]?.prev_avg || 0);
  const trend =
    recentAvg > prevAvg + 5
      ? "📈 Rising"
      : recentAvg < prevAvg - 5
      ? "📉 Falling"
      : "➡️ Stable";

  const riskLevel =
    score < 40 ? "HIGH" : score < 65 ? "MEDIUM" : score < 80 ? "LOW" : "ON TRACK";

  return {
    score,
    taskCompletionAvg: Math.round(avgCompletion),
    hoursScore: Math.round(hoursScore),
    riskLevel,
    trend,
  };
}

// ── 2. TASK DEADLINE RISK ────────────────────────────────────────────────────

export async function getTaskDeadlineRisks(employeeCode: string): Promise<
  {
    taskName: string;
    projectName: string;
    progress: number;
    dueDate: string;
    daysLeft: number;
    riskLevel: string;
  }[]
> {
  const res = await pmsPool.query(
    `SELECT pt.task_name, pt.progress, pt.end_date,
            p.title as project_name
     FROM project_tasks pt
     JOIN projects p ON pt.project_id = p.id
     JOIN task_members tm ON pt.id = tm.task_id
     JOIN employees e ON tm.employee_id = e.id
     WHERE LOWER(e.emp_code) = LOWER($1)
       AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
       AND pt.end_date IS NOT NULL
     ORDER BY pt.end_date ASC`,
    [employeeCode]
  );

  return res.rows
    .map((r) => {
      const daysLeft = daysDiff(r.end_date);
      const progress = Number(r.progress || 0);

      let riskLevel = "ON TRACK";
      if (progress < 30 && daysLeft <= 2) riskLevel = "HIGH";
      else if (progress < 50 && daysLeft <= 5) riskLevel = "MEDIUM";
      else if (progress < 70 && daysLeft <= 7) riskLevel = "LOW";

      return {
        taskName: r.task_name,
        projectName: r.project_name,
        progress,
        dueDate: formatDate(r.end_date),
        daysLeft,
        riskLevel,
      };
    })
    .filter((r) => r.daysLeft > 0 && r.riskLevel !== "ON TRACK");
}

// ── 3. ATTENDANCE RISK ───────────────────────────────────────────────────────

export async function getAttendanceRisk(employeeCode: string): Promise<{
  lateArrivals: number;
  riskLevel: string;
  message: string;
}> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const start = startOfMonth.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  // Count late arrivals from timesheet — entries where start_time > shift start
  // Using 9:30 as default shift start buffer (20 min grace = 9:50)
  // Protected with regex format matching to avoid casting errors
  const res = await pool.query(
    `SELECT COUNT(*) as late_count
     FROM time_entries
     WHERE LOWER(employee_code) = LOWER($1)
       AND date BETWEEN $2 AND $3
       AND start_time IS NOT NULL
       AND start_time ~ '^[0-9]{2}:[0-9]{2}'
       AND start_time::time > '09:50:00'`,
    [employeeCode, start, today]
  );

  const lateArrivals = Number(res.rows[0]?.late_count || 0);
  const riskLevel =
    lateArrivals >= 8 ? "HIGH" : lateArrivals >= 5 ? "MEDIUM" : lateArrivals >= 3 ? "LOW" : "ON TRACK";

  const message =
    riskLevel === "HIGH"
      ? `🔴 ${lateArrivals} late arrivals this month — salary deduction will apply retroactively`
      : riskLevel === "MEDIUM"
      ? `🟡 ${lateArrivals} late arrivals — approaching deduction threshold`
      : riskLevel === "LOW"
      ? `... ${lateArrivals} late arrivals — monitor closely`
      : `✅ Attendance on track`;

  return { lateArrivals, riskLevel, message };
}

// ── 4. PROJECT HEALTH SCORE ──────────────────────────────────────────────────

export async function getProjectHealthScore(projectCode: string): Promise<{
  projectName: string;
  progress: number;
  totalTasks: number;
  overdueTasks: number;
  overduePercent: number;
  riskLevel: string;
  grade: string;
}> {
  const today = new Date().toISOString().split("T")[0];

  const res = await pmsPool.query(
    `SELECT p.title, p.progress,
            COUNT(pt.id) as total_tasks,
            COUNT(CASE WHEN pt.end_date < $2 
                       AND (pt.status IS NULL OR LOWER(pt.status) != 'completed') 
                  THEN 1 END) as overdue_tasks
     FROM projects p
     LEFT JOIN project_tasks pt ON pt.project_id = p.id
     WHERE LOWER(p.project_code) = LOWER($1)
     GROUP BY p.id, p.title, p.progress`,
    [projectCode, today]
  );

  if (!res.rows[0]) throw new Error(`Project ${projectCode} not found`);

  const row = res.rows[0];
  const totalTasks = Number(row.total_tasks);
  const overdueTasks = Number(row.overdue_tasks);
  const overduePercent = totalTasks > 0 ? Math.round((overdueTasks / totalTasks) * 100) : 0;
  const progress = Number(row.progress || 0);

  let riskLevel = "HEALTHY";
  let grade = "A";

  if (overduePercent >= 50 || progress < 20) {
    riskLevel = "HIGH";
    grade = "C";
  } else if (overduePercent >= 30 || progress < 50) {
    riskLevel = "MEDIUM";
    grade = "B";
  } else if (overduePercent >= 10) {
    riskLevel = "LOW";
    grade = "B+";
  }

  return {
    projectName: row.title,
    progress,
    totalTasks,
    overdueTasks,
    overduePercent,
    riskLevel,
    grade,
  };
}

// ── 5. TEAM INSIGHTS ─────────────────────────────────────────────────────────

export async function getTeamInsights(): Promise<{
  overloaded: { name: string; code: string; overdueTasks: number }[];
  underloaded: { name: string; code: string; activeTasks: number }[];
  highRisk: { name: string; code: string; score: number }[];
}> {
  const today = new Date().toISOString().split("T")[0];

  // Overloaded — most overdue tasks
  const overdueRes = await pmsPool.query(
    `SELECT e.name, e.emp_code as code,
            COUNT(pt.id) as overdue_tasks
     FROM employees e
     JOIN task_members tm ON e.id = tm.employee_id
     JOIN project_tasks pt ON tm.task_id = pt.id
     WHERE pt.end_date < $1
       AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
     GROUP BY e.id, e.name, e.emp_code
     ORDER BY overdue_tasks DESC
     LIMIT 5`,
    [today]
  );

  // Underloaded — fewest active tasks
  // Fetches list of active employee codes from main database to verify active status (since is_active doesn't exist in PMS employees table)
  const activeEmpRes = await pool.query("SELECT employee_code FROM employees WHERE is_active = true");
  const activeCodes = activeEmpRes.rows.map(r => r.employee_code.toLowerCase());

  const underRes = await pmsPool.query(
    `SELECT e.name, e.emp_code as code,
            COUNT(pt.id) as active_tasks
     FROM employees e
     LEFT JOIN task_members tm ON e.id = tm.employee_id
     LEFT JOIN project_tasks pt ON tm.task_id = pt.id
       AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
     WHERE LOWER(e.emp_code) = ANY($1::text[])
     GROUP BY e.id, e.name, e.emp_code
     ORDER BY active_tasks ASC
     LIMIT 5`,
    [activeCodes]
  );

  // High risk employees — low productivity
  const empRes = await pool.query(
    `SELECT DISTINCT employee_code, employee_name
     FROM time_entries
     WHERE date::date >= (NOW() - INTERVAL '30 days')::date`
  );

  const highRisk = [];
  for (const emp of empRes.rows) {
    const perf = await getEmployeeProductivityScore(emp.employee_code, 30);
    if (perf.score < 50) {
      highRisk.push({
        name: emp.employee_name,
        code: emp.employee_code,
        score: perf.score,
      });
    }
  }

  return {
    overloaded: overdueRes.rows.map((r) => ({
      name: r.name,
      code: r.code,
      overdueTasks: Number(r.overdue_tasks),
    })),
    underloaded: underRes.rows.map((r) => ({
      name: r.name,
      code: r.code,
      activeTasks: Number(r.active_tasks),
    })),
    highRisk: highRisk.sort((a, b) => a.score - b.score),
  };
}
