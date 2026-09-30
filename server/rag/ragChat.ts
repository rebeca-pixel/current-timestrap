import OpenAI from "openai";
import { randomUUID } from "crypto";
import { retrieveContext } from "./retrieval";
import { lmsPool } from "../lmsSupabase";
import { pmsPool } from "../pmsSupabase";
import { pool } from "../db";
import { storage } from "../storage";
import { getProjects as getPMSProjects } from "../pmsSupabase";
import { getToolsForAgent, type AgentType } from "./agentTools";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractFirstName(fullName: string): string {
  if (!fullName) return "there";
  const cleaned = fullName.replace(/^[A-Z]\./i, "").trim();
  const first = cleaned.split(" ")[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
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

function calcHours(start: string, end: string): string {
  try {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const diff = eh * 60 + em - (sh * 60 + sm);
    if (diff <= 0) return "0h 0m";
    return `${Math.floor(diff / 60)}h ${diff % 60}m`;
  } catch {
    return "0h 0m";
  }
}

function resolveEmployeeCode(
  args: { employeeCode?: string },
  userContext: { employeeCode: string; role: string }
): string {
  if (!args.employeeCode || args.employeeCode === userContext.employeeCode) {
    return userContext.employeeCode;
  }
  if (!['manager', 'hr', 'admin'].includes(userContext.role)) {
    throw new Error("Access denied: insufficient permissions");
  }
  return args.employeeCode;
}

async function getEmployeeLeaveBalance(employeeCode: string, year: number) {
  const balRes = await lmsPool.query(
    `SELECT casual_total, sick_total FROM leave_balance 
     WHERE LOWER(employee_code) = LOWER($1) AND year = $2`,
    [employeeCode, year]
  );
  
  let casualAllotted = 10;
  let sickAllotted = 5;
  let privilegeAllotted = 10;
  
  if (balRes.rows.length > 0) {
    casualAllotted = balRes.rows[0].casual_total ?? 10;
    sickAllotted = balRes.rows[0].sick_total ?? 5;
  }
  
  const leavesRes = await lmsPool.query(
    `SELECT leave_type, start_date, end_date, leave_duration_type 
     FROM leaves 
     WHERE LOWER(user_id) = LOWER($1) AND status = 'Approved'
       AND (EXTRACT(YEAR FROM start_date) = $2 OR EXTRACT(YEAR FROM end_date) = $2)`,
    [employeeCode, year]
  );
  
  let casualUsed = 0;
  let sickUsed = 0;
  let privilegeUsed = 0;
  let othersUsed = 0;
  
  const calculateLeaveDays = (row: any): number => {
    if (row.leave_duration_type && row.leave_duration_type.toLowerCase() === "half day") {
      return 0.5;
    }
    const start = new Date(row.start_date);
    const end = new Date(row.end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 1;
    }
    const diffTime = end.getTime() - start.getTime();
    if (diffTime < 0) return 0;
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };
  
  for (const row of leavesRes.rows) {
    const type = (row.leave_type || "").toLowerCase();
    const days = calculateLeaveDays(row);
    if (type.includes("casual")) {
      casualUsed += days;
    } else if (type.includes("sick")) {
      sickUsed += days;
    } else if (type.includes("privilege")) {
      privilegeUsed += days;
    } else {
      othersUsed += days;
    }
  }
  
  return {
    casual: { allotted: casualAllotted, used: casualUsed, remaining: Math.max(0, casualAllotted - casualUsed) },
    sick: { allotted: sickAllotted, used: sickUsed, remaining: Math.max(0, sickAllotted - sickUsed) },
    privilege: { allotted: privilegeAllotted, used: privilegeUsed, remaining: Math.max(0, privilegeAllotted - privilegeUsed) },
    others: { used: othersUsed }
  };
}


// Load all memories for this employee
async function loadMemories(employeeId: string): Promise<string> {
  try {
    const res = await pool.query(
      `SELECT memory_type, memory_key, memory_value, usage_count
       FROM ai_memories
       WHERE employee_id = $1
       ORDER BY usage_count DESC, last_used_at DESC`,
      [employeeId]
    );
    if (res.rows.length === 0) return "";

    const grouped: Record<string, any[]> = {};
    for (const row of res.rows) {
      if (!grouped[row.memory_type]) grouped[row.memory_type] = [];
      grouped[row.memory_type].push({
        key: row.memory_key,
        value: row.memory_value,
        count: row.usage_count,
      });
    }

    const lines: string[] = ["EMPLOYEE MEMORY (from past sessions):"];
    for (const [type, items] of Object.entries(grouped)) {
      lines.push(`${type}:`);
      for (const item of items) {
        const val = typeof item.value === "object" ? JSON.stringify(item.value) : item.value;
        lines.push(`  - ${item.key}: ${val} (used ${item.count}x)`);
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

// Save or update a memory entry
async function saveMemory(
  employeeId: string,
  memoryType: string,
  memoryKey: string,
  memoryValue: any
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_memories (employee_id, memory_type, memory_key, memory_value, usage_count, last_used_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
       ON CONFLICT (employee_id, memory_type, memory_key)
       DO UPDATE SET
         memory_value = $4,
         usage_count = ai_memories.usage_count + 1,
         last_used_at = NOW(),
         updated_at = NOW()`,
      [employeeId, memoryType, memoryKey, JSON.stringify(memoryValue)]
    );
  } catch (err) {
    console.error("saveMemory error:", err);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runRAGChat(
  message: string,
  history: { role: "user" | "assistant" | "system"; content: string }[],
  userContext: {
    employeeId: string;
    employeeCode: string;
    role: string;
    department: string;
    lmsUserId?: string;
    employeeName?: string;
    baseUrl?: string;
    agentMode?: AgentType;
    agentSystemPrompt?: string;
    overrideModel?: string;
    executionCache?: Map<string, Promise<any>>;
  },
  onChunk: (chunk: {
    type: "text" | "interactive_task_plan" | "action_executed";
    content?: string;
    tasks?: any[];
    action?: string;
    status?: string;
  }) => void
) {
  const firstName = extractFirstName(userContext.employeeName || "");

  // 1. RAG context — retrieve employee-specific and company-policy context separately
  const employeeContext = await retrieveContext(message, {
    role: userContext.role,
    employee_id: userContext.employeeId,
    employee_code: userContext.employeeCode,
  }, 5);

  const policyContext = await retrieveContext(message, {
    role: userContext.role,
    data_type: "company_policy",
  }, 3);

  const context = [...policyContext, ...employeeContext];
  const contextStr =
    context.length > 0
      ? context.map((c, i) => `[Reference ${i + 1}]:\n${c}`).join("\n\n")
      : "No matching reference records found.";

  console.log("[RAG] contextStr length:", contextStr.length);
  console.log("[RAG] contextStr preview:", contextStr.slice(0, 200));

  const memoriesStr = await loadMemories(userContext.employeeId);

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const lastWeekStart = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  let instructions = `
You are ARIA (Automated Resource & Intelligence Assistant), an intelligent AI Agent built exclusively for Knockturn Private Limited.
You are embedded inside the company's internal ERP system called Timestrap.

CRITICAL EMPLOYEE RESOLUTION RULE: Whenever a user refers to another employee by name, nickname, or partial name (anything other than 'my' or 'me'), you MUST call getEmployees with the search parameter BEFORE calling any other tool that requires employeeCode. This applies even if a similar name appeared earlier in the conversation — always re-resolve via getEmployees, never reuse a previously guessed or remembered employeeCode. NEVER construct, invent, or pattern-match an employeeCode yourself under any circumstance. If getEmployees returns zero matches, respond: 'I could not find an employee matching [name].' If it returns multiple matches, list all of them by name and employeeCode and ask the user to clarify which one before proceeding. Only call other tools (getMyTasks, getTimesheetsByDate, etc.) once a single confirmed employeeCode is established from getEmployees results.

IDENTITY:
- You are not a chatbot. You are a smart AI Agent.
- You think, decide, and act — not just answer.
- You are professional, concise, and confident.
- You never say "I don't have access" or "I cannot help with that".
- You always try a tool first before saying something is unavailable.
- You respond in the same language the user writes in.

CURRENT USER:
- Name: ${firstName}
- Employee Code: ${userContext.employeeCode}
- Employee ID: ${userContext.employeeId}
- Role: ${userContext.role}
- Department: ${userContext.department}
- LMS User ID: ${userContext.lmsUserId || userContext.employeeCode}

KNOWLEDGE SOURCES (use in this order):
1. TOOLS — for anything related to user's own data
2. RETRIEVED CONTEXT — for broader company data
3. WORLD KNOWLEDGE — for general questions

STRICT RULES:
- When asked about company policies (such as office timings, work hours, leaves, holidays, late arrival, attendance policies, bonuses, or HR contact details), you MUST rely ONLY on the information under the "RETRIEVED DATABASE CONTEXT" section. Never use your general training knowledge or make assumptions. If the required information is not in the context, explicitly state that you cannot find this policy in the company records.
- ALWAYS call a tool for data queries. Never guess from memory.
- "my tasks" → getMyTasks
- "my leaves" → getMyLeaves
- "my timesheets" → getRecentTimesheets
- specific date or date range timesheet for a single employee → getTimesheetsByDate (ALWAYS pass from_date and to_date for date ranges, weeks, or months to query all data in a single call)
- submitted/not-submitted analysis for a specific employee → ALWAYS use getTimesheetsByDate with employeeCode + from_date + to_date. NEVER use getTeamData for this.
- team-wide compliance queries (e.g. "Who submitted late?", "Who didn't submit?", "Who submitted on time?", "Who is late?", department or team compliance summary) → ALWAYS use getTeamData with dataType = "timesheets", set complianceMode ('late', 'missing', 'ontime', or 'all'), and specify startDate and endDate. NEVER use getTimesheetsByDate for team-wide queries.
- submitting timesheet → submitTimesheet
- requesting leave → requestLeave
- creating task → createTask
- completing task → markTaskComplete
- changing deadline → updateTaskDeadline
- approving leave → approveLeaveRequest
- rejecting leave → rejectLeaveRequest
- "did I submit my plan" → getDailyPlan
- "delete my plan" → deleteDailyPlan
- "who submitted daily plan today", "who missed daily plan today", "daily plan compliance" → getDailyPlanSubmissions
- updating task progress → updateTaskProgress
- updating task status → updateTaskStatus
- updating task description → updateTaskDescription
- view project details → getProjectDetails
- extending project deadline → extendProjectDeadline
- deleting a task → deleteTask (ALWAYS confirm first)
- deleting a project → deleteProject (ALWAYS confirm first)
- generating any report → generateReport (HR/Admin only)
- always ask format preference (pdf or excel) before generating if not specified by the user.
- NEVER assume, guess, or default a date range for report generation. If the user has not explicitly provided a date range (e.g. "for this month", "from June 1st to June 19th"), you MUST ask the user to specify or confirm the date range first. You are STRICTLY FORBIDDEN from calling the generateReport tool before you have obtained the date range from the user.
- When user asks for task names, start times, end times, or individual task details for employees — always use report_type: "detailed_timesheet", never compliance or productivity.
- When user asks for "daily plan per employee" or "plan for the day report" or when a multi-employee/per-employee daily plan report is requested — always use report_type: "daily_plan_per_employee", never compliance, timesheet or general daily_plan.
- When user asks for "timesheet per employee" or "timesheet breakdown per person" or hours worked per person — always use report_type: "timesheet_per_employee".
- checking performance/productivity → getPerformancePrediction
- checking task deadline risks → getTaskRisks  
- checking attendance risk → getAttendanceRiskCheck
- checking project health → getProjectHealth
- getting team insights/workload balance → getTeamInsights
- always present risk levels clearly with HIGH/MEDIUM/LOW labels
- always include actionable suggestions with predictions
- For leave requests: 
   Step 1 — Ask leave type if not specified (Casual, Sick, Privilege, Maternity, Paternity)
   Step 2 — Ask duration if not specified (Full Day or Half Day)
   Step 3 — Ask reason — NEVER generate or assume a reason, wait for user to type it
   Step 4 — Show confirmation summary with all details
   Step 5 — Wait for explicit "yes" or "confirm" before submitting
   NEVER fill reason, leave type, or duration on behalf of the user.

COUNT & STATUS RULES (CRITICAL — NEVER VIOLATE):
- NEVER state or guess a count for projects, tasks, timesheets, leaves, or any data from memory or previous context. Always call the relevant tool first (e.g. getMyTasks, getMyProjects), then answer using ONLY the numbers returned by the tool.
- NEVER confirm or deny any submission status (daily plan, timesheet, leave request) from memory or assumption. Always call the relevant tool (getDailyPlan, getTimesheetsByDate, getMyLeaves) to verify before answering.
- If the user corrects a number you gave, do NOT agree — call the tool again and report the actual result.
- If asked about another employee's data (tasks, projects, plans), pass their employeeCode to the tool so the database retrieves THEIR records, not the current user's.
- If the same data is requested more than once in a conversation, ALWAYS call the tool again. Never reuse a previous tool result.
- Every answer that includes a number MUST come from a tool call in THIS turn. If you did not call a tool in this turn, you CANNOT state a number.
- When querying timesheets for a date range (such as a week, a month, or a specific period), you MUST pass the from_date and to_date parameters to the getTimesheetsByDate tool to retrieve all entries for the entire range in a single tool call. NEVER call getTimesheetsByDate day-by-day (e.g., 30 separate times), as it causes context truncation and counts to be lost.
- When summarizing or reporting timesheet submissions, always group, filter, and check dates using the "date" column (e.g., "2026-06-05") returned from the database tools. NEVER parse, group, or shift dates based on the "submitted_at" timestamp (e.g., "2026-06-04T23:33:21.855Z" UTC), as it can cause incorrect timezone shifts.
- A day is considered "Submitted" only if there is at least one entry for that date in the database and its status is one of: 'pending', 'submitted', 'manager_approved', 'approved', 'on_hold', 'resubmitted'.
- A day is considered "Not Submitted" if there are no entries for that date, OR if all entries for that date have status = 'draft'.
- To report or summarize submitted vs. not submitted days for a single employee for a month or date range:
  1. Retrieve timesheets for that range using getTimesheetsByDate with from_date and to_date.
  2. The tool returns BOTH "submittedDates" AND "notSubmittedDays" computed by the database — use them DIRECTLY as-is. NEVER recalculate, add, or remove any dates yourself.
  3. Display submittedDates exactly as returned. Display notSubmittedDays exactly as returned. Do NOT filter or modify these arrays.
  4. Report totalSubmittedDays and totalNotSubmittedDays from the tool result fields. NEVER count manually.
  5. NEVER say "No not submitted entries found" if notSubmittedDays is a non-empty array in the tool result.
  6. NEVER add any date that is not in the tool result. Trust ONLY what the tool returns.
  7. NEVER label a date with a day-of-week name (e.g. "Sunday", "Monday") unless you are 100% certain — if uncertain, omit the day name entirely. The database already excludes Sundays, so do not second-guess the filter.
  8. When listing dates, copy them character-for-character from the tool result arrays. Do NOT paraphrase, reorder beyond sorting, or add dates you think are missing.
  9. The count of submitted days = length of submittedDates array. The count of not-submitted days = length of notSubmittedDays array. Never derive these from anything else.
- To report team-wide compliance (e.g., who submitted late, who didn't submit/missing timesheets, who submitted on time):
  1. Retrieve compliance records using getTeamData with dataType = "timesheets" and set complianceMode ('late', 'missing', or 'ontime').
  2. The tool returns only the relevant pre-computed array (lateSubmissions, missingSubmissions, or onTimeSubmissions) containing the employee names and dates. Use them DIRECTLY as-is. NEVER perform calculations, comparisons, or infer compliance status yourself.
- To report or check team-wide daily plan submissions (who submitted, who missed, daily plan compliance), you MUST use the getDailyPlanSubmissions tool. NEVER use getDailyPlan (which is for a single employee) or getTeamData (which does not contain daily plan submission data). NEVER guess or assume compliance from task assignments or timesheets.
- When queried about "draft timesheets" (e.g., "how many employees have draft timesheets right now", "who has draft timesheets"), you MUST use the getDraftTimesheets tool, which queries for all draft timesheet entries across all dates, rather than checking only today's missing submissions.
- When checking company-wide attendance risk with no department specified, first use getTeamInsights to identify the top at-risk employees, then run getAttendanceRiskCheck only on those employees (maximum 10). Do not run getAttendanceRiskCheck on every single employee in the company. Never default the scope to the logged-in user's own department when no department filter is specified.
- When asked for "pending approvals across the company" or "show all pending approvals" (which are cross-domain requests involving both leaves and timesheets), you MUST use the getPendingApprovals tool to fetch both leave approvals and timesheet approvals in a single call. Summarize both categories completely using the combined counts and items returned.

HALLUCINATION PREVENTION — EMPLOYEE NAMES (CRITICAL):
- When reporting employee names from ANY tool result, you MUST use ONLY the exact names that appear in clearly labeled employee fields (e.g. 'employeeName' inside missingSubmissions, lateSubmissions, or onTimeSubmissions arrays).
- NEVER infer, construct, or include an employee name from any other context: raw task descriptions, project names, email subjects, meeting titles, or surrounding text — even if the name seems plausible.
- If you cannot find a name in a clearly labeled employee field in the tool result, do NOT report that person under any circumstance.
- If the compliance array is empty, say exactly: "No employees found for this query." Do not fill in names from elsewhere.

EMPLOYEE NAME RESOLUTION RULES:
- Follow the CRITICAL EMPLOYEE RESOLUTION RULE at the top of the prompt strictly.
- Resolve names via getEmployees, verify multiple matches, and never guess employeeCode parameters.
- When the user asks "who are the HR staff", "who are the admins", or "who are the [role] staff" (or any variation inquiring about a specific role), you MUST always pass the 'role' parameter to getEmployees (e.g., role: 'hr', role: 'admin'), and NEVER pass the department parameter. Role filter accepts 'hr', 'admin', 'manager', 'employee' — use role for org-role queries, department for org-unit queries (e.g. Presales department).

DATE RULES:
- Always convert "yesterday", "today", "last week" to exact YYYY-MM-DD before calling any tool.
- When the user refers to a month by name (e.g., "may", "may month", "last month", "june 2026", "this month"):
  - ALWAYS convert it to an explicit date range (from_date and to_date) representing the first and last day of that month (e.g., "may 2026" or "may month" → from_date: "2026-05-01", to_date: "2026-05-31") before calling any tool.
  - Calculate "last month" and "this month" relative to the current local date (today is: ${today}).
  - NEVER fail or state that no entries exist just because the user specified a month name instead of an explicit date range.

CONVERSATION CONTEXT:
- When user says "anything else?" or "other than this?" — do NOT repeat the same query.
  Say "Those are all your active tasks" or search with different filters.

SECURITY RULES:
- Employees ONLY see their own data.
- Managers, HR, Admin can see all employee data via employeeCode parameter.
- Always verify role before sensitive actions.
- Distinguish tool errors: if a tool returns a permission error (e.g. starts with "Access denied" or "Unauthorized"), you MUST state explicitly: "You don't have permission to do that." (or similar direct permission-denial message). Never output "could not find [name]" or similar not-found/zero-results messaging when the tool returned a permission error.

DELETION RULES:
- Before deleting anything (plan, timesheet, task), ALWAYS ask the user for confirmation first.
- Say: "Are you sure you want to delete your plan for [date]? This cannot be undone."
- Only call the delete tool AFTER the user explicitly confirms.

RESPONSE FORMATTING:
- Always address the user as "${firstName}", never by employee code.
- Use markdown: bold for labels, bullet points for lists.
- Use emojis naturally (✅ ❌ 📅 ⚠️ 👋 📋 🌴 ⏱️).
- Be direct and concise. No filler.
- Never say "As an AI language model..."
- Never say "I don't have real-time access..."
- YOU ARE the ERP system.

GREETING BEHAVIOR:
When the user greets you (any language, any phrasing):
- Warmly greet them by name and time of day (e.g. "Good morning ${firstName}!", "Good afternoon ${firstName}!", "Good evening ${firstName}!")
- Ask them how you can help them today.
- Do NOT call any tools. Do NOT attempt to load tasks, leaves, timesheets, or overdue summaries.
- Keep the response clean, friendly, and simple (e.g. "Good morning ${firstName}! How can I help you today?").

MEMORY SYSTEM:
You have access to persistent memory for this employee across sessions.
Memories are loaded at the start of every conversation.
Use memories silently — never announce "I remember..." or "Based on my memory..."
Just USE the information naturally, like a colleague who knows you well.

Memory types you track:
- tools_preference: tools this employee commonly uses
- project_preference: projects they work on most
- work_hours: their usual start/end times
- language: their preferred language (Tamil/English)
- response_style: brief or detailed responses
- last_session: summary of what was discussed last time

WHEN TO SAVE MEMORY (call saveMemory tool):
- Employee mentions a tool they use → save to tools_preference
- Employee mentions usual working hours → save to work_hours
- Employee writes consistently in Tamil → save language: Tamil
- Employee asks for shorter responses → save response_style: brief
- Employee mentions they always work on a specific project → save project_preference
- End of any substantial conversation → save a last_session summary

WHEN TO USE MEMORY (automatically, silently):
- Timesheet logging: pre-suggest their usual tools
- Morning plan: highlight their preferred projects first
- Greeting: reference last session if relevant
- Language: respond in their preferred language

MEMORY RULES:
- Never save sensitive data (leave reasons, personal problems)
- Never save passwords, codes, IDs
- Only save behavioral patterns and preferences
- Maximum one saveMemory call per conversation turn

- For any other question, format the tool data in full detail clearly.

- When an employee wants to log a timesheet, use the timesheet tools
  to guide them conversationally. Always confirm before finalizing.

- When an employee wants to plan their day, fetch their tasks, suggest
  a plan based on deadlines and priority, wait for confirmation, then submit.

DAILY PLAN FLOW:
When user says "plan my day", "create plan", "make my plan", or similar:
- ALWAYS call getMyTasksForPlan immediately — no text before it
- The widget will handle task selection automatically
- After the widget sends back selected tasks, call submitDailyPlan
- For unselected tasks, generate a short postponement reason automatically
- Confirm plan submitted with task count

TIMESHEET FLOW:
When user wants to log time or submit timesheet:
1. Call getMyProjects to show their projects
2. Ask: "Which project did you work on?"
3. Call getMyTasks to show tasks for that project
4. Ask: "Which task? What time did you start and finish?"
5. Call getProjectSubtasks if task has subtasks
6. Ask: "What did you achieve? Any tools used?"
7. Repeat steps 2-6 for each task the employee worked on
8. Once employee says done or no more tasks:
   Show a FULL SUMMARY of all entries collected:
   
   "Here's what I'll submit:
   [list each entry with project, task, time, hours, quantify, tools]
   Total: X entries, Y hours
   Shall I submit? (yes / make changes)"
   
9. ONLY after employee confirms with "yes" or "confirm":
   Call submitTimesheetEntry for EACH task one by one
   Then call finalizeTimesheetSubmission once
10. Never submit anything without explicit confirmation

RETRIEVED DATABASE CONTEXT:
${contextStr}

EMPLOYEE MEMORY:
${memoriesStr || "No memories stored yet — this may be the first session."}

You are ARIA. You think. You decide. You act.
You are the intelligent brain of Knockturn Private Limited's ERP system.
`;

  // 3. Tool definitions
  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "getMyTasks",
        description: `Fetch active assigned tasks from PMS. Always call this tool to get the exact count. Never guess or recall task counts from previous context.
If a manager/HR/admin asks about another employee's tasks, pass that employee's code in the employeeCode parameter.`,
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to query (e.g. 'E0048'). Defaults to the logged-in user. Only managers/HR/admin can query other employees.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getMyTasksForPlan",
        description: `ALWAYS use this when user wants to plan their day, create a daily plan, or says "plan my day".
Fetches all active PMS tasks assigned to the employee and triggers the interactive task selection widget.
Do NOT use getMyTasks for plan creation — use this tool instead.
After calling this, the widget handles task selection. Do not list tasks in text.`,
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "getMyLeaves",
        description: "Fetch the logged-in employee's leave requests.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected", ""],
              description: "Optional status filter.",
            },
            employeeCode: {
              type: "string",
              description: "Optional employee code. When provided, fetches that employee's leaves. Only allowed for admin/hr/manager."
            }
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getTimesheetsByDate",
        description: "Fetch timesheets for a specific date or date range.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "Specific date YYYY-MM-DD" },
            from_date: { type: "string", description: "Start date YYYY-MM-DD" },
            to_date: { type: "string", description: "End date YYYY-MM-DD" },
            employeeCode: { type: "string", description: "Optional employee code. Managers/admins/HR only." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getRecentTimesheets",
        description: "Fetch recent timesheet entries without a specific date.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number to fetch (default 5, max 20)" },
            employeeCode: { type: "string", description: "Optional employee code. Managers/admins/HR only." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "viewPendingLeaves",
        description: "View all pending leave requests. Managers/HR/Admin only.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "approveLeaveRequest",
        description: "Approve a pending leave request by ID.",
        parameters: {
          type: "object",
          properties: {
            leaveId: { type: "string", description: "Leave request UUID." },
          },
          required: ["leaveId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rejectLeaveRequest",
        description: "Reject a pending leave request by ID.",
        parameters: {
          type: "object",
          properties: {
            leaveId: { type: "string", description: "Leave request UUID." },
          },
          required: ["leaveId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "markTaskComplete",
        description: "Mark a project task as completed.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
          },
          required: ["taskId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "assignTaskToEmployee",
        description: "Assign a task to an employee. Available to everyone.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
            employeeCode: { type: "string", description: "Employee code (e.g. E0047)." },
          },
          required: ["taskId", "employeeCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateTaskDeadline",
        description: "Update a task's deadline. Available to everyone.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
            deadline: { type: "string", description: "New deadline YYYY-MM-DD." },
          },
          required: ["taskId", "deadline"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "approveTimesheet",
        description: "Approve a timesheet entry. Managers/Admins only.",
        parameters: {
          type: "object",
          properties: {
            timesheetId: { type: "string", description: "Time entry UUID." },
          },
          required: ["timesheetId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rejectTimesheet",
        description: "Reject a timesheet entry. Managers/Admins only.",
        parameters: {
          type: "object",
          properties: {
            timesheetId: { type: "string", description: "Time entry UUID." },
          },
          required: ["timesheetId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submitTimesheet",
        description: "Submit a new timesheet entry for the logged-in employee.",
        parameters: {
          type: "object",
          properties: {
            projectName: { type: "string" },
            taskDescription: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            startTime: { type: "string", description: "HH:MM 24h" },
            endTime: { type: "string", description: "HH:MM 24h" },
            percentageComplete: { type: "number" },
            quantify: { type: "string" },
            problemAndIssues: { type: "string" },
            achievements: { type: "string" },
            scopeOfImprovements: { type: "string" },
            toolsUsed: { type: "array", items: { type: "string" } },
          },
          required: ["projectName", "taskDescription", "date", "startTime", "endTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "requestLeave",
        description: "Submit a new leave request for the logged-in employee.",
        parameters: {
          type: "object",
          properties: {
            leaveType: {
              type: "string",
              enum: ["Casual", "Sick", "Privilege", "Maternity", "Paternity"],
              description: "The type of leave (Casual, Sick, Privilege, Maternity, Paternity). DO NOT guess, assume, or default if not specified by the user.",
            },
            startDate: { type: "string", description: "Start date YYYY-MM-DD" },
            endDate: { type: "string", description: "End date YYYY-MM-DD" },
            reason: {
              type: "string",
              description: "Reason for leave. NEVER generate, assume, or guess this value. Only use what the user explicitly stated. If not provided, ask the user before proceeding.",
            },
            leaveDurationType: {
              type: "string",
              enum: ["Full Day", "Half Day"],
              description: "The duration of leave (Full Day or Half Day). DO NOT guess, assume, or default if not specified by the user.",
            },
          },
          required: ["startDate", "endDate"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "createTask",
        description: "Create a new project task in PMS.",
        parameters: {
          type: "object",
          properties: {
            projectCode: { type: "string" },
            taskName: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: ["Low", "Medium", "High"] },
            startDate: { type: "string" },
            endDate: { type: "string" },
            assigneeCode: { type: "string" },
            status: { type: "string" },
            progress: { type: "number" },
          },
          required: ["projectCode", "taskName"],
        },
      },
    },

    {
      type: "function",
      function: {
        name: "getEmployees",
        description: "Fetch a list of employees or search employees by name, department, role, or active status. Restricted to admin, hr, and manager roles.",
        parameters: {
          type: "object",
          properties: {
            department: {
              type: "string",
              description: "Filter by department (e.g. 'Software', 'Finance', 'HR & Admin', 'IT Support', 'Engineering'). Use department for org-unit queries."
            },
            role: {
              type: "string",
              description: "Filter by role (accepts 'hr', 'admin', 'manager', 'employee'). Use role for org-role queries (e.g. when user asks 'who are the HR staff' or 'who are the admins'), never department."
            },
            isActive: {
              type: "boolean",
              description: "Filter by active status (true for active, false for inactive)."
            },
            search: {
              type: "string",
              description: "Search keyword matching employee name, email, or employee code."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "getTeamData",
        description: `Fetch any team-level data for managers, HR, and admins.
Use this for ANY question about the team including:
- Who hasn't submitted timesheets?
- Which tasks are overdue?
- Who is on leave?
- Who is the most productive employee?
- Which department is performing best?
- Who has the most completed tasks?
- Who logs the most hours?
- Compare employee performance
- Team workload analysis
- Any question that requires team or employee data

Data available to answer these questions:
- time_entries: hours logged, submission rate, project work
- project_tasks: completed tasks, overdue tasks, progress
- leaves: attendance patterns
- employees: department, role, active status

Fetch the relevant dataType(s) and let GPT calculate, 
rank, and analyse the results intelligently.

IMPORTANT: Do NOT use getTeamData to answer "which days did employee X submit/not submit?" for a date range. For that, always use getTimesheetsByDate with employeeCode + from_date + to_date instead.`,
        parameters: {
          type: "object",
          properties: {
            dataType: {
              type: "string",
              enum: ["timesheets", "tasks", "leaves", "employees"],
              description: "The type of team data to fetch.",
            },
            date: {
              type: "string",
              description: "Specific date filter YYYY-MM-DD",
            },
            startDate: {
              type: "string",
              description: "Start of date range YYYY-MM-DD",
            },
            endDate: {
              type: "string",
              description: "End of date range YYYY-MM-DD",
            },
            department: {
              type: "string",
              description: "Filter by department name e.g. Software, HR",
            },
            status: {
              type: "string",
              description: "Filter by status e.g. pending, approved, rejected, completed, In Progress",
            },
            employeeCode: {
              type: "string",
              description: "Filter down to a specific employee code e.g. E0047",
            },
            complianceMode: {
              type: "string",
              enum: ["late", "missing", "ontime", "all"],
              description: "Optional. Retrieve a specific subset of team timesheet compliance: 'late' for late submissions, 'missing' for missing/draft entries, 'ontime' for on-time submissions, or 'all' for complete compliance statistics."
            },
          },
          required: ["dataType"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getEmployeeDetail",
        description: `Fetch a complete profile and activity summary for a specific employee.
Use this when a manager asks:
- Tell me about E0047
- What has Priya been working on?
- Show me Naveen's full activity
- How productive is this employee?
Returns profile, active tasks, recent timesheets, and leave history all one call.`,
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "The employee code to look up e.g. E0047",
            },
          },
          required: ["employeeCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getMyProjects",
        description: `Fetch all active projects an employee is assigned to. Always call this tool to get the exact count. Never guess or recall project counts from previous context.
Use this when the employee wants to log a timesheet, plan their day, or asks about their projects.
If a manager/HR/admin asks about another employee's projects, pass that employee's code in the employeeCode parameter.
Returns project id, name, project_code, status, and deadline.`,
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to query (e.g. 'E0048'). Defaults to the logged-in user. Only managers/HR/admin can query other employees.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getProjectKeySteps",
        description: `Fetch available key steps for a specific project.
Use this during timesheet logging when the employee has selected a project and task,
and you need to show them which key step category their work falls under.
Key steps are things like: Development, Integration, Testing, Setup, Validation.`,
        parameters: {
          type: "object",
          properties: {
            projectCode: {
              type: "string",
              description: "The project_code of the project (e.g. 'BOQ-AI', 'BLE-01')",
            },
          },
          required: ["projectCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getProjectSubtasks",
        description: `Fetch active subtasks for a specific PMS task UUID.
Use this during timesheet logging after the employee has selected a task,
to show available subtasks they may have worked on.
Only returns incomplete subtasks (is_completed = false, progress < 100).`,
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The UUID of the PMS task",
            },
          },
          required: ["taskId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submitTimesheetEntry",
        description: `Never ask the employee multiple questions at once. 
Ask one natural question at a time, like a conversation.
Start by showing their active projects and tasks, then ask 
"Which of these did you work on today?" — nothing else yet.

Submit a single timesheet task entry for the logged-in employee.
Call this once per task the employee worked on today.
After ALL tasks have been submitted, call finalizeTimesheetSubmission to lock the day.

Collect these fields conversationally before calling — one natural response is enough:
- projectName: match exactly to the PMS project name
- taskDescription: the PMS task name or a clear description
- startTime / endTime: in HH:MM 24h format (convert "9am" to "09:00" automatically)
- percentageComplete: 0-100
- keyStep: selected from getProjectKeySteps results (optional, do not force)
- pmsId: the PMS task UUID from getMyTasks results
- pmsSubtaskId: subtask UUID if employee mentioned a subtask (optional)
- quantify: a measurable result (e.g. "3 bugs fixed", "1 layout built")
- achievements: what was accomplished
- problemAndIssues: any blockers (optional)
- scopeOfImprovements: suggestions for next time (optional)
- toolsUsed: array of tool names (optional, can be empty)
- date: always default to today unless employee specifies otherwise`,
        parameters: {
          type: "object",
          properties: {
            projectName: { type: "string" },
            taskDescription: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD, default today" },
            startTime: { type: "string", description: "HH:MM 24h format" },
            endTime: { type: "string", description: "HH:MM 24h format" },
            percentageComplete: { type: "number" },
            keyStep: { type: "string", description: "Key step title from getProjectKeySteps" },
            pmsId: { type: "string", description: "PMS task UUID" },
            pmsSubtaskId: { type: "string", description: "PMS subtask UUID (optional)" },
            quantify: { type: "string" },
            achievements: { type: "string" },
            problemAndIssues: { type: "string" },
            scopeOfImprovements: { type: "string" },
            toolsUsed: { type: "array", items: { type: "string" } },
          },
          required: ["projectName", "taskDescription", "startTime", "endTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finalizeTimesheetSubmission",
        description: `Call this ONCE after all timesheet entries have been submitted via submitTimesheetEntry.
This locks the daily submission, checks the 8-hour requirement, and sends confirmation emails.
Only call this when the employee confirms they have no more tasks to add.
Never call this before at least one submitTimesheetEntry has succeeded.`,
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD, default today" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submitDailyPlan",
        description: `Submit the employee's plan for today.
Use this when the employee wants to plan their day.
Always call getMyProjects and getMyTasks first to get available tasks.
Suggest a plan based on deadlines and priority, show it to the employee,
and wait for their confirmation or edits before calling this.

selectedTasks: tasks the employee WILL work on today
unselectedTasks: tasks being skipped today — always include a reason and a proposed new date`,
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD, default today" },
            selectedTasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "PMS task UUID" },
                  projectName: { type: "string" },
                  task_name: { type: "string" },
                  source: { type: "string", description: "Always 'PMS'" },
                  isLocked: { type: "boolean", description: "Always false" },
                  startTime: { type: "string", description: "Start time HH:MM" },
                  endTime: { type: "string", description: "End time HH:MM" },
                },
                required: ["id", "projectName", "task_name"],
              },
            },
            unselectedTasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  taskId: { type: "string", description: "PMS task UUID" },
                  taskName: { type: "string" },
                  reason: { type: "string", description: "Why skipping today" },
                  newDueDate: { type: "string", description: "YYYY-MM-DD proposed date" },
                },
                required: ["taskId", "taskName", "reason", "newDueDate"],
              },
            },
          },
          required: ["selectedTasks"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getDailyPlan",
        description: `Check if a daily plan has been submitted for a specific date. Always call this tool to verify plan status — never confirm or deny a plan from memory.
If a manager/HR/admin asks about another employee's plan, pass that employee's code in the employeeCode parameter.`,
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "YYYY-MM-DD format. Defaults to today if not provided.",
            },
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to query. Defaults to the logged-in user. Only managers/HR/admin can query other employees.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getDailyPlanSubmissions",
        description: `Get a list of who submitted their daily plan and who missed/did not submit their daily plan for a specific date across the company or department. Available to managers, HR, and admins only.`,
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "YYYY-MM-DD format. Defaults to today's date if not provided.",
            },
            department: {
              type: "string",
              description: "Optional. Filter results by a specific department (e.g. Software, HR, Finance).",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "deleteDailyPlan",
        description: `Delete the daily plan for a specific date. Always ask for confirmation before executing deletion — say "Are you sure you want to delete your plan for [date]? This cannot be undone." and only call this tool AFTER the user explicitly confirms.
If a manager/HR/admin wants to delete another employee's plan, pass that employee's code in the employeeCode parameter.`,
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "YYYY-MM-DD format. Defaults to today if not provided.",
            },
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to delete plan for. Defaults to the logged-in user. Only managers/HR/admin can delete other employees' plans.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "recallMemory",
        description: `Retrieve stored memories for the current employee.
Use this at the START of timesheet logging to recall their usual tools and projects.
Use this when employee asks "what do you remember about me?" or similar.
Returns all stored preferences, patterns, and last session summary.`,
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "saveMemory",
        description: `Save a preference, pattern, or summary to persistent memory for this employee.
Call this when you learn something useful about the employee's work patterns.
Examples:
- They mention they always use Node.js → save tools_preference
- They say they usually work 9am-6pm → save work_hours
- They write in Tamil → save language preference
- Conversation ends with useful context → save last_session summary
Never save sensitive personal information.`,
        parameters: {
          type: "object",
          properties: {
            memoryType: {
              type: "string",
              enum: [
                "tools_preference",
                "project_preference",
                "work_hours",
                "language",
                "response_style",
                "last_session",
                "general"
              ],
              description: "Category of memory to save",
            },
            memoryKey: {
              type: "string",
              description: "Specific key, e.g. 'favorite_tools', 'usual_start_time', 'last_topic'",
            },
            memoryValue: {
              description: "Value to store — string, array, or object",
            },
          },
          required: ["memoryType", "memoryKey", "memoryValue"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateTaskProgress",
        description: "Update the progress percentage of a task. Available to everyone.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
            progress: { type: "number", description: "Progress 0-100." },
          },
          required: ["taskId", "progress"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateTaskStatus",
        description: "Update the status of a task. Available to everyone. Valid statuses: In Progress, On Hold, Cancelled.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
            status: {
              type: "string",
              enum: ["In Progress", "On Hold", "Cancelled"],
            },
          },
          required: ["taskId", "status"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateTaskDescription",
        description: "Update the description of a task. Available to everyone.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
            description: { type: "string", description: "New description text." },
          },
          required: ["taskId", "description"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getProjectDetails",
        description: "Get full details of a project including tasks, progress, and team members.",
        parameters: {
          type: "object",
          properties: {
            projectCode: { type: "string", description: "Project code e.g. BLE-01." },
          },
          required: ["projectCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "extendProjectDeadline",
        description: "Update a project deadline. Available to everyone.",
        parameters: {
          type: "object",
          properties: {
            projectCode: { type: "string", description: "Project code e.g. BLE-01." },
            deadline: { type: "string", description: "New deadline YYYY-MM-DD." },
          },
          required: ["projectCode", "deadline"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "deleteTask",
        description: "Permanently delete a task. Always ask for confirmation before calling this. Say: 'Are you sure you want to delete [task name]? This cannot be undone.' Only call after user confirms.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
          },
          required: ["taskId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "deleteProject",
        description: "Permanently delete a project and all its tasks. Always ask for confirmation before calling. Say: 'Are you sure you want to delete project [name]? This will delete all tasks and cannot be undone.' Only call after user confirms.",
        parameters: {
          type: "object",
          properties: {
            projectCode: { type: "string", description: "Project code e.g. BLE-01." },
          },
          required: ["projectCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "generateReport",
        description: `Generate a downloadable PDF or Excel report. Available to HR and Admin only.
Report types:
- employee_timesheet: requires employeeCode, startDate, endDate
- employee_leave: requires employeeCode, startDate, endDate
- employee_tasks: requires employeeCode, startDate, endDate
- team_compliance: requires startDate, endDate
- team_leave: requires startDate, endDate
- team_productivity: requires startDate, endDate
- overdue_tasks: no date range needed
- project_progress: no date range needed
- project_tasks: requires projectCode
- detailed_timesheet: shows every task entry per employee with exact start time, end time, task name, project name for a date range
- daily_plan: shows all planned tasks per employee with start time, end time, duration from plan_tasks table
- daily_plan_per_employee: shows all planned tasks formatted with one sheet per employee, date bars, color-coded rows (white/light blue for work, yellow for break, light red for pending) for a date range
- timesheet_per_employee: one sheet per employee showing actual timesheet entries with start time, end time, hours worked, color coded by approval status`,
        parameters: {
          type: "object",
          properties: {
            reportType: {
              type: "string",
              enum: [
                "employee_timesheet",
                "employee_leave",
                "employee_tasks",
                "team_compliance",
                "team_leave",
                "team_productivity",
                "overdue_tasks",
                "project_progress",
                "project_tasks",
                "detailed_timesheet",
                "daily_plan",
                "daily_plan_per_employee",
                "timesheet_per_employee",
              ],
            },
            format: {
              type: "string",
              enum: ["pdf", "excel"],
              description: "Output format — pdf or excel",
            },
            employeeCode: { type: "string", description: "Required for employee reports" },
            startDate: { type: "string", description: "YYYY-MM-DD" },
            endDate: { type: "string", description: "YYYY-MM-DD" },
            projectCode: { type: "string", description: "Required for project_tasks report" },
          },
          required: ["reportType", "format"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getPerformancePrediction",
        description: "Get productivity score, trend, and risk level for an employee. Employees can check their own. Managers/HR/Admin can check anyone.",
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "Employee code. Use the logged-in user's code for self-check."
            },
            days: {
              type: "number",
              description: "Analysis period in days. Default 30."
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getTaskRisks",
        description: "Get all high/medium/low risk tasks for an employee based on progress vs deadline.",
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "Employee code to check task risks for."
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getAttendanceRiskCheck",
        description: "Check attendance risk — late arrival count and risk level for current month.",
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "Employee code to check."
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getProjectHealth",
        description: "Get health score and risk grade for a project.",
        parameters: {
          type: "object",
          properties: {
            projectCode: {
              type: "string",
              description: "Project code e.g. BLE-01."
            },
          },
          required: ["projectCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getTeamInsights",
        description: "Get full team insights — overloaded employees, underloaded employees, high risk performers. Managers/HR/Admin only.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getDraftTimesheets",
        description: "Fetch a list or count of all active employees who currently have any draft timesheet entries across all dates. Restricted to admin, hr, and manager roles.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getPendingApprovals",
        description: "Fetch all pending approval requests across the company, combining pending leave requests and pending timesheet approvals. Restricted to admin, hr, and manager roles.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    }
  ];

  // Filter tools if in agent mode
  let allowedTools = userContext.agentMode
    ? getToolsForAgent(userContext.agentMode)
    : null;

  // Ensure "getEmployees" is allowed across all agents for manager/hr/admin, so they can resolve employee codes.
  if (allowedTools && ["manager", "hr", "admin"].includes(userContext.role) && userContext.agentMode !== "conversational") {
    if (!allowedTools.includes("getEmployees")) {
      allowedTools = [...allowedTools, "getEmployees"];
    }
  }

  const filteredTools = allowedTools
    ? tools.filter((t) => allowedTools.includes((t as any).function.name))
    : tools;

  // Name resolution check to structurally enforce getEmployees tool choice
  let refersToOtherEmployee = false;
  let matchedName = "";
  if (["manager", "hr", "admin"].includes(userContext.role)) {
    try {
      const dbRes = await pool.query(
        `SELECT employee_code, name FROM employees WHERE is_active = true`
      );
      const lowerMessage = message.toLowerCase();
      const messageWords = lowerMessage.split(/[^a-zA-Z0-9]+/).filter(w => w.length >= 3);
      
      for (const row of dbRes.rows) {
        if (row.employee_code === userContext.employeeCode) continue;
        const nameParts = row.name.toLowerCase().split(/\s+/).filter((p: string) => p.length >= 3);
        const hasMatch = nameParts.some((part: string) => {
          return messageWords.some((word: string) => {
            return word === part || part.startsWith(word) || word.startsWith(part);
          });
        });
        if (hasMatch) {
          refersToOtherEmployee = true;
          matchedName = row.name;
          break;
        }
      }
    } catch (err) {
      console.error("[ERROR] Failed to check other employee names:", err);
    }
  }

  const currentUserBlock = `
CURRENT USER:
- Name: ${firstName}
- Employee Code: ${userContext.employeeCode}
- Employee ID: ${userContext.employeeId}
- Role: ${userContext.role}
- Department: ${userContext.department}
- LMS User ID: ${userContext.lmsUserId || userContext.employeeCode}
`;

  const dateBlock = `Today's date is ${today}. Current time is ${new Date().toLocaleTimeString()}.`;

  const resolutionRule = `CRITICAL EMPLOYEE RESOLUTION RULE: Whenever a user refers to another employee by name, nickname, or partial name (anything other than 'my' or 'me'), you MUST call getEmployees with the search parameter BEFORE calling any other tool that requires employeeCode. This applies even if a similar name appeared earlier in the conversation — always re-resolve via getEmployees, never reuse a previously guessed or remembered employeeCode. NEVER construct, invent, or pattern-match an employeeCode yourself under any circumstance. If getEmployees returns zero matches, respond: 'I could not find an employee matching [name].' If it returns multiple matches, list all of them by name and employeeCode and ask the user to clarify which one before proceeding. Only call other tools (getMyTasks, getTimesheetsByDate, etc.) once a single confirmed employeeCode is established from getEmployees results.`;

  const systemPrompt = userContext.agentSystemPrompt
    ? `${resolutionRule}

${userContext.agentSystemPrompt}

${dateBlock}

${currentUserBlock}

RETRIEVED DATABASE CONTEXT:
${contextStr}

EMPLOYEE MEMORY:
${memoriesStr || "No memories stored yet — this may be the first session."}

${instructions.substring(instructions.indexOf("IDENTITY:"))}`
    : `${resolutionRule}

${dateBlock}

${instructions}`;

  // 4. GPT call loop — intent detection, tool selection, and execution (up to 5 iterations for tool chaining)
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let currentMessages = [...messages];
  let loopCount = 0;
  const maxLoops = 5;

  while (loopCount < maxLoops) {
    loopCount++;

    // Force tool choice on the first iteration for non-conversational queries, or if name matches
    const isConversational = message.trim().split(/\s+/).length <= 2;
    let toolChoiceValue: any = "auto";
    if (loopCount === 1) {
      if (refersToOtherEmployee && filteredTools.some((t) => (t as any).function.name === "getEmployees")) {
        toolChoiceValue = { type: "function", function: { name: "getEmployees" } };
        console.log(`[RAG] Forcing tool_choice to getEmployees for name match: ${matchedName}`);
      } else if (!isConversational) {
        toolChoiceValue = "required";
      }
    }

    const model = userContext.overrideModel || (userContext.role === "admin"
      ? "gpt-5.4-mini"
      : "gpt-4o-mini");

    const response = await openai.chat.completions.create({
      model: model,
      messages: currentMessages,
      tools: filteredTools.length > 0 ? filteredTools : undefined,
      tool_choice: filteredTools.length > 0 ? toolChoiceValue : undefined,
      stream: true,
      stream_options: { include_usage: true },
    });

    let toolCallsToExecute: any[] = [];
    let responseText = "";

    for await (const chunk of response) {
      if ((chunk as any).usage) {
        onChunk({ type: "usage" as any, content: JSON.stringify((chunk as any).usage) });
      }
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        responseText += delta.content;
        onChunk({ type: "text", content: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallsToExecute[tc.index]) {
            toolCallsToExecute[tc.index] = { id: tc.id, name: tc.function?.name || "", arguments: "" };
          }
          if (tc.function?.arguments) {
            toolCallsToExecute[tc.index].arguments += tc.function.arguments;
          }
        }
      }
    }

    const activeToolCalls = toolCallsToExecute.filter(Boolean);

    if (activeToolCalls.length === 0) {
      // No tools requested; we are done.
      break;
    }

    // Append assistant tool calls message to currentMessages
    currentMessages.push({
      role: "assistant",
      content: responseText || null,
      tool_calls: activeToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    } as any);

    // Execute tool calls
    for (const tc of activeToolCalls) {
      if (!tc) continue;

      let args: any = {};
      try { args = JSON.parse(tc.arguments); } catch { }

      let toolResult: any = null;
      let resolvePromise: (value: any) => void = () => {};
      let rejectPromise: (reason: any) => void = () => {};
      let isCached = false;

      const callSignature = `${tc.name}:${JSON.stringify(args)}`;
      if (userContext.executionCache) {
        if (userContext.executionCache.has(callSignature)) {
          console.log(`[DEDUP] Skipping duplicate tool call: ${callSignature}`);
          try {
            toolResult = await userContext.executionCache.get(callSignature);
            isCached = true;
          } catch (err: any) {
            toolResult = { error: err.message || err };
            isCached = true;
          }
        } else {
          let resolveFn: any;
          let rejectFn: any;
          const promise = new Promise((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
          });
          resolvePromise = resolveFn;
          rejectPromise = rejectFn;
          userContext.executionCache.set(callSignature, promise);
        }
      }

      if (!isCached) {
        console.log(`Executing tool (loop ${loopCount}): ${tc.name}`, args);

        onChunk({
          type: "action_executed",
          action: tc.name,
          status: "executing",
          content: tc.arguments,
        });

        try {
          // ── READ TOOLS — return raw data to GPT ──────────────────────────────

        if (tc.name === "getMyTasks") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const res = await pmsPool.query(
            `SELECT pt.id, pt.task_name, pt.status, pt.priority, pt.start_date, pt.end_date, pt.progress, p.title as project_name
           FROM project_tasks pt
           INNER JOIN projects p ON pt.project_id = p.id
           WHERE LOWER(p.status) = 'in progress'
             AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
             AND (
               -- 1. Employee is explicitly assigned to this task
               EXISTS (
                 SELECT 1 FROM task_members tm
                 INNER JOIN employees e ON tm.employee_id = e.id
                 WHERE tm.task_id = pt.id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 2. Task belongs to a project mapped to the employee's department
               EXISTS (
                 SELECT 1 FROM project_departments pd
                 INNER JOIN employees e ON LOWER(e.department) = LOWER(pd.department)
                 WHERE pd.project_id = pt.project_id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 3. Task belongs to a project created by the employee
               EXISTS (
                 SELECT 1 FROM employees e
                 WHERE e.id = p.created_by_employee_id AND LOWER(e.emp_code) = LOWER($1)
               )
             )
           ORDER BY pt.end_date ASC NULLS LAST`,
            [targetEmpCode]
          );
          toolResult = { totalTasks: res.rows.length, tasks: res.rows.map((r) => ({ ...r, end_date: formatDate(r.end_date) })) };
        }

        else if (tc.name === "getMyTasksForPlan") {
          const res = await pmsPool.query(
            `SELECT pt.id, pt.task_name, pt.status, pt.priority, pt.end_date, pt.progress, p.title as project_name
             FROM project_tasks pt
             INNER JOIN projects p ON pt.project_id = p.id
             WHERE LOWER(p.status) = 'in progress'
               AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
               AND (
                 EXISTS (
                   SELECT 1 FROM task_members tm
                   INNER JOIN employees e ON tm.employee_id = e.id
                   WHERE tm.task_id = pt.id AND LOWER(e.emp_code) = LOWER($1)
                 )
                 OR EXISTS (
                   SELECT 1 FROM project_departments pd
                   INNER JOIN employees e ON LOWER(e.department) = LOWER(pd.department)
                   WHERE pd.project_id = pt.project_id AND LOWER(e.emp_code) = LOWER($1)
                 )
               )
             ORDER BY pt.priority DESC, pt.end_date ASC NULLS LAST`,
            [userContext.employeeCode]
          );

          const tasks = res.rows.map((r: any) => ({
            id: r.id,
            task_name: r.task_name,
            project_name: r.project_name,
            priority: r.priority || "Medium",
            end_date: formatDate(r.end_date),
            progress: r.progress || 0,
            status: r.status || "In Progress",
          }));

          // Trigger the frontend widget immediately
          onChunk({
            type: "interactive_task_plan",
            tasks,
          });

          toolResult = {
            widgetShown: true,
            totalTasks: tasks.length,
            message: "Task selection widget shown to employee.",
          };
        }

        else if (tc.name === "getMyLeaves") {
          let targetEmployeeCode = userContext.employeeCode;
          let targetLmsUserId = userContext.lmsUserId || userContext.employeeCode;

          if (args.employeeCode && args.employeeCode !== userContext.employeeCode) {
            if (!["manager", "admin", "hr"].includes(userContext.role)) {
              toolResult = { error: "Access denied: cannot view other employees' leaves." };
            } else {
              targetEmployeeCode = args.employeeCode;
              targetLmsUserId = args.employeeCode;
            }
          }

          if (!toolResult || !(toolResult as any).error) {
            let query = "SELECT * FROM leaves WHERE LOWER(user_id) = LOWER($1)";
            const params: any[] = [targetLmsUserId];
            if (args.status) { params.push(args.status); query += ` AND status ILIKE $${params.length}`; }
            query += " ORDER BY start_date DESC LIMIT 20";
            const res = await lmsPool.query(query, params);
            
            const balanceYear = new Date().getFullYear();
            const balance = await getEmployeeLeaveBalance(targetEmployeeCode, balanceYear);

            toolResult = {
              leaves: res.rows.map((r) => ({
                ...r,
                start_date: formatDate(r.start_date),
                end_date: formatDate(r.end_date),
              })),
              balance,
            };
          }
        }

        else if (tc.name === "getTimesheetsByDate") {
          console.log("[DEBUG] getTimesheetsByDate args:", JSON.stringify(args));
          let targetEmployeeId = userContext.employeeId;
          let targetEmployeeCode = userContext.employeeCode;

          if (args.employeeCode && args.employeeCode !== userContext.employeeCode) {
            if (!["manager", "admin", "hr"].includes(userContext.role)) {
              toolResult = { error: "Access denied: cannot view other employees' timesheets." };
            } else {
              const empRes = await pool.query("SELECT id FROM employees WHERE employee_code = $1", [args.employeeCode]);
              if (empRes.rows.length === 0) {
                toolResult = { error: `Employee ${args.employeeCode} not found.` };
              } else {
                targetEmployeeId = empRes.rows[0].id;
                targetEmployeeCode = args.employeeCode;
              }
            }
          }

          if (!toolResult) {
            // ── CASE 1: date range — use generate_series to get exact working days ──
            if (args.from_date && args.to_date) {
              // NOTE: time_entries.date is stored as TEXT (YYYY-MM-DD), not a date type.
              // generate_series returns timestamps; we extract date strings via TO_CHAR to avoid timezone drift.
              const calendarSql = `
                WITH
                working_days AS (
                  SELECT TO_CHAR(
                    generate_series(
                      $1::timestamp,
                      LEAST($2::timestamp, CURRENT_DATE::timestamp),
                      '1 day'::interval
                    ),
                    'YYYY-MM-DD'
                  ) AS work_date
                ),
                filtered_working_days AS (
                  SELECT work_date
                  FROM working_days
                  WHERE EXTRACT(DOW FROM work_date::date) != 0
                ),
                submitted AS (
                  SELECT DISTINCT date AS sub_date
                  FROM time_entries
                  WHERE employee_id = $3
                    AND date >= $1::date::text
                    AND date <= $2::date::text
                    AND status != 'draft'
                )
                SELECT
                  fwd.work_date,
                  CASE WHEN s.sub_date IS NOT NULL THEN 'submitted' ELSE 'not_submitted' END AS day_status
                FROM filtered_working_days fwd
                LEFT JOIN submitted s ON s.sub_date = fwd.work_date
                ORDER BY fwd.work_date
              `;
              const calendarRes = await pool.query(calendarSql, [args.from_date, args.to_date, targetEmployeeId]);


              const submittedDates = calendarRes.rows
                .filter((r: any) => r.day_status === 'submitted')
                .map((r: any) => r.work_date);

              const notSubmittedDays = calendarRes.rows
                .filter((r: any) => r.day_status === 'not_submitted')
                .map((r: any) => r.work_date);

              // Fetch full timesheet rows too (for detail display)
              const detailRes = await pool.query(
                `SELECT te.*, ds.submitted_at AS final_submitted_at
                 FROM time_entries te
                 LEFT JOIN daily_submissions ds ON te.employee_id = ds.employee_id AND te.date = ds.date
                 WHERE te.employee_id = $1 AND te.date BETWEEN $2 AND $3 
                 ORDER BY te.date DESC LIMIT 200`,
                [targetEmployeeId, args.from_date, args.to_date]
              );
              const mappedTimesheets = detailRes.rows.map((r: any) => ({
                ...r,
                date: formatDate(r.date),
                submitted_at: r.final_submitted_at || r.submitted_at,
              }));

              console.log("[DEBUG] from_date:", args.from_date, "to_date:", args.to_date);
              console.log("[DEBUG] total working days:", calendarRes.rows.length);
              console.log("[DEBUG] submittedDates:", submittedDates);
              console.log("[DEBUG] notSubmittedDays:", notSubmittedDays);

              toolResult = {
                employee: targetEmployeeCode,
                from: args.from_date,
                to: args.to_date,
                submittedDates,
                totalSubmittedDays: submittedDates.length,
                notSubmittedDays,
                totalNotSubmittedDays: notSubmittedDays.length,
                timesheets: mappedTimesheets,
              };

            // ── CASE 2: single date or no range ──────────────────────────────
            } else {
              let query = `
                SELECT te.*, ds.submitted_at AS final_submitted_at
                FROM time_entries te
                LEFT JOIN daily_submissions ds ON te.employee_id = ds.employee_id AND te.date = ds.date
                WHERE te.employee_id = $1
              `;
              const params: any[] = [targetEmployeeId];
              if (args.date) { params.push(args.date); query += ` AND te.date = $${params.length}`; }
              query += ` ORDER BY te.date DESC LIMIT 200`;
              const res = await pool.query(query, params);
              console.log("[DEBUG] getTimesheetsByDate (single date) result count:", res.rows.length);
              const mappedTimesheets = res.rows.map((r: any) => ({
                ...r,
                date: formatDate(r.date),
                submitted_at: r.final_submitted_at || r.submitted_at,
              }));
              const uniqueSubmittedDates = Array.from(
                new Set(
                  mappedTimesheets
                    .filter((r: any) => r.status && r.status !== 'draft')
                    .map((r: any) => r.date)
                )
              ).sort() as string[];
              toolResult = {
                employee: targetEmployeeCode,
                submittedDates: uniqueSubmittedDates,
                totalSubmittedDays: uniqueSubmittedDates.length,
                notSubmittedDays: [],
                totalNotSubmittedDays: 0,
                timesheets: mappedTimesheets,
              };
            }
          }
        }

        else if (tc.name === "getRecentTimesheets") {
          let targetEmployeeId = userContext.employeeId;
          let targetEmployeeCode = userContext.employeeCode;

          if (args.employeeCode && args.employeeCode !== userContext.employeeCode) {
            if (!["manager", "admin", "hr"].includes(userContext.role)) {
              toolResult = { error: "Access denied." };
            } else {
              const empRes = await pool.query("SELECT id FROM employees WHERE employee_code = $1", [args.employeeCode]);
              if (empRes.rows.length > 0) {
                targetEmployeeId = empRes.rows[0].id;
                targetEmployeeCode = args.employeeCode;
              }
            }
          }

          if (!toolResult) {
            const limit = args.limit ? Math.min(Number(args.limit), 20) : 5;
            const res = await pool.query(
              `SELECT te.*, ds.submitted_at AS final_submitted_at
               FROM time_entries te
               LEFT JOIN daily_submissions ds ON te.employee_id = ds.employee_id AND te.date = ds.date
               WHERE te.employee_id = $1
               ORDER BY COALESCE(ds.submitted_at, te.submitted_at) DESC, te.date DESC LIMIT $2`,
              [targetEmployeeId, limit]
            );
            console.log("[DEBUG] getRecentTimesheets result count:", res.rows.length);
            const mappedTimesheets = res.rows.map((r: any) => ({
              ...r,
              date: formatDate(r.date),
              submitted_at: r.final_submitted_at || r.submitted_at,
              start_time: r.start_time || "Time not set",
              end_time: r.end_time || "Time not set",
            }));
            toolResult = { employee: targetEmployeeCode, timesheets: mappedTimesheets };
          }
        }

        else if (tc.name === "viewPendingLeaves") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers/HR/admin can view pending leaves." };
          } else {
            const res = await lmsPool.query("SELECT * FROM leaves WHERE status ILIKE 'pending' LIMIT 20");
            toolResult = { pending_leaves: res.rows };
          }
        }

        // ── ACTION TOOLS — execute and return outcome to GPT ─────────────────

        else if (tc.name === "approveLeaveRequest") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            await lmsPool.query("UPDATE leaves SET status = 'Approved' WHERE id = $1", [args.leaveId]);
            toolResult = { success: true, action: "approveLeave", leaveId: args.leaveId };
            onChunk({ type: "action_executed", action: "approveLeaveRequest", status: "success" });
          }
        }

        else if (tc.name === "rejectLeaveRequest") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            await lmsPool.query("UPDATE leaves SET status = 'Rejected' WHERE id = $1", [args.leaveId]);
            toolResult = { success: true, action: "rejectLeave", leaveId: args.leaveId };
            onChunk({ type: "action_executed", action: "rejectLeaveRequest", status: "success" });
          }
        }

        else if (tc.name === "markTaskComplete") {
          const taskRes = await pmsPool.query("SELECT * FROM project_tasks WHERE id = $1::uuid", [args.taskId]);
          const task = taskRes.rows[0];
          if (!task) {
            toolResult = { error: `Task ${args.taskId} not found.` };
          } else {
            if (userContext.role === "employee") {
              const memberRes = await pmsPool.query(
                `SELECT 1 FROM task_members tm
               INNER JOIN employees e ON tm.employee_id = e.id
               WHERE tm.task_id = $1::uuid AND LOWER(e.emp_code) = LOWER($2)`,
                [args.taskId, userContext.employeeCode]
              );
              if (memberRes.rows.length === 0) {
                toolResult = { error: "Access denied: you can only complete your own tasks." };
              }
            }
            if (!toolResult) {
              await pmsPool.query(
                "UPDATE project_tasks SET status = 'Completed', progress = 100, updated_at = NOW(), completed_at = NOW() WHERE id = $1::uuid",
                [args.taskId]
              );
              toolResult = { success: true, action: "markTaskComplete", taskName: task.task_name };
              onChunk({ type: "action_executed", action: "markTaskComplete", status: "success" });
            }
          }
        }

        else if (tc.name === "assignTaskToEmployee") {
          const empRes = await pmsPool.query(
            "SELECT id, name FROM employees WHERE LOWER(emp_code) = LOWER($1)",
            [args.employeeCode]
          );
          if (empRes.rows.length === 0) {
            toolResult = { error: `Employee ${args.employeeCode} not found.` };
          } else {
            await pmsPool.query("DELETE FROM task_members WHERE task_id = $1::uuid", [args.taskId]);
            await pmsPool.query("INSERT INTO task_members (task_id, employee_id) VALUES ($1::uuid, $2::uuid)", [args.taskId, empRes.rows[0].id]);
            await pmsPool.query("UPDATE project_tasks SET updated_at = NOW() WHERE id = $1::uuid", [args.taskId]);
            toolResult = { success: true, action: "assignTask", assignedTo: empRes.rows[0].name, employeeCode: args.employeeCode };
            onChunk({ type: "action_executed", action: "assignTaskToEmployee", status: "success" });
          }
        }

        else if (tc.name === "updateTaskDeadline") {
          await pmsPool.query("UPDATE project_tasks SET end_date = $2, updated_at = NOW() WHERE id = $1::uuid", [args.taskId, args.deadline]);
          toolResult = { success: true, action: "updateDeadline", taskId: args.taskId, newDeadline: args.deadline };
          onChunk({ type: "action_executed", action: "updateTaskDeadline", status: "success" });
        }

        else if (tc.name === "approveTimesheet") {
          if (!["manager", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            const updated = userContext.role === "admin"
              ? await storage.adminApproveTimeEntry(args.timesheetId, userContext.employeeId)
              : await storage.managerApproveTimeEntry(args.timesheetId, userContext.employeeId);
            toolResult = updated
              ? { success: true, action: "approveTimesheet", employee: updated.employeeName, date: updated.date }
              : { error: "Timesheet not found." };
            if (updated) onChunk({ type: "action_executed", action: "approveTimesheet", status: "success" });
          }
        }

        else if (tc.name === "rejectTimesheet") {
          if (!["manager", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            const updated = await storage.updateTimeEntryStatus(args.timesheetId, "rejected", userContext.employeeId, "Rejected by ARIA");
            toolResult = updated
              ? { success: true, action: "rejectTimesheet", employee: updated.employeeName, date: updated.date }
              : { error: "Timesheet not found." };
            if (updated) onChunk({ type: "action_executed", action: "rejectTimesheet", status: "success" });
          }
        }

        else if (tc.name === "submitTimesheet") {
          const empRes = await pool.query("SELECT name FROM employees WHERE id = $1", [userContext.employeeId]);
          const employeeName = empRes.rows[0]?.name || userContext.employeeCode;
          const totalHours = calcHours(args.startTime, args.endTime);
          const entryId = randomUUID();

          await pool.query(
            `INSERT INTO time_entries (
             id, employee_id, employee_code, employee_name, date, project_name,
             task_description, problem_and_issues, quantify, achievements,
             scope_of_improvements, tools_used, start_time, end_time, total_hours,
             percentage_complete, status, manager_approved, submitted_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())`,
            [
              entryId, userContext.employeeId, userContext.employeeCode, employeeName,
              args.date, args.projectName, args.taskDescription,
              args.problemAndIssues || "", args.quantify || "N/A",
              args.achievements || "", args.scopeOfImprovements || "",
              args.toolsUsed || [], args.startTime, args.endTime,
              totalHours, args.percentageComplete ?? 100, "pending", false,
            ]
          );
          toolResult = {
            success: true, action: "submitTimesheet",
            project: args.projectName, date: args.date,
            hours: totalHours, task: args.taskDescription,
          };
          onChunk({ type: "action_executed", action: "submitTimesheet", status: "success" });
        }

        else if (tc.name === "requestLeave") {
          console.log("[DEBUG] requestLeave args received:", JSON.stringify(args));
          // Validate required fields — never silently default
          if (!args.leaveType) {
            toolResult = { error: "Please specify the leave type — Casual, Sick, Privilege, Maternity, or Paternity." };
          } else if (!args.leaveDurationType) {
            toolResult = { error: "Please specify the duration — Full Day or Half Day." };
          } else if (!args.reason) {
            toolResult = { error: "Please specify the reason for your leave request." };
          } else {
            const empRes = await pool.query("SELECT name FROM employees WHERE id = $1", [userContext.employeeId]);
            const employeeName = empRes.rows[0]?.name || userContext.employeeCode;
            const insertRes = await lmsPool.query(
              `INSERT INTO leaves (user_id, leave_type, start_date, end_date, reason, status, username, leave_duration_type, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
              [
                userContext.employeeCode, args.leaveType,
                args.startDate, args.endDate, args.reason || "",
                "Pending", employeeName, args.leaveDurationType,
              ]
            );
            toolResult = {
              success: true, action: "requestLeave",
              leaveId: insertRes.rows[0]?.id,
              leaveType: args.leaveType, startDate: args.startDate,
              endDate: args.endDate, reason: args.reason,
            };
            onChunk({ type: "action_executed", action: "requestLeave", status: "success" });
          }
        }

        else if (tc.name === "createTask") {
          const projRes = await pmsPool.query(
            "SELECT id, title FROM projects WHERE project_code = $1 OR LOWER(title) = LOWER($1)",
            [args.projectCode]
          );
          if (projRes.rows.length === 0) {
            toolResult = { error: `Project "${args.projectCode}" not found.` };
          } else {
            const projectId = projRes.rows[0].id;
            const projectTitle = projRes.rows[0].title;

            let assignerId: string | null = null;
            const assignerRes = await pmsPool.query("SELECT id FROM employees WHERE LOWER(emp_code) = LOWER($1)", [userContext.employeeCode]);
            if (assignerRes.rows.length > 0) {
              assignerId = assignerRes.rows[0].id;
            } else {
              const fallback = await pmsPool.query("SELECT id FROM employees LIMIT 1");
              if (fallback.rows.length > 0) assignerId = fallback.rows[0].id;
            }

            if (!assignerId) {
              toolResult = { error: "Assigner not found in PMS." };
            } else {
              const taskId = randomUUID();
              const startDate = args.startDate || today;
              const endDate = args.endDate || today;

              await pmsPool.query(
                `INSERT INTO project_tasks (id, project_id, assigner_id, task_name, description, status, priority, start_date, end_date, progress, created_at, updated_at)
               VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
                [taskId, projectId, assignerId, args.taskName, args.description || "",
                  args.status || "In Progress", args.priority || "Medium", startDate, endDate, args.progress || 0]
              );

              let assignedToName = "";
              if (args.assigneeCode) {
                const empRes = await pmsPool.query(
                  "SELECT id, name FROM employees WHERE LOWER(emp_code) = LOWER($1) OR LOWER(name) = LOWER($1)",
                  [args.assigneeCode]
                );
                if (empRes.rows.length > 0) {
                  assignedToName = empRes.rows[0].name;
                  await pmsPool.query("INSERT INTO task_members (task_id, employee_id) VALUES ($1::uuid, $2::uuid)", [taskId, empRes.rows[0].id]);
                }
              }

              toolResult = {
                success: true, action: "createTask",
                taskName: args.taskName, project: projectTitle,
                deadline: endDate, assignedTo: assignedToName || "unassigned",
              };
              onChunk({ type: "action_executed", action: "createTask", status: "success" });
            }
          }
        }

        // ── SPECIAL TOOL — interactive widget, stream directly ───────────────



        else if (tc.name === "getEmployees") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied. Only managers, HR, and admins can query employee information." };
          } else {
            let query = `SELECT id, employee_code as "employeeCode", name, email, role, department, group_name as "groupName", is_active as "isActive" FROM employees WHERE 1=1`;
            const params: any[] = [];

            if (args.department) {
              params.push(args.department);
              query += ` AND department ILIKE $${params.length}`;
            }
            if (args.role) {
              params.push(args.role);
              query += ` AND role ILIKE $${params.length}`;
            }
            if (args.isActive !== undefined) {
              params.push(args.isActive);
              query += ` AND is_active = $${params.length}`;
            }
            if (args.search) {
              // Split on whitespace so "mohan raj" → ['mohan','raj'] and each word
              // is matched separately with AND. This fixes the case where the user
              // types a name with a space (e.g. "mohan raj") but the DB stores it
              // without one (e.g. "Mohanraj C"). Single-word searches fall through
              // to the original substring behaviour unchanged.
              const searchWords = String(args.search).trim().split(/\s+/).filter(Boolean);
              if (searchWords.length > 1) {
                const nameClauses = searchWords.map((w) => {
                  params.push(`%${w}%`);
                  return `name ILIKE $${params.length}`;
                });
                // email / employee_code still match against the full original string
                params.push(`%${args.search}%`);
                const fullIdx = params.length;
                query += ` AND ((${nameClauses.join(" AND ")}) OR email ILIKE $${fullIdx} OR employee_code ILIKE $${fullIdx})`;
              } else {
                // Single word — original behaviour: substring on name, email, code
                params.push(`%${args.search}%`);
                query += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR employee_code ILIKE $${params.length})`;
              }
            }

            query += ` ORDER BY name ASC LIMIT 100`;
            const res = await pool.query(query, params);
            toolResult = { employees: res.rows };
          }
        }

        else if (tc.name === "getTeamData") {
          // Security — employees cannot access team data
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers, HR, and admins can view team data." };
          } else {

            if (args.dataType === "timesheets") {
              console.log("[DEBUG] getTeamData/timesheets args:", JSON.stringify(args));
              // Build flexible timesheet query across all employees
              let query = `
              SELECT 
                te.employee_code, te.employee_name, te.date,
                te.project_name, te.task_description, te.total_hours,
                te.status, te.manager_approved, 
                COALESCE(ds.submitted_at, te.submitted_at) AS submitted_at,
                te.percentage_complete
              FROM time_entries te
              INNER JOIN employees e ON te.employee_id = e.id
              LEFT JOIN daily_submissions ds ON te.employee_id = ds.employee_id AND te.date = ds.date
              WHERE e.is_active = true
            `;
              const params: any[] = [];

              if (args.department) {
                params.push(args.department);
                query += ` AND LOWER(e.department) = LOWER($${params.length})`;
              }
              if (args.employeeCode) {
                params.push(args.employeeCode);
                query += ` AND LOWER(te.employee_code) = LOWER($${params.length})`;
              }
              if (args.date) {
                params.push(args.date);
                query += ` AND te.date = $${params.length}`;
              } else if (args.startDate && args.endDate) {
                params.push(args.startDate, args.endDate);
                query += ` AND te.date BETWEEN $${params.length - 1} AND $${params.length}`;
              }
              if (args.status) {
                if (args.status.toLowerCase() === "submitted") {
                  query += ` AND te.status != 'draft'`;
                } else if (args.status.toLowerCase() === "not_submitted") {
                  query += ` AND te.status = 'draft'`;
                } else {
                  params.push(args.status);
                  query += ` AND LOWER(te.status) = LOWER($${params.length})`;
                }
              }

              query += ` ORDER BY te.date DESC, te.employee_name ASC LIMIT 200`;

              const res = await pool.query(query, params);
              console.log("[DEBUG] getTeamData/timesheets row count:", res.rows.length);

              // ── If date range + employeeCode: compute submitted/not-submitted via generate_series ──
              let submittedDates: string[] = [];
              let notSubmittedDays: string[] = [];
              const fromD = args.startDate || args.from_date;
              const toD = args.endDate || args.to_date;

              if (fromD && toD && args.employeeCode) {
                const calendarSql = `
                  WITH
                  working_days AS (
                    SELECT TO_CHAR(
                      generate_series(
                        $1::timestamp,
                        LEAST($2::timestamp, CURRENT_DATE::timestamp),
                        '1 day'::interval
                      ),
                      'YYYY-MM-DD'
                    ) AS work_date
                  ),
                  filtered_working_days AS (
                    SELECT work_date FROM working_days
                    WHERE EXTRACT(DOW FROM work_date::date) != 0
                  ),
                  submitted AS (
                    SELECT DISTINCT date AS sub_date FROM time_entries
                    WHERE LOWER(employee_code) = LOWER($3)
                      AND date >= $1::date::text AND date <= $2::date::text
                      AND status != 'draft'
                  )
                  SELECT
                    fwd.work_date,
                    CASE WHEN s.sub_date IS NOT NULL THEN 'submitted' ELSE 'not_submitted' END AS day_status
                  FROM filtered_working_days fwd
                  LEFT JOIN submitted s ON s.sub_date = fwd.work_date
                  ORDER BY fwd.work_date
                `;
                const calendarRes = await pool.query(calendarSql, [fromD, toD, args.employeeCode]);
                submittedDates = calendarRes.rows.filter((r: any) => r.day_status === 'submitted').map((r: any) => r.work_date);
                notSubmittedDays = calendarRes.rows.filter((r: any) => r.day_status === 'not_submitted').map((r: any) => r.work_date);
                console.log("[DEBUG] getTeamData calendar — submittedDates:", submittedDates);
                console.log("[DEBUG] getTeamData calendar — notSubmittedDays:", notSubmittedDays);
              }

              // Also fetch who has NOT submitted for a specific single date
              let notSubmittedToday: any[] = [];
              if (args.date || (!args.startDate && !args.endDate && !args.from_date && !args.to_date)) {
                const targetDate = args.date || today;
                const submittedCodes = res.rows.map((r) => r.employee_code);
                const allEmpQuery = args.department
                  ? `SELECT employee_code, name FROM employees WHERE is_active = true AND LOWER(department) = LOWER($1)`
                  : `SELECT employee_code, name FROM employees WHERE is_active = true`;
                const allEmpRes = args.department
                  ? await pool.query(allEmpQuery, [args.department])
                  : await pool.query(allEmpQuery);
                notSubmittedToday = allEmpRes.rows.filter(
                  (e) => !submittedCodes.includes(e.employee_code)
                );
              }

              // ── Backend Lateness & Submission Compliance Check ──
              const fromStr = args.startDate || args.from_date || args.date || today;
              const toStr = args.endDate || args.to_date || args.date || today;

              const workDates: string[] = [];
              const [sY, sM, sD] = fromStr.split("-").map(Number);
              const [eY, eM, eD] = toStr.split("-").map(Number);
              const startDt = new Date(Date.UTC(sY, sM - 1, sD));
              const endDt = new Date(Date.UTC(eY, eM - 1, eD));
              const tempDt = new Date(startDt);
              while (tempDt <= endDt) {
                if (tempDt.getUTCDay() !== 0) { // Exclude Sundays
                  const yyyy = tempDt.getUTCFullYear();
                  const mm = String(tempDt.getUTCMonth() + 1).padStart(2, "0");
                  const dd = String(tempDt.getUTCDate()).padStart(2, "0");
                  workDates.push(`${yyyy}-${mm}-${dd}`);
                }
                tempDt.setUTCDate(tempDt.getUTCDate() + 1);
              }

              let empQuery = "SELECT id, name, employee_code, department FROM employees WHERE is_active = true";
              const empParams: any[] = [];
              if (args.department) {
                empParams.push(args.department);
                empQuery += ` AND LOWER(department) = LOWER($1)`;
              }
              const empRes = await pool.query(empQuery, empParams);
              const employeesList = empRes.rows;

              const subRes = await pool.query(
                `SELECT employee_id, date, submitted_at FROM daily_submissions WHERE date BETWEEN $1 AND $2`,
                [fromStr, toStr]
              );
              const subMap = new Map<string, Date>();
              for (const row of subRes.rows) {
                if (row.submitted_at) {
                  subMap.set(`${row.employee_id}_${row.date}`, new Date(row.submitted_at));
                }
              }

              const entriesRes = await pool.query(
                `SELECT employee_id, date, status, submitted_at FROM time_entries WHERE date BETWEEN $1 AND $2`,
                [fromStr, toStr]
              );
              const entriesMap = new Map<string, { statuses: Set<string>, submittedAtMax?: Date }>();
              for (const row of entriesRes.rows) {
                const key = `${row.employee_id}_${row.date}`;
                if (!entriesMap.has(key)) {
                  entriesMap.set(key, { statuses: new Set<string>() });
                }
                const data = entriesMap.get(key)!;
                if (row.status) {
                  data.statuses.add(row.status.toLowerCase());
                }
                if (row.submitted_at) {
                  const t = new Date(row.submitted_at);
                  if (!data.submittedAtMax || t > data.submittedAtMax) {
                    data.submittedAtMax = t;
                  }
                }
              }

              const complianceSummary: any[] = [];
              const now = new Date();

              for (const emp of employeesList) {
                if (args.employeeCode && emp.employee_code.toLowerCase() !== args.employeeCode.toLowerCase()) {
                  continue;
                }
                for (const dtStr of workDates) {
                  const key = `${emp.id}_${dtStr}`;
                  const dsSubTime = subMap.get(key);
                  const entryData = entriesMap.get(key);

                  const [wY, wM, wD] = dtStr.split("-").map(Number);
                  const deadlineDateLocal = new Date(wY, wM - 1, wD + 1, 12, 0, 0, 0);

                  let status = "Missing";
                  let submittedAt: string | null = null;
                  let isLate = false;

                  if (dsSubTime) {
                    status = "Submitted";
                    submittedAt = dsSubTime.toISOString();
                  } else if (entryData) {
                    const hasNonDraft = Array.from(entryData.statuses).some(s => s !== "draft");
                    if (hasNonDraft) {
                      status = "Submitted";
                      const [y, m, d] = dtStr.split("-").map(Number);
                      const subTime = entryData.submittedAtMax || new Date(y, m - 1, d);
                      submittedAt = subTime.toISOString();
                    } else {
                      status = "Draft";
                    }
                  } else {
                    status = "Missing";
                  }

                  if (!submittedAt) {
                    isLate = false;
                  } else {
                    const submittedTime = new Date(submittedAt);
                    if (submittedTime.getTime() > deadlineDateLocal.getTime()) {
                      isLate = true;
                    } else {
                      isLate = false;
                    }
                  }

                  complianceSummary.push({
                    employeeName: emp.name,
                    employeeCode: emp.employee_code,
                    department: emp.department,
                    date: dtStr,
                    status,
                    submittedAt,
                    late: isLate
                  });
                }
              }

              const deduplicateByEmployee = (arr: any[]) => {
                const seen = new Map<string, any>();
                for (const item of arr) {
                  const key = item.employeeCode;
                  if (!seen.has(key)) {
                    seen.set(key, {
                      ...item,
                      dates: [item.date]
                    });
                  } else {
                    const existing = seen.get(key);
                    if (!existing.dates.includes(item.date)) {
                      existing.dates.push(item.date);
                    }
                  }
                }
                return Array.from(seen.values()).map(item => ({
                  employeeName: item.employeeName,
                  employeeCode: item.employeeCode,
                  department: item.department,
                  status: item.status,
                  late: item.late,
                  date: item.dates.join(", ")
                }));
              };

              const lateSubmissions = deduplicateByEmployee(complianceSummary.filter(s => s.late && s.status === "Submitted"));
              const missingSubmissions = deduplicateByEmployee(complianceSummary.filter(s => s.status === "Missing" || s.status === "Draft"));
              const onTimeSubmissions = deduplicateByEmployee(complianceSummary.filter(s => s.status === "Submitted" && !s.late));

              const lightweightTimesheets = res.rows.slice(0, 20).map((r: any) => ({
                employee_code: r.employee_code,
                employee_name: r.employee_name,
                date: r.date,
                project_name: r.project_name,
                total_hours: r.total_hours,
                status: r.status,
                manager_approved: r.manager_approved,
                submitted_at: r.submitted_at,
                percentage_complete: r.percentage_complete
              }));

              if (args.complianceMode === "late") {
                // Return ONLY the compliance array — no raw time_entries noise
                // that could cause GPT to cross-contaminate employee names.
                toolResult = {
                  dataType: "timesheets",
                  complianceMode: "late",
                  totalLate: lateSubmissions.length,
                  lateSubmissions,
                };
              } else if (args.complianceMode === "missing") {
                toolResult = {
                  dataType: "timesheets",
                  complianceMode: "missing",
                  totalMissing: missingSubmissions.length,
                  missingSubmissions,
                };
              } else if (args.complianceMode === "ontime") {
                toolResult = {
                  dataType: "timesheets",
                  complianceMode: "ontime",
                  totalOnTime: onTimeSubmissions.length,
                  onTimeSubmissions,
                };
              } else if (args.complianceMode === "all") {
                // 'all' mode: return all four compliance arrays, still no raw rows
                toolResult = {
                  dataType: "timesheets",
                  complianceMode: "all",
                  totalLate: lateSubmissions.length,
                  totalMissing: missingSubmissions.length,
                  totalOnTime: onTimeSubmissions.length,
                  lateSubmissions,
                  missingSubmissions,
                  onTimeSubmissions,
                };
              } else {
                // No complianceMode — return raw timesheets for general queries
                toolResult = {
                  dataType: "timesheets",
                  totalEntries: res.rows.length,
                  timesheets: lightweightTimesheets,
                  submittedDates,
                  totalSubmittedDays: submittedDates.length,
                  notSubmittedDays,
                  totalNotSubmittedDays: notSubmittedDays.length,
                  notSubmittedToday,
                  complianceSummary,
                  lateSubmissions,
                  missingSubmissions,
                  onTimeSubmissions,
                };
              }
            }

            else if (args.dataType === "tasks") {
              // Fetch tasks across the whole team from PMS
              let query = `
              SELECT 
                pt.id, pt.task_name, pt.status, pt.priority,
                pt.start_date, pt.end_date, pt.progress,
                p.title as project_name,
                e.name as assigned_to, e.emp_code as employee_code
              FROM project_tasks pt
              INNER JOIN projects p ON pt.project_id = p.id
              LEFT JOIN task_members tm ON pt.id = tm.task_id
              LEFT JOIN employees e ON tm.employee_id = e.id
              WHERE 1=1
            `;
              const params: any[] = [];

              if (args.employeeCode) {
                params.push(args.employeeCode);
                query += ` AND LOWER(e.emp_code) = LOWER($${params.length})`;
              }
              if (args.status) {
                params.push(args.status);
                query += ` AND LOWER(pt.status) = LOWER($${params.length})`;
              }
              if (args.endDate) {
                params.push(args.endDate);
                query += ` AND pt.end_date <= $${params.length}`;
              }

              query += ` ORDER BY pt.end_date ASC NULLS LAST LIMIT 50`;

              const res = await pmsPool.query(query, params);

              // Calculate overdue
              const overdue = res.rows.filter(
                (r) => r.end_date && new Date(r.end_date) < new Date() && r.status?.toLowerCase() !== "completed"
              );

              toolResult = {
                dataType: "tasks",
                totalTasks: res.rows.length,
                overdueTasks: overdue.length,
                tasks: res.rows.map((r) => ({
                  ...r,
                  start_date: formatDate(r.start_date),
                  end_date: formatDate(r.end_date),
                })),
              };
            }

            else if (args.dataType === "leaves") {
              let query = `
              SELECT 
                user_id as employee_code, username as employee_name,
                leave_type, start_date, end_date,
                status, reason, leave_duration_type
              FROM leaves
              WHERE 1=1
            `;
              const params: any[] = [];

              if (args.employeeCode) {
                params.push(args.employeeCode);
                query += ` AND LOWER(user_id) = LOWER($${params.length})`;
              }
              if (args.status) {
                params.push(args.status);
                query += ` AND LOWER(status) = LOWER($${params.length})`;
              }
              if (args.startDate && args.endDate) {
                params.push(args.startDate, args.endDate);
                query += ` AND start_date BETWEEN $${params.length - 1} AND $${params.length}`;
              } else {
                const targetDate = args.date || today;
                params.push(targetDate);
                query += ` AND $${params.length} BETWEEN start_date AND end_date`;
              }

              query += ` ORDER BY start_date DESC LIMIT 50`;

              const res = await lmsPool.query(query, params);

              toolResult = {
                dataType: "leaves",
                totalLeaves: res.rows.length,
                leaves: res.rows.map((r) => ({
                  ...r,
                  start_date: formatDate(r.start_date),
                  end_date: formatDate(r.end_date),
                })),
              };
            }

            else if (args.dataType === "employees") {
              let query = `
              SELECT 
                employee_code, name, department, role,
                group_name, is_active, created_at
              FROM employees
              WHERE is_active = true
            `;
              const params: any[] = [];

              if (args.department) {
                params.push(args.department);
                query += ` AND LOWER(department) = LOWER($${params.length})`;
              }
              if (args.status === "inactive") {
                query = query.replace("is_active = true", "is_active = false");
              }

              query += ` ORDER BY name ASC`;

              const res = await pool.query(query, params);

              toolResult = {
                dataType: "employees",
                totalEmployees: res.rows.length,
                employees: res.rows,
              };
            }
          }
        }

        else if (tc.name === "getDraftTimesheets") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers, HR, and admins can view draft timesheets." };
          } else {
            const res = await pool.query(`
              SELECT DISTINCT employee_code, employee_name as name
              FROM time_entries
              WHERE status = 'draft'
            `);
            toolResult = {
              count: res.rows.length,
              employees: res.rows
            };
          }
        }

        else if (tc.name === "getPendingApprovals") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers, HR, and admins can view pending approvals." };
          } else {
            // Fetch leaves where status is Pending
            const leavesRes = await lmsPool.query(`
              SELECT id, user_id as employee_code, username as employee_name, leave_type, start_date, end_date, status, reason
              FROM leaves
              WHERE status = 'Pending'
              ORDER BY start_date DESC
            `);
            const pendingLeaves = leavesRes.rows.map(r => ({
              ...r,
              start_date: formatDate(r.start_date),
              end_date: formatDate(r.end_date)
            }));

            // Fetch timesheet entries where status is pending
            const timesheetsRes = await pool.query(`
              SELECT te.id, te.employee_code, te.employee_name, te.date, te.project_name, te.task_description, te.total_hours, te.status
              FROM time_entries te
              INNER JOIN employees e ON te.employee_id = e.id
              WHERE te.status = 'pending' AND e.is_active = true
              ORDER BY te.date DESC
            `);
            const pendingTimesheets = timesheetsRes.rows;

            toolResult = {
              pendingLeaves: {
                count: pendingLeaves.length,
                items: pendingLeaves
              },
              pendingTimesheets: {
                count: pendingTimesheets.length,
                items: pendingTimesheets
              },
              totalPending: pendingLeaves.length + pendingTimesheets.length
            };
          }
        }

        else if (tc.name === "getEmployeeDetail") {
          // Security — employees cannot view other employees' details
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers, HR, and admins can view employee details." };
          } else {
            const code = args.employeeCode;

            // 1. Profile from main DB
            const profileRes = await pool.query(
              `SELECT employee_code, name, email, department, role, group_name, is_active, created_at
             FROM employees WHERE LOWER(employee_code) = LOWER($1)`,
              [code]
            );

            if (profileRes.rows.length === 0) {
              toolResult = { error: `Employee ${code} not found.` };
            } else {
              const profile = profileRes.rows[0];

              // 2. Recent timesheets (last 7 days)
              const timesheetRes = await pool.query(
                `SELECT date, project_name, task_description, total_hours, status
               FROM time_entries
               WHERE LOWER(employee_code) = LOWER($1)
               ORDER BY date DESC LIMIT 10`,
                [code]
              );

              // 3. Active tasks from PMS
              const taskRes = await pmsPool.query(
                `SELECT pt.task_name, pt.status, pt.progress, pt.end_date, p.title as project_name
               FROM project_tasks pt
               INNER JOIN projects p ON pt.project_id = p.id
               INNER JOIN task_members tm ON pt.id = tm.task_id
               INNER JOIN employees e ON tm.employee_id = e.id
               WHERE LOWER(e.emp_code) = LOWER($1)
                 AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
               ORDER BY pt.end_date ASC NULLS LAST`,
                [code]
              );

              // 4. Leave history from LMS
              const leaveRes = await lmsPool.query(
                `SELECT leave_type, start_date, end_date, status, reason
               FROM leaves
               WHERE LOWER(user_id) = LOWER($1)
               ORDER BY start_date DESC LIMIT 5`,
                [code]
              );

              const currentYear = new Date().getFullYear();
              const leaveBalance = await getEmployeeLeaveBalance(code, currentYear);

              toolResult = {
                profile,
                activeTasks: taskRes.rows.map((r) => ({
                  ...r,
                  end_date: formatDate(r.end_date),
                })),
                recentTimesheets: timesheetRes.rows,
                leaveHistory: leaveRes.rows.map((r) => ({
                  ...r,
                  start_date: formatDate(r.start_date),
                  end_date: formatDate(r.end_date),
                })),
                leaveBalance,
              };
            }
          }
        }

        else if (tc.name === "getMyProjects") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const res = await pmsPool.query(
            `SELECT DISTINCT
             p.id,
             p.title as project_name,
             p.project_code,
             p.client_name,
             p.status,
             p.end_date,
             p.progress as progress_percentage
           FROM projects p
           WHERE LOWER(p.status) = 'in progress'
             AND (
               -- 1. Employee is assigned to a task in the project
               EXISTS (
                 SELECT 1 FROM project_tasks pt
                 INNER JOIN task_members tm ON pt.id = tm.task_id
                 INNER JOIN employees e ON tm.employee_id = e.id
                 WHERE pt.project_id = p.id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 2. Employee created the project
               EXISTS (
                 SELECT 1 FROM employees e
                 WHERE e.id = p.created_by_employee_id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 3. Employee's department is mapped to the project
               EXISTS (
                 SELECT 1 FROM project_departments pd
                 INNER JOIN employees e ON LOWER(e.department) = LOWER(pd.department)
                 WHERE pd.project_id = p.id AND LOWER(e.emp_code) = LOWER($1)
               )
             )
           ORDER BY project_name`,
            [targetEmpCode]
          );
          toolResult = {
            totalProjects: res.rows.length,
            projects: res.rows,
          };
        }

        else if (tc.name === "getProjectKeySteps") {
          const res = await pmsPool.query(
            `SELECT ks.id, ks.title AS name
           FROM key_steps ks
           INNER JOIN projects p ON ks.project_id = p.id
           WHERE p.project_code = $1
           ORDER BY ks.title`,
            [args.projectCode]
          );
          toolResult = {
            projectCode: args.projectCode,
            keySteps: res.rows,
          };
        }

        else if (tc.name === "getProjectSubtasks") {
          const res = await pmsPool.query(
            `SELECT s.id, s.title, s.description, s.progress,
                  e.emp_code as assigned_emp_code
           FROM subtasks s
           LEFT JOIN employees e
             ON s.assigned_to::text = e.id::text
             OR s.assigned_to::text = e.emp_code::text
           WHERE s.task_id = $1::uuid
             AND (s.is_completed = false OR s.is_completed IS NULL)
             AND (s.progress < 100 OR s.progress IS NULL)`,
            [args.taskId]
          );
          toolResult = {
            taskId: args.taskId,
            subtasks: res.rows,
          };
        }

        else if (tc.name === "submitTimesheetEntry") {
          const empRes = await pool.query(
            "SELECT name FROM employees WHERE id = $1",
            [userContext.employeeId]
          );
          const employeeName = empRes.rows[0]?.name || userContext.employeeCode;
          const totalHours = calcHours(args.startTime, args.endTime);
          const entryDate = args.date || today;
          const entryId = randomUUID();

          await pool.query(
            `INSERT INTO time_entries (
             id, employee_id, employee_code, employee_name, date, project_name,
             task_description, problem_and_issues, quantify, achievements,
             scope_of_improvements, tools_used, start_time, end_time, total_hours,
             percentage_complete, status, manager_approved, submitted_at,
             pms_id, pms_subtask_id, key_step
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19,$20,$21
           )`,
            [
              entryId,
              userContext.employeeId,
              userContext.employeeCode,
              employeeName,
              entryDate,
              args.projectName,
              args.taskDescription,
              args.problemAndIssues || "",
              args.quantify || "N/A",
              args.achievements || "",
              args.scopeOfImprovements || "",
              args.toolsUsed || [],
              args.startTime,
              args.endTime,
              totalHours,
              args.percentageComplete ?? 100,
              "pending",
              false,
              args.pmsId || null,
              args.pmsSubtaskId || null,
              args.keyStep || null,
            ]
          );

          toolResult = {
            success: true,
            action: "submitTimesheetEntry",
            entryId,
            project: args.projectName,
            task: args.taskDescription,
            date: entryDate,
            hours: totalHours,
            keyStep: args.keyStep || null,
            message: "Entry saved. Add more tasks or say done to finalize.",
          };
        }

        else if (tc.name === "finalizeTimesheetSubmission") {
          const finalizeDate = args.date || today;
          const port = process.env.PORT || 5003;

          const response = await fetch(
            `http://localhost:${port}/api/time-entries/submit-daily/${userContext.employeeId}/${finalizeDate}`,
            { method: "POST" }
          );

          const result = await response.json().catch(() => ({}));

          toolResult = {
            success: response.ok,
            action: "finalizeTimesheetSubmission",
            date: finalizeDate,
            status: response.ok ? "locked" : "error",
            details: result,
            message: response.ok
              ? "Timesheet finalized and submitted. Confirmation email sent to your manager."
              : "Entries saved but finalization failed. Please check the Time Strap app.",
          };
        }

        else if (tc.name === "submitDailyPlan") {
          const planDate = args.date || today;
          const port = process.env.PORT || 5003;

          const response = await fetch(`http://localhost:${port}/api/daily-plans`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeId: userContext.employeeId,
              date: planDate,
              selectedTasks: (args.selectedTasks || []).map((t: any) => ({
                id: t.id,
                projectName: t.projectName,
                task_name: t.task_name,
                source: t.source || "PMS",
                isLocked: t.isLocked ?? false,
                startTime: t.startTime || null,
                endTime: t.endTime || null,
              })),
              unselectedTasks: (args.unselectedTasks || []).map((t: any) => ({
                taskId: t.taskId,
                taskName: t.taskName,
                reason: t.reason,
                newDueDate: t.newDueDate,
              })),
            }),
          });

          const result = await response.json().catch(() => ({}));

          toolResult = {
            success: response.ok,
            action: "submitDailyPlan",
            date: planDate,
            plannedTaskCount: (args.selectedTasks || []).length,
            postponedTaskCount: (args.unselectedTasks || []).length,
            details: result,
            message: response.ok
              ? `Plan submitted for ${planDate}. ${(args.selectedTasks || []).length} tasks planned, ${(args.unselectedTasks || []).length} postponed.`
              : "Plan submission failed. Please try via the Time Strap app.",
          };
        }

        else if (tc.name === "getDailyPlan") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const planDate = args.date || today;

          // Resolve the employee's UUID from their code
          const empRes = await pool.query(
            "SELECT id, name FROM employees WHERE LOWER(employee_code) = LOWER($1)",
            [targetEmpCode]
          );
          if (empRes.rows.length === 0) {
            toolResult = { error: `Employee ${targetEmpCode} not found.` };
          } else {
            const targetEmployeeId = empRes.rows[0].id;
            const targetName = empRes.rows[0].name;
            const plan = await storage.getDailyPlanByDate(targetEmployeeId, planDate);

            if (!plan) {
              toolResult = {
                submitted: false,
                employeeCode: targetEmpCode,
                employeeName: targetName,
                date: planDate,
                message: `No daily plan found for ${targetEmpCode} on ${planDate}.`,
              };
            } else {
              const tasks = await storage.getPlanTasks(plan.id);
              toolResult = {
                submitted: true,
                employeeCode: targetEmpCode,
                employeeName: targetName,
                date: planDate,
                submittedAt: plan.submittedAt,
                totalTasks: tasks.length,
                tasks: tasks.map((t) => ({
                  taskName: t.taskName,
                  projectName: t.projectName,
                  status: t.status,
                  source: t.source,
                })),
              };
            }
          }
        }

        else if (tc.name === "getDailyPlanSubmissions") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers, HR, and admins can view team daily plan submissions." };
          } else {
            const planDate = args.date || today;
            const dept = args.department;

            let empQuery = "SELECT id, name, employee_code, department FROM employees WHERE is_active = true";
            const empParams: any[] = [];
            if (dept) {
              empParams.push(dept);
              empQuery += ` AND LOWER(department) = LOWER($1)`;
            }
            empQuery += " ORDER BY name ASC";
            const empRes = await pool.query(empQuery, empParams);
            const employees = empRes.rows;

            const plansRes = await pool.query(
              "SELECT employee_id, submitted_at FROM daily_plans WHERE date = $1",
              [planDate]
            );
            
            const submittedEmpIds = new Set(plansRes.rows.map((row: any) => row.employee_id));
            const planMap = new Map<string, string>(
              plansRes.rows.map((row: any) => [row.employee_id, row.submitted_at])
            );

            const submittedList: any[] = [];
            const missingList: any[] = [];

            for (const emp of employees) {
              if (submittedEmpIds.has(emp.id)) {
                submittedList.push({
                  employeeCode: emp.employee_code,
                  name: emp.name,
                  department: emp.department,
                  submittedAt: planMap.get(emp.id),
                });
              } else {
                missingList.push({
                  employeeCode: emp.employee_code,
                  name: emp.name,
                  department: emp.department,
                });
              }
            }

            toolResult = {
              date: planDate,
              department: dept || "All",
              totalActiveEmployees: employees.length,
              submittedCount: submittedList.length,
              missingCount: missingList.length,
              submitted: submittedList,
              missing: missingList,
            };
          }
        }

        else if (tc.name === "deleteDailyPlan") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const planDate = args.date || today;
          const port = process.env.PORT || 5003;

          // Resolve the employee's UUID from their code
          const empRes = await pool.query(
            "SELECT id FROM employees WHERE LOWER(employee_code) = LOWER($1)",
            [targetEmpCode]
          );
          if (empRes.rows.length === 0) {
            toolResult = { error: `Employee ${targetEmpCode} not found.` };
          } else {
            const targetEmployeeId = empRes.rows[0].id;

            const response = await fetch(
              `http://localhost:${port}/api/daily-plans/${planDate}/${targetEmployeeId}`,
              { method: "DELETE" }
            );

            const result = await response.json().catch(() => ({}));
            toolResult = {
              success: response.ok,
              action: "deleteDailyPlan",
              employeeCode: targetEmpCode,
              date: planDate,
              message: response.ok
                ? `Daily plan for ${planDate} has been deleted successfully.`
                : result.error || "Failed to delete daily plan.",
            };
          }
        }

        else if (tc.name === "recallMemory") {
          try {
            const res = await pool.query(
              `SELECT memory_type, memory_key, memory_value, usage_count, last_used_at
               FROM ai_memories
               WHERE employee_id = $1
               ORDER BY usage_count DESC, last_used_at DESC`,
              [userContext.employeeId]
            );
            if (res.rows.length === 0) {
              toolResult = { memories: [], message: "No memories stored yet for this employee." };
            } else {
              toolResult = {
                totalMemories: res.rows.length,
                memories: res.rows.map((r) => ({
                  type: r.memory_type,
                  key: r.memory_key,
                  value: r.memory_value,
                  usedCount: r.usage_count,
                  lastUsed: r.last_used_at,
                })),
              };
            }
          } catch (err: any) {
            toolResult = { error: err.message };
          }
        }

        else if (tc.name === "saveMemory") {
          try {
            await pool.query(
              `INSERT INTO ai_memories (
                 employee_id, memory_type, memory_key, memory_value,
                 usage_count, last_used_at, updated_at
               )
               VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
               ON CONFLICT (employee_id, memory_type, memory_key)
               DO UPDATE SET
                 memory_value = $4,
                 usage_count = ai_memories.usage_count + 1,
                 last_used_at = NOW(),
                 updated_at = NOW()`,
              [
                userContext.employeeId,
                args.memoryType,
                args.memoryKey,
                JSON.stringify(args.memoryValue),
              ]
            );
            toolResult = {
              success: true,
              saved: { type: args.memoryType, key: args.memoryKey, value: args.memoryValue },
            };
          } catch (err: any) {
            toolResult = { error: err.message };
          }
        }

        else if (tc.name === "updateTaskProgress") {
          const taskRes = await pmsPool.query(
            "SELECT * FROM project_tasks WHERE id = $1::uuid",
            [args.taskId]
          );
          const task = taskRes.rows[0];
          if (!task) {
            toolResult = { error: `Task not found.` };
          } else {
            const newProgress = Math.min(100, Math.max(0, Number(args.progress)));
            await pmsPool.query(
              "UPDATE project_tasks SET progress = $2, updated_at = NOW() WHERE id = $1::uuid",
              [args.taskId, newProgress]
            );
            toolResult = { success: true, action: "updateTaskProgress", taskName: task.task_name, progress: newProgress };
            onChunk({ type: "action_executed", action: "updateTaskProgress", status: "success" });
          }
        }

        else if (tc.name === "updateTaskStatus") {
          const taskRes = await pmsPool.query(
            "SELECT * FROM project_tasks WHERE id = $1::uuid",
            [args.taskId]
          );
          const task = taskRes.rows[0];
          if (!task) {
            toolResult = { error: `Task not found.` };
          } else {
            await pmsPool.query(
              "UPDATE project_tasks SET status = $2, updated_at = NOW() WHERE id = $1::uuid",
              [args.taskId, args.status]
            );
            toolResult = { success: true, action: "updateTaskStatus", taskName: task.task_name, newStatus: args.status };
            onChunk({ type: "action_executed", action: "updateTaskStatus", status: "success" });
          }
        }

        else if (tc.name === "updateTaskDescription") {
          const taskRes = await pmsPool.query(
            "SELECT * FROM project_tasks WHERE id = $1::uuid",
            [args.taskId]
          );
          const task = taskRes.rows[0];
          if (!task) {
            toolResult = { error: `Task not found.` };
          } else {
            await pmsPool.query(
              "UPDATE project_tasks SET description = $2, updated_at = NOW() WHERE id = $1::uuid",
              [args.taskId, args.description]
            );
            toolResult = { success: true, action: "updateTaskDescription", taskName: task.task_name };
            onChunk({ type: "action_executed", action: "updateTaskDescription", status: "success" });
          }
        }

        else if (tc.name === "getProjectDetails") {
          const projRes = await pmsPool.query(
            `SELECT p.id, p.title, p.project_code, p.status, p.start_date, 
                    p.end_date, p.progress, p.client_name, p.description
             FROM projects p
             WHERE LOWER(p.project_code) = LOWER($1)`,
            [args.projectCode]
          );
          if (projRes.rows.length === 0) {
            toolResult = { error: `Project "${args.projectCode}" not found.` };
          } else {
            const project = projRes.rows[0];
            const tasksRes = await pmsPool.query(
              `SELECT pt.id, pt.task_name, pt.status, pt.priority, pt.progress,
                      pt.end_date, e.name as assigned_to
               FROM project_tasks pt
               LEFT JOIN task_members tm ON pt.id = tm.task_id
               LEFT JOIN employees e ON tm.employee_id = e.id
               WHERE pt.project_id = $1::uuid
               ORDER BY pt.end_date ASC NULLS LAST`,
              [project.id]
            );
            toolResult = {
              project: {
                ...project,
                start_date: formatDate(project.start_date),
                end_date: formatDate(project.end_date),
              },
              totalTasks: tasksRes.rows.length,
              tasks: tasksRes.rows.map(r => ({
                ...r,
                end_date: formatDate(r.end_date),
              })),
            };
          }
        }

        else if (tc.name === "extendProjectDeadline") {
          const projRes = await pmsPool.query(
            "SELECT id, title FROM projects WHERE LOWER(project_code) = LOWER($1)",
            [args.projectCode]
          );
          if (projRes.rows.length === 0) {
            toolResult = { error: `Project "${args.projectCode}" not found.` };
          } else {
            await pmsPool.query(
              "UPDATE projects SET end_date = $2, updated_at = NOW() WHERE id = $1::uuid",
              [projRes.rows[0].id, args.deadline]
            );
            toolResult = { success: true, action: "extendProjectDeadline", project: projRes.rows[0].title, newDeadline: args.deadline };
            onChunk({ type: "action_executed", action: "extendProjectDeadline", status: "success" });
          }
        }

        else if (tc.name === "deleteTask") {
          const taskRes = await pmsPool.query(
            "SELECT * FROM project_tasks WHERE id = $1::uuid",
            [args.taskId]
          );
          const task = taskRes.rows[0];
          if (!task) {
            toolResult = { error: `Task not found.` };
          } else {
            await pmsPool.query("DELETE FROM task_members WHERE task_id = $1::uuid", [args.taskId]);
            await pmsPool.query("DELETE FROM subtasks WHERE task_id = $1::uuid", [args.taskId]);
            await pmsPool.query("DELETE FROM project_tasks WHERE id = $1::uuid", [args.taskId]);
            toolResult = { success: true, action: "deleteTask", taskName: task.task_name };
            onChunk({ type: "action_executed", action: "deleteTask", status: "success" });
          }
        }

        else if (tc.name === "deleteProject") {
          const projRes = await pmsPool.query(
            "SELECT id, title FROM projects WHERE LOWER(project_code) = LOWER($1)",
            [args.projectCode]
          );
          if (projRes.rows.length === 0) {
            toolResult = { error: `Project "${args.projectCode}" not found.` };
          } else {
            const projectId = projRes.rows[0].id;
            const projectTitle = projRes.rows[0].title;
            // Delete in order: task_members → subtasks → project_tasks → project_departments → projects
            await pmsPool.query(
              "DELETE FROM task_members WHERE task_id IN (SELECT id FROM project_tasks WHERE project_id = $1::uuid)",
              [projectId]
            );
            await pmsPool.query(
              "DELETE FROM subtasks WHERE task_id IN (SELECT id FROM project_tasks WHERE project_id = $1::uuid)",
              [projectId]
            );
            await pmsPool.query("DELETE FROM project_tasks WHERE project_id = $1::uuid", [projectId]);
            await pmsPool.query("DELETE FROM project_departments WHERE project_id = $1::uuid", [projectId]);
            await pmsPool.query("DELETE FROM projects WHERE id = $1::uuid", [projectId]);
            toolResult = { success: true, action: "deleteProject", project: projectTitle };
            onChunk({ type: "action_executed", action: "deleteProject", status: "success" });
          }
        }

        else if (tc.name === "generateReport") {
          if (!["hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only HR and Admin can generate reports." };
          } else {
            const {
              reportType, format, employeeCode,
              startDate, endDate, projectCode,
            } = args;

            const reportsRequiringDates = [
              "employee_timesheet",
              "employee_leave",
              "employee_tasks",
              "team_compliance",
              "team_leave",
              "team_productivity",
              "detailed_timesheet",
              "daily_plan",
              "daily_plan_per_employee",
              "timesheet_per_employee",
            ];

            const employeeReports = [
              "employee_timesheet",
              "employee_leave",
              "employee_tasks",
            ];

            if (reportsRequiringDates.includes(reportType) && (!startDate || !endDate)) {
              toolResult = {
                error: `Missing required parameters: 'startDate' and 'endDate' are required for report type '${reportType}'. Please ask the user for the date range instead of defaulting.`,
              };
            } else if (employeeReports.includes(reportType) && !employeeCode) {
              toolResult = {
                error: `Missing required parameter: 'employeeCode' is required for report type '${reportType}'. Please ask the user for the employee code.`,
              };
            } else if (reportType === "project_tasks" && !projectCode) {
              toolResult = {
                error: `Missing required parameter: 'projectCode' is required for report type 'project_tasks'. Please ask the user for the project code.`,
              };
            } else {
              const {
                generateEmployeeTimesheetReport,
                generateEmployeeLeaveReport,
                generateEmployeeTaskReport,
                generateTeamTimesheetComplianceReport,
                generateTeamLeaveReport,
                generateTeamProductivityReport,
                generateOverdueTasksReport,
                generateProjectProgressReport,
                generateProjectTaskBreakdownReport,
                generateDetailedTimesheetReport,
                generateDailyPlanReport,
                generateDailyPlanPerEmployeeReport,
                generateTimesheetPerEmployeeReport,
              } = await import("../reports/reportGenerator");

              let fileName = "";

              if (reportType === "employee_timesheet") {
                fileName = await generateEmployeeTimesheetReport(employeeCode, startDate, endDate, format);
              } else if (reportType === "detailed_timesheet") {
                fileName = await generateDetailedTimesheetReport(startDate, endDate, format);
              } else if (reportType === "daily_plan") {
                fileName = await generateDailyPlanReport(startDate, endDate, format);
              } else if (reportType === "daily_plan_per_employee") {
                fileName = await generateDailyPlanPerEmployeeReport(startDate, endDate, format);
              } else if (reportType === "timesheet_per_employee") {
                fileName = await generateTimesheetPerEmployeeReport(startDate, endDate, format);
              } else if (reportType === "employee_leave") {
                fileName = await generateEmployeeLeaveReport(employeeCode, startDate, endDate, format);
              } else if (reportType === "employee_tasks") {
                fileName = await generateEmployeeTaskReport(employeeCode, startDate, endDate, format);
              } else if (reportType === "team_compliance") {
                fileName = await generateTeamTimesheetComplianceReport(startDate, endDate, format);
              } else if (reportType === "team_leave") {
                fileName = await generateTeamLeaveReport(startDate, endDate, format);
              } else if (reportType === "team_productivity") {
                fileName = await generateTeamProductivityReport(startDate, endDate, format);
              } else if (reportType === "overdue_tasks") {
                fileName = await generateOverdueTasksReport(format);
              } else if (reportType === "project_progress") {
                fileName = await generateProjectProgressReport(format);
              } else if (reportType === "project_tasks") {
                fileName = await generateProjectTaskBreakdownReport(projectCode, format);
              }

              const rawBaseUrl = userContext.baseUrl || process.env.APP_BASE_URL;
              const downloadUrl = rawBaseUrl
                ? `${rawBaseUrl.replace(/\/$/, "")}/reports/${fileName}`
                : `/reports/${fileName}`;

              toolResult = {
                success: true,
                reportType,
                format,
                downloadUrl,
                fileName,
                message: `Report generated successfully.`,
              };
            }
          }
        }

        else if (tc.name === "getPerformancePrediction") {
          const targetCode = args.employeeCode || userContext.employeeCode;
          if (userContext.role === "employee" &&
            targetCode.toLowerCase() !== userContext.employeeCode.toLowerCase()) {
            toolResult = { error: "Access denied: employees can only check their own performance." };
          } else {
            const { getEmployeeProductivityScore } = await import("./predictions");
            toolResult = await getEmployeeProductivityScore(targetCode, args.days || 30);
          }
        }

        else if (tc.name === "getTaskRisks") {
          const targetCode = args.employeeCode || userContext.employeeCode;
          if (userContext.role === "employee" &&
            targetCode.toLowerCase() !== userContext.employeeCode.toLowerCase()) {
            toolResult = { error: "Access denied." };
          } else {
            const { getTaskDeadlineRisks } = await import("./predictions");
            toolResult = await getTaskDeadlineRisks(targetCode);
          }
        }

        else if (tc.name === "getAttendanceRiskCheck") {
          const targetCode = args.employeeCode || userContext.employeeCode;
          if (userContext.role === "employee" &&
            targetCode.toLowerCase() !== userContext.employeeCode.toLowerCase()) {
            toolResult = { error: "Access denied." };
          } else {
            const { getAttendanceRisk } = await import("./predictions");
            toolResult = await getAttendanceRisk(targetCode);
          }
        }

        else if (tc.name === "getProjectHealth") {
          const { getProjectHealthScore } = await import("./predictions");
          toolResult = await getProjectHealthScore(args.projectCode);
        }

        else if (tc.name === "getTeamInsights") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: managers, HR and admin only." };
          } else {
            const { getTeamInsights } = await import("./predictions");
            toolResult = await getTeamInsights();
          }
        }

          if (userContext.executionCache) {
            resolvePromise(toolResult);
          }
        } catch (err: any) {
          console.error(`Tool ${tc.name} error:`, err);
          toolResult = { error: err.message };
          if (userContext.executionCache) {
            rejectPromise(err);
          }
        }
      }

      currentMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      } as any);
    }
  }
}
