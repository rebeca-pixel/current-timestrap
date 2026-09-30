// server/activityMatching.ts
//
// STEP 5 — Rule-Based Task Matching (server-side, day-level).
//
// Unlike the in-form matching added to TaskForm.tsx (which only compares
// activity against whichever single task's Edit screen happens to be open),
// this runs across an employee's WHOLE DAY: it takes every activity block
// TimeGuard recorded, finds which planned task (time_entries row) was
// scheduled for that block's time window, and computes a match status
// against that task's tools_used — exactly like Step 6 (Warning Engine)
// needs in order to know which stretches of the day are "Unclassified" and
// should start a grace-period countdown.
//
// Deterministic only — no AI/ML call anywhere in this file, per the
// reliability principle (Core Logic must work even if the AI layer is down).

import { db } from "./db";
import { timeEntries, type TimeEntry } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getActualWorkedTools, type ActualWorkedToolEntry } from "./toolUsageValidation";

const IDLE_GAP_SECONDS = 120;

export type MatchStatus = "Matched" | "Partial Match" | "Unclassified";

export interface ActivityMatchBlock {
    type: "activity" | "idle";
    startTime: string; // ISO
    endTime: string; // ISO
    durationSeconds: number;
    tools: string[];
    matchedTask: {
        id: string;
        project: string;
        keyStep: string | null;
        task: string;
    } | null;
    matchStatus: MatchStatus;
    matchRatio: number;
}

