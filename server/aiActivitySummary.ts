import OpenAI from "openai";
import {
  getToolActivitySummary,
  getActivityLogEntries,
  type ToolActivitySummary,
  type ActivityLogEntry,
} from "./toolUsageValidation";

// Reuses the same OpenAI setup already configured for the RAG chat feature
// (see server/rag/ragChat.ts) — same env var, same client pattern.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export interface SuggestWorkSummaryParams {
  employeeCode: string;
  date: string;
  startTime: string;
  endTime: string;
  project?: string;
  taskTitle?: string;
  subTask?: string;
}

export interface SuggestWorkSummaryResult {
  /** Draft for the Description field — always editable, never auto-saved. */
  description: string;
  /** Draft for the Achievements field — accomplishments only, no tools/numbers. */
  achievements: string;
  /** Draft for the "Quantify Your Result" field — only counts grounded in the logs, no tool names. */
  quantifyResult: string;
  /** Draft for the "Actual Work Tool" field — tools/apps used, kept separate from the fields above. */
  actualWorkTool: string;
  /** True if there was no TimeGuard signal at all (activity_logs + tool usage both empty). */
  noData: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "<1m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Builds the "Actual Work Tool" field from tracked activity — a plain,
 * deduplicated list of the tools/apps the employee actually used. This is
 * computed directly from the tracked data (not the AI) so it stays factual
 * and consistent regardless of whether the AI narrative path runs.
 */
function buildActualWorkTool(
  toolActivity: ToolActivitySummary,
  activityEntries: ActivityLogEntry[]
): string {
  if (toolActivity.entries.length > 0) {
    const names = toolActivity.entries.map((e) => e.toolName);
    return Array.from(new Set(names)).join(", ");
  }
  const appNames = activityEntries
    .map((e) => e.appName)
    .filter((n): n is string => !!n && n.trim().length > 0);
  return Array.from(new Set(appNames)).join(", ");
}

/**
 * Builds a compact, factual line-by-line context block from activity_logs
 * entries — this is the real signal (window titles, URLs, file/page names)
 * the AI needs to infer *what work was done*, not just which app was open.
 */
function buildActivityContext(entries: ActivityLogEntry[]): string {
  return entries
    .slice(0, 40)
    .map((e) => {
      const label = e.windowTitle || e.title || e.url || e.website || e.appName;
      const source = e.appName ? ` [${e.appName}]` : "";
      return `- ${label}${source} — ${formatDuration(e.durationSeconds)}`;
    })
    .join("\n");
}

function formatFallbackFromToolSummary(activity: ToolActivitySummary): {
  description: string;
  achievements: string;
  quantifyResult: string;
} {
  if (activity.entries.length === 0) {
    return { description: "", achievements: "", quantifyResult: "" };
  }

  // Without an OpenAI key (or without rich activity_logs signal) we can't
  // infer a narrative, but we still have real tool/time data — so build a
  // grounded multi-line summary from it instead of a single flat sentence.
  // Description may still reference tools/time (it's a factual session
  // recap); Achievements and Quantify Your Result must not — those are kept
  // tool-and-time-free per field requirements, with tool info living only in
  // the separate Actual Work Tool field.
  const topEntries = activity.entries.slice(0, 3);
  const toolLines = topEntries.map((e) => `${e.toolName} (${e.minutes}m)`);

  const description = [
    `Worked across ${activity.entries.length} tool${activity.entries.length === 1 ? "" : "s"} during this session, totaling ${activity.totalMinutes} tracked minutes.`,
    `Primary tools used: ${toolLines.join(", ")}.`,
  ].join("\n");

  const achievements = topEntries
    .map((e) => `- Made progress on the assigned task using ${e.toolName}.`)
    .join("\n")
    .replace(/ using [^.]+\./g, "."); // strip tool mentions — achievements stays tool-free

  const quantifyResult = "";

  return { description, achievements, quantifyResult };
}

/**
 * Drafts detailed Description / Achievements / Quantify-Your-Result
 * suggestions from TimeGuard's tracked activity for this employee/date/
 * time-window. Each field is 2-3 lines/points covering the distinct threads
 * of work visible in the log, not a single flat sentence.
 *
 * Uses activity_logs (window titles, URLs, file/page names) as the primary
 * signal — this is what actually lets the model infer real work ("visitor
 * registration workflow", "access control validation") instead of only
 * being able to report which application was open.
 *
 * The model is explicitly instructed to ground every claim — especially any
 * number in Quantify Your Result — in something actually present in the
 * logs, and to write fewer points rather than invent specifics it has no
 * basis for. These are always suggestions the employee reviews and edits,
 * never auto-saved as final.
 */
export async function suggestWorkSummaryFromTimeGuard(
  params: SuggestWorkSummaryParams
): Promise<SuggestWorkSummaryResult> {
  const { employeeCode, date, startTime, endTime, project, taskTitle, subTask } = params;

  const [activityEntries, toolActivity] = await Promise.all([
    getActivityLogEntries(employeeCode, date, startTime, endTime),
    getToolActivitySummary(employeeCode, date, startTime, endTime),
  ]);

  const actualWorkTool = buildActualWorkTool(toolActivity, activityEntries);

  if (activityEntries.length === 0) {
    // No rich activity_logs signal — fall back to the plain tool-time
    // summary rather than fabricating a narrative with nothing to ground it.
    if (toolActivity.noData) {
      return { description: "", achievements: "", quantifyResult: "", actualWorkTool: "", noData: true };
    }
    const fallback = formatFallbackFromToolSummary(toolActivity);
    return { ...fallback, actualWorkTool, noData: false };
  }

  if (!process.env.OPENAI_API_KEY) {
    const fallback = formatFallbackFromToolSummary(toolActivity);
    return { ...fallback, actualWorkTool, noData: false };
  }

  const taskContext = [project, taskTitle, subTask].filter(Boolean).join(" / ") || "the selected task";
  const activityContext = buildActivityContext(activityEntries);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You draft timesheet entry text from an employee's tracked window/app/browser activity log. " +
            "You are given window titles, file names, page titles, and URLs that were open during a work session, " +
            "with how long each was open. Infer what work was plausibly being done from these specifics " +
            "(e.g. a window titled 'VisitorRegistrationController.ts — VS Code' implies work on a visitor " +
            "registration feature; a browser tab titled 'Pull Request #42 · api-validation' implies a PR/API " +
            "validation task). Do NOT just restate app names and durations — infer the underlying work, and " +
            "cover the DISTINCT threads of work visible in the log (different files, tickets, pages, features) " +
            "rather than collapsing everything into one generic line.\n\n" +
            "STRICT GROUNDING RULE: only state something if it is directly supported by a specific title, " +
            "filename, URL, or page name in the log. Do not invent outcomes, counts, or specifics that aren't " +
            "traceable to something in the log. If the log only supports one or two points for a field, write " +
            "just that many rather than padding with a vague or repeated point. Keep every line concise (max " +
            "~15 words) so the full response fits a tight token budget.\n\n" +
            "TOOL-SEPARATION RULE: which tools/apps were used (TimeGuard, Timestrap, VS Code, browsers, etc.) " +
            "is reported separately by the system in its own field. NEVER mention tool or app names, and NEVER " +
            "mention time/duration/minutes, in achievements or quantifyResult — those two fields must describe " +
            "only the work itself.\n\n" +
            "Output STRICT JSON only, no markdown, no preamble, with exactly these keys:\n" +
            '{"description": string, "achievements": string, "quantifyResult": string}\n' +
            "- description: 2-3 factual sentences, EACH ON ITS OWN LINE (separated by \\n), giving a detailed " +
            "narrative of the work performed during this session — what was worked on, on which files/pages/" +
            "tickets, and roughly in what order if inferable from the log. Tool/app names may appear here since " +
            "this field is a session recap.\n" +
            "- achievements: 2-3 bullet points, EACH ON ITS OWN LINE prefixed with '- ', summarizing the actual " +
            "accomplishments based on the task (" + taskContext + ") and what the log evidences (e.g. " +
            "'- Completed the visitor registration form validation', '- Reviewed and merged pull request #42', " +
            "'- Resolved the login redirect bug'). Describe WHAT was achieved only — no tool/app names, no " +
            "numbers or counts, no durations. Each point must be a specific, distinct accomplishment grounded " +
            "in the log.\n" +
            "- quantifyResult: 2-3 bullet points, EACH ON ITS OWN LINE prefixed with '- ', giving MEASURABLE " +
            "outcomes only — tasks completed, tickets resolved, modules implemented, bugs fixed, features " +
            "developed, files edited, PRs reviewed, pages built, etc. — that you can actually derive by " +
            "counting distinct titles/files/URLs/PRs/tickets in the log (e.g. '- 3 files edited', '- 2 API " +
            "endpoints touched', '- 1 bug ticket resolved'). No tool/app names and no time/duration mentions — " +
            "numbers/counts of completed work only. Only include a bullet if you can ground it in a specific " +
            "count from the log; if you cannot ground even one measurable item, return an empty string for this " +
            "field rather than guessing a number.",
        },
        {
          role: "user",
          content: `Task: ${taskContext}\n\nTracked activity during this work window (title/page — duration):\n${activityContext}`,
        },
      ],
      max_tokens: 220,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    return {
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      achievements: typeof parsed.achievements === "string" ? parsed.achievements.trim() : "",
      quantifyResult: typeof parsed.quantifyResult === "string" ? parsed.quantifyResult.trim() : "",
      actualWorkTool,
      noData: false,
    };
  } catch (error) {
    console.error("[AI-ACTIVITY-SUMMARY] OpenAI call failed, falling back to plain sentence:", error);
    const fallback = formatFallbackFromToolSummary(toolActivity);
    return { ...fallback, actualWorkTool, noData: false };
  }
}