// Weekly Timesheet Submission Lock — single source of truth shared by the client and the server.
//
// Rule (when the admin switch is ON):
//   A week runs Sunday → Saturday. Any day of the CURRENT week can be submitted/edited, including days
//   missed earlier in that week. From the following Sunday (00:00 in the employee's time zone) the whole
//   previous week is locked: nothing in it can be submitted, created, edited or deleted.
// When the switch is OFF the rule never blocks anything (the original, unrestricted behaviour).
//
// Pure functions only: they take the work date, the current instant, a time zone and the flag.
// "Today" is always computed in an explicit IANA zone, never in the machine's zone.

import { getLocalDateTime, resolveTimeZone } from "./submissionRestriction";

export const WEEKLY_LOCK_ERROR_CODE = "WEEKLY_SUBMISSION_LOCKED";
export const WEEKLY_LOCK_MESSAGE = "This week's timesheet submission period has been closed";

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ""));
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { y, m, d };
}

function formatUtc(ms: number): string {
    const dt = new Date(ms);
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** The Sunday (YYYY-MM-DD) that starts the Sunday–Saturday week containing `ymd`. Null if `ymd` is invalid. */
export function getWeekStart(ymd: string): string | null {
    const p = parseYmd(ymd);
    if (!p) return null;
    const ms = Date.UTC(p.y, p.m - 1, p.d);
    const dow = new Date(ms).getUTCDay(); // 0 = Sunday
    return formatUtc(ms - dow * 86_400_000);
}

/** The Saturday (YYYY-MM-DD) that ends the week containing `ymd`. */
export function getWeekEnd(ymd: string): string | null {
    const start = getWeekStart(ymd);
    if (!start) return null;
    const p = parseYmd(start)!;
    return formatUtc(Date.UTC(p.y, p.m - 1, p.d) + 6 * 86_400_000);
}

export interface WeeklyLockInput {
    /** The work date being submitted / changed, YYYY-MM-DD (extra time part is ignored). */
    workDate: string;
    now?: Date;
    timeZone?: string;
    /** The admin switch. Anything other than `true` means OFF (no locking). */
    enabled?: boolean;
}

export interface WeeklyLockResult {
    locked: boolean;
    code?: typeof WEEKLY_LOCK_ERROR_CODE;
    message?: string;
    today: string;
    timeZone: string;
    weekStart?: string; // Sunday of the work date's week
    weekEnd?: string; // Saturday of the work date's week
}

/**
 * Is `workDate` locked right now?
 * Locked only when the switch is ON and the work date's week (Sun–Sat) started before the current week's
 * Sunday in the given time zone. Current-week and future dates are never locked. Unparseable dates are
 * never locked (the existing validation keeps handling them).
 */
export function evaluateWeeklyLock(input: WeeklyLockInput): WeeklyLockResult {
    const timeZone = resolveTimeZone(input.timeZone);
    const today = getLocalDateTime(input.now ?? new Date(), timeZone).date;
    const base = { today, timeZone };

    if (input.enabled !== true) return { locked: false, ...base };

    const workDate = String(input.workDate ?? "").slice(0, 10);
    const workWeekStart = getWeekStart(workDate);
    const currentWeekStart = getWeekStart(today);
    if (!workWeekStart || !currentWeekStart) return { locked: false, ...base };

    const weekInfo = { weekStart: workWeekStart, weekEnd: getWeekEnd(workDate) ?? undefined };
    // YYYY-MM-DD strings compare correctly as text.
    if (workWeekStart >= currentWeekStart) return { locked: false, ...base, ...weekInfo };

    return {
        locked: true,
        code: WEEKLY_LOCK_ERROR_CODE,
        message: `${WEEKLY_LOCK_MESSAGE}. The week of ${workWeekStart} to ${weekInfo.weekEnd} (Sunday–Saturday) is locked, so its timesheets can no longer be submitted or modified.`,
        ...base,
        ...weekInfo,
    };
}