function extractDomain(url: string | null): string | null {
    if (!url) return null;
    try {
        const withProto = /^[a-zA-Z]+:\/\//.test(url) ? url : `https://${url}`;
        return new URL(withProto).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

function labelFor(entry: ActualWorkedToolEntry): string {
    const domain = entry.websiteUrl ? extractDomain(entry.websiteUrl) : null;
    if (domain) return domain;
    if (entry.browserName) return entry.browserName;
    return entry.appName || "App";
}

/**
 * Splits a chronological list of TimeGuard activity rows into blocks,
 * starting a new block whenever the tool/app changes (not just on idle
 * gaps) — this is the same segmentation fix applied client-side in
 * TaskForm.tsx, ported here so the backend and the UI never disagree.
 */
export function segmentByTool(entries: ActualWorkedToolEntry[]): Omit<ActivityMatchBlock, "matchedTask" | "matchStatus" | "matchRatio">[] {
    type RawBlock = {
        type: "activity" | "idle";
        startTime: string;
        endTime: string;
        durationSeconds: number;
        tools: string[];
    };

    if (!entries.length) return [];

    const sorted = [...entries].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    const blocks: RawBlock[] = [];
    let current: RawBlock | null = null;

    for (const entry of sorted) {
        const isIdleEntry = entry.activityType === "idle";
        const start = entry.startTime;
        const end = entry.endTime;
        const label = isIdleEntry ? null : labelFor(entry);
        const gapSeconds = current
            ? Math.round((new Date(start).getTime() - new Date(current.endTime).getTime()) / 1000)
            : 0;

        if (isIdleEntry) {
            if (current) blocks.push(current);
            current = null;
            blocks.push({ type: "idle", startTime: start, endTime: end, durationSeconds: entry.durationSeconds, tools: [] });
            continue;
        }

        const sameTool = current && current.type === "activity" && current.tools.length === 1 && current.tools[0] === label;

        if (current && current.type === "activity" && sameTool && gapSeconds < IDLE_GAP_SECONDS) {
            current.endTime = end;
            current.durationSeconds += entry.durationSeconds;
            continue;
        }

        if (current) {
            blocks.push(current);
            if (current.type === "activity" && gapSeconds >= IDLE_GAP_SECONDS) {
                blocks.push({
                    type: "idle",
                    startTime: current.endTime,
                    endTime: start,
                    durationSeconds: gapSeconds,
                    tools: [],
                });
            }
        }

        current = {
            type: "activity",
            startTime: start,
            endTime: end,
            durationSeconds: entry.durationSeconds,
            tools: [label as string],
        };
    }
    if (current) blocks.push(current);

    return blocks;
}

/**
 * Finds the planned task (time_entries row) whose [startTime, endTime)
 * window on the given date overlaps the block's time range, for this
 * employee. If more than one planned task overlaps, the one with the
 * greatest overlap is chosen.
 */
export function findOverlappingTask(
    block: { startTime: string; endTime: string },
    dayPlannedTasks: TimeEntry[],
    date: string
): TimeEntry | null {
    const blockStart = new Date(block.startTime).getTime();
    const blockEnd = new Date(block.endTime).getTime();

    let best: TimeEntry | null = null;
    let bestOverlap = 0;

    for (const task of dayPlannedTasks) {
        const taskStart = new Date(`${date}T${normalizeTime(task.startTime)}+05:30`).getTime();
        const taskEnd = new Date(`${date}T${normalizeTime(task.endTime)}+05:30`).getTime();

        const overlapStart = Math.max(blockStart, taskStart);
        const overlapEnd = Math.min(blockEnd, taskEnd);
        const overlap = overlapEnd - overlapStart;

        if (overlap > 0 && overlap > bestOverlap) {
            best = task;
            bestOverlap = overlap;
        }
    }

    return best;
}

function normalizeTime(time: string): string {
    return time.length === 5 ? `${time}:00` : time;
}

/**
 * Compares a block's captured tools against the matched task's tools_used
 * and returns Matched / Partial Match / Unclassified — same thresholds as
 * the client-side version in TaskForm.tsx, kept in sync deliberately.
 */
export function computeMatchStatus(
    blockTools: string[],
    plannedTools: string[] | null | undefined
): { status: MatchStatus; ratio: number } {
    const planned = plannedTools || [];
    if (blockTools.length === 0 || planned.length === 0) {
        return { status: "Unclassified", ratio: 0 };
    }
    const plannedNormalized = new Set(planned.map((t) => t.trim().toLowerCase()));
    const matchedCount = blockTools.filter((t) => plannedNormalized.has(t.trim().toLowerCase())).length;
    const ratio = matchedCount / blockTools.length;
    const status: MatchStatus = ratio >= 0.6 ? "Matched" : ratio >= 0.25 ? "Partial Match" : "Unclassified";
    return { status, ratio };
}

/**
 * Top-level entry point: given an employee + date, pulls every TimeGuard
 * activity row for the full day, segments it into blocks, joins each block
 * against the employee's planned tasks for that day (time_entries), and
 * returns a fully matched, day-level Activity Timeline.
 *
 * This is what Step 6 (Warning & Enforcement Engine) should call to find
 * out whether the employee is currently "Unclassified" against their plan.
 */
export async function getDayActivityMatches(employeeCode: string, date: string): Promise<ActivityMatchBlock[]> {
    // Pull the employee's planned tasks for the day (time_entries acts as the
    // planned-task record here — project/task/subtask/tools/start/end).
    const dayPlannedTasks = await db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.employeeCode, employeeCode), eq(timeEntries.date, date)));

    // Pull TimeGuard's full-day raw activity (00:00–23:59) rather than a
    // single task's window, since we're matching across the whole day.
    const rawEntries = await getActualWorkedTools(employeeCode, date, "00:00", "23:59");

    const rawBlocks = segmentByTool(rawEntries);

    return rawBlocks.map((block) => {
        if (block.type === "idle") {
            return { ...block, matchedTask: null, matchStatus: "Unclassified" as MatchStatus, matchRatio: 0 };
        }

        const matchedTask = findOverlappingTask(block, dayPlannedTasks, date);
        const { status, ratio } = computeMatchStatus(block.tools, matchedTask?.toolsUsed);

        return {
            ...block,
            matchedTask: matchedTask
                ? {
                    id: matchedTask.id,
                    project: matchedTask.projectName,
                    keyStep: matchedTask.keyStep ?? null,
                    task: matchedTask.taskDescription,
                }
                : null,
            matchStatus: status,
            matchRatio: ratio,
        };
    });
}