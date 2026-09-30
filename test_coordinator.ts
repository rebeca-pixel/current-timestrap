process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import { pool } from "./server/db";
import { lmsPool } from "./server/lmsSupabase";
import { pmsPool } from "./server/pmsSupabase";
import { runCoordinator } from "./server/rag/coordinator";

async function runSQL(name: string, poolObj: any, query: string, params: any[] = []): Promise<any> {
  try {
    const res = await poolObj.query(query, params);
    return res.rows;
  } catch (err: any) {
    return { error: err.message };
  }
}

async function main() {
  // Find an admin user
  const adminRes = await pool.query(
    `SELECT id, employee_code, role, department, name FROM employees WHERE role = 'admin' AND is_active = true LIMIT 1`
  );
  
  if (adminRes.rows.length === 0) {
    console.error("No active admin found in database!");
    process.exit(1);
  }
  
  const adminUser = adminRes.rows[0];
  console.log("Using Admin Context:", adminUser);
  
  const userContext = {
    employeeId: adminUser.id,
    employeeCode: adminUser.employee_code,
    role: adminUser.role,
    department: adminUser.department,
    employeeName: adminUser.name
  };

  const queries = [
    {
      id: "Q3",
      text: "who are all the HR and admin staff",
      sqlQuery: "SELECT employee_code, name, role FROM employees WHERE role IN ('hr', 'admin');",
      runSql: () => runSQL("Q3", pool, "SELECT employee_code, name, role FROM employees WHERE role IN ('hr', 'admin');")
    },
    {
      id: "Q7",
      text: "how many casual leaves has durga devi used this year",
      sqlQuery: "SELECT COUNT(*) FROM leaves WHERE user_id = 'E0048' AND leave_type = 'Casual' AND status = 'Approved' AND EXTRACT(YEAR FROM start_date) = 2026;",
      runSql: () => runSQL("Q7", lmsPool, "SELECT COUNT(*) FROM leaves WHERE user_id = 'E0048' AND leave_type = 'Casual' AND status = 'Approved' AND EXTRACT(YEAR FROM start_date) = 2026;")
    },
    {
      id: "Q12",
      text: "how many employees have draft timesheets right now",
      sqlQuery: "SELECT COUNT(DISTINCT employee_code) FROM time_entries WHERE status = 'draft';",
      runSql: () => runSQL("Q12", pool, "SELECT COUNT(DISTINCT employee_code) FROM time_entries WHERE status = 'draft';")
    },
    {
      id: "Q14",
      text: "who has the highest attendance risk this month",
      sqlQuery: "Late arrivals buffer checks (>09:50:00) for June 2026",
      runSql: () => runSQL("Q14", pool, `
        SELECT employee_code, employee_name, COUNT(*) as late_count
        FROM time_entries
        WHERE date BETWEEN '2026-06-01' AND '2026-06-30'
          AND start_time IS NOT NULL
          AND start_time ~ '^[0-9]{2}:[0-9]{2}'
          AND start_time::time > '09:50:00'
        GROUP BY employee_code, employee_name
        ORDER BY late_count DESC
        LIMIT 5;
      `)
    },
    {
      id: "Q15",
      text: "show me all pending approvals across the company",
      sqlQuery: "SELECT COUNT(*) FROM leaves WHERE status = 'Pending'; SELECT COUNT(*) FROM time_entries WHERE status = 'pending';",
      runSql: async () => {
        const leaves = await runSQL("Q15_leaves", lmsPool, "SELECT COUNT(*) FROM leaves WHERE status = 'Pending';");
        const timesheets = await runSQL("Q15_timesheets", pool, "SELECT COUNT(*) FROM time_entries WHERE status = 'pending';");
        return { pendingLeaves: leaves, pendingTimesheets: timesheets };
      }
    },
    {
      id: "Q16",
      text: "which manager has the most pending approvals waiting",
      sqlQuery: "SELECT manager_approved_by/approved_by pending time entries count",
      runSql: async () => {
        try {
          const res = await pool.query(`
            SELECT approved_by, COUNT(*) as pending_count
            FROM time_entries WHERE status = 'pending'
            AND approved_by IS NOT NULL
            GROUP BY approved_by ORDER BY pending_count DESC LIMIT 3;
          `);
          return res.rows;
        } catch {
          const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'time_entries';`);
          return { error: "Query failed", columns: cols.rows.map(r => r.column_name) };
        }
      }
    }
  ];

  const results: any[] = [];

  for (const q of queries) {
    console.log(`\n==================================================`);
    console.log(`[TEST] Starting ${q.id}: "${q.text}"`);
    console.log(`==================================================`);

    const sqlRes = await q.runSql();

    const interceptedLogs: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      interceptedLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
      originalConsoleLog(...args);
    };

    const startTime = Date.now();
    let textResponse = "";

    try {
      await runCoordinator({
        message: q.text,
        userContext,
        history: [],
        onChunk: (chunk) => {
          if (chunk.type === "text" && chunk.content) {
            textResponse += chunk.content;
          }
        }
      });
    } catch (err: any) {
      textResponse = `ERROR: ${err.message}`;
    }

    console.log = originalConsoleLog;
    const responseTime = Date.now() - startTime;

    const agentLog = interceptedLogs.find(l => l.includes("[ROUTING] Query:"));
    const execLogs = interceptedLogs.filter(l => l.includes("Executing tool"));
    const dedupLogs = interceptedLogs.filter(l => l.includes("[DEDUP]"));

    results.push({
      id: q.id,
      text: q.text,
      sqlQuery: q.sqlQuery,
      sqlResult: sqlRes,
      ariaResponse: textResponse,
      responseTimeMs: responseTime,
      routingLog: agentLog || "Unknown",
      toolsCalled: execLogs.map(l => {
        const idx = l.indexOf("Executing tool");
        return idx !== -1 ? l.substring(idx) : l;
      }),
      deduplicatedCalls: dedupLogs.map(l => {
        const idx = l.indexOf("[DEDUP]");
        return idx !== -1 ? l.substring(idx) : l;
      }),
    });
  }

  console.log("\n\n==================================================");
  console.log("FINAL REPORT SUMMARY JSON");
  console.log("==================================================");
  console.log(JSON.stringify(results, null, 2));

  process.exit(0);
}

main().catch(console.error);
