// server/timesheetGenerator.ts
//
// STEP 7 — Automatic Timesheet.
//
// Workflow: Generate -> Employee Review -> Submit.
//
// "Generate" reuses time_entries directly (per decision: no separate
// generated_timesheets table) — for each of the employee's planned tasks
// for the day, it pulls the Step 5 day-level Activity Timeline
// (getDayActivityMatches) and sums up whichever blocks matched that task,
// writing the actual start/end time, active/idle seconds, and an aggregate
// match status back onto the same time_entries row. No AI, deterministic,
// consistent with Steps 5/6.
//
// "Employee Review" is the existing Task Details / Edit Task form's
// Completion % field — nothing new needed there, since that field and its
// save path already exist. Generation just makes sure the row reflects
// reality before the employee reviews it.
//
// "Submit" is a distinct, explicit action (separate from the existing
// `submittedAt`, which fires on row creation, not on timesheet submission)
// — see submitTimesheetForDay() below.

import { db } from "./db";
import { timeEntries, type TimeEntry } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getDayActivityMatches, type ActivityMatchBlock } from "./activityMatching";

export interface GeneratedLineResult {
  taskId: string;
  taskDescription: string;
  actualStartTime: string | null;
  actualEndTime: string | null;
  activeSeconds: number;
  idleSeconds: number;
  matchStatus: "Matched" | "Partial Match" | "Unclassified" | "No Activity";
}

function durationSeconds(block: ActivityMatchBlock): number {
  return Math.max(0, Math.round((new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / 1000));
}

/**
 * For a single planned task (time_entries row) and the day's already-matched
 * Activity Timeline blocks, aggregate everything that matched this task's id.
 */
function aggregateForTask(task: TimeEntry, blocks: ActivityMatchBlock[]): GeneratedLineResult {
  const matchedBlocks = blocks.filter((b) => b.matchedTask?.id === task.id);

  if (matchedBlocks.length === 0) {
    return {
      taskId: task.id,
      taskDescription: task.taskDescription,
      actualStartTime: null,
      actualEndTime: null,
      activeSeconds: 0,
      idleSeconds: 0,
      matchStatus: "No Activity",
    };
  }

  const activityBlocks = matchedBlocks.filter((b) => b.type === "activity");
  const idleBlocksSeconds = matchedBlocks
    .filter((b) => b.type === "idle")
    .reduce((sum, b) => sum + durationSeconds(b), 0);
  const activeSeconds = activityBlocks.reduce((sum, b) => sum + durationSeconds(b), 0);

  const sorted = [...matchedBlocks].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const actualStartTime = sorted[0]?.startTime ?? null;
  const actualEndTime = sorted[sorted.length - 1]?.endTime ?? null;

  // Aggregate match status: worst-case wins, since a task is only truly
  // "Matched" if the bulk of the time spent on it was actually matched.
  const matchedCount = activityBlocks.filter((b) => b.matchStatus === "Matched").length;
  const partialCount = activityBlocks.filter((b) => b.matchStatus === "Partial Match").length;
  let matchStatus: GeneratedLineResult["matchStatus"] = "Unclassified";
  if (activityBlocks.length > 0) {
    const matchedRatio = matchedCount / activityBlocks.length;
    if (matchedRatio >= 0.6) matchStatus = "Matched";
    else if (matchedRatio >= 0.25 || partialCount > 0) matchStatus = "Partial Match";
  }

  return {
    taskId: task.id,
    taskDescription: task.taskDescription,
    actualStartTime,
    actualEndTime,
    activeSeconds,
    idleSeconds: idleBlocksSeconds,
    matchStatus,
  };
}

/**
 * Generates (or regenerates) the timesheet for an employee's day: pulls
 * every planned task for the date, matches it against the day's Activity
 * Timeline, and writes the aggregated actuals back onto each time_entries
 * row. Safe to call multiple times before submission — each call overwrites
 * the auto-populated fields with the latest activity data. Does NOT touch
 * percentageComplete (employee-owned) or timesheet_submitted_at.
 */
export async function generateTimesheetForDay(employeeCode: string, date: string): Promise<GeneratedLineResult[]> {
  const plannedTasks = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.employeeCode, employeeCode), eq(timeEntries.date, date)));

  if (plannedTasks.length === 0) return [];

  // Already submitted rows are not regenerated — the timesheet is final
  // once submitted, per the spec ("Submit locks the timesheet as final").
  const editableTasks = plannedTasks.filter((t) => !t.timesheetSubmittedAt);

  const blocks = await getDayActivityMatches(employeeCode, date);

  const results: GeneratedLineResult[] = [];

  for (const task of editableTasks) {
    const result = aggregateForTask(task, blocks);
    results.push(result);

    await db
      .update(timeEntries)
      .set({
        actualStartTime: result.actualStartTime,
        actualEndTime: result.actualEndTime,
        activeSeconds: result.activeSeconds,
        idleSeconds: result.idleSeconds,
        matchStatus: result.matchStatus,
        autoGenerated: true,
        generatedAt: new Date(),
      })
      .where(eq(timeEntries.id, task.id));
  }

  return results;
}

/**
 * Submit: marks every generated (and not-yet-submitted) row for the day as
 * finally submitted. This is the explicit "Submit" step distinct from
 * `submittedAt` (record-creation timestamp). Requires generation to have
 * run first — an ungenerated row (auto_generated = false) is treated as
 * not ready and is skipped, with its id reported back so the caller can
 * warn the employee before treating the day as fully submitted.
 */
export async function submitTimesheetForDay(
  employeeCode: string,
  date: string
): Promise<{ submitted: string[]; skippedNotGenerated: string[] }> {
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.employeeCode, employeeCode), eq(timeEntries.date, date)));

  const submitted: string[] = [];
  const skippedNotGenerated: string[] = [];

  for (const row of rows) {
    if (row.timesheetSubmittedAt) continue; // already submitted, leave as-is
    if (!row.autoGenerated) {
      skippedNotGenerated.push(row.id);
      continue;
    }
    await db
      .update(timeEntries)
      .set({ timesheetSubmittedAt: new Date(), status: "submitted" })
      .where(eq(timeEntries.id, row.id));
    submitted.push(row.id);
  }

  return { submitted, skippedNotGenerated };
}