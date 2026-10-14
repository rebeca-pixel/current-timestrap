// Same-day submission restriction — single source of truth shared by the client and the server.
//
// Purpose: stop employees from accidentally submitting TODAY's timesheet when they meant to submit
// YESTERDAY's. By default today's timesheet can only be submitted from 5:00 PM (local time) onwards.
// Each employee can switch the restriction off/on for themselves (stored server-side, see routes.ts).
//
// All date maths is done in an explicit IANA time zone, never in the machine's zone, so the server
// (often UTC) and the browser agree on what "today" and "5 PM" mean for a given employee.
// The rule is pure: it only looks at the work date, the current instant, the zone and the flags.

export const SAME_DAY_SUBMIT_CUTOFF_HOUR = 17; // 5:00 PM
export const SAME_DAY_SUBMIT_CUTOFF_LABEL = "5:00 PM";
// Used only when neither the client nor the server configuration supplies a valid zone.
export const DEFAULT_SUBMISSION_TIME_ZONE = "Asia/Kolkata";
export const SAME_DAY_SUBMIT_ERROR_CODE = "SAME_DAY_SUBMISSION_RESTRICTED";

export interface LocalDateTime {
    date: string; // YYYY-MM-DD in the given zone
    hour: number; // 0-23
    minute: number; // 0-59
}

/** True when `tz` is an IANA zone the runtime understands (e.g. "Asia/Kolkata"). */
export function isValidTimeZone(tz: unknown): tz is string {
    if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** First valid zone from the candidates, else DEFAULT_SUBMISSION_TIME_ZONE. */
export function resolveTimeZone(...candidates: unknown[]): string {
    for (const c of candidates) {
        if (isValidTimeZone(c)) return c.trim();
    }
    return DEFAULT_SUBMISSION_TIME_ZONE;
}

/** The browser's own zone (client side). Undefined if the runtime cannot tell. */
export function detectBrowserTimeZone(): string | undefined {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return isValidTimeZone(tz) ? tz : undefined;
    } catch {
        return undefined;
    }
}

/** Wall-clock date + time of `now` in `timeZone`. */
export function getLocalDateTime(now: Date, timeZone: string): LocalDateTime {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    // Some runtimes emit "24" at midnight even with h23; normalise it.
    const hour = Number(get("hour")) % 24;
    return {
        date: `${get("year")}-${get("month")}-${get("day")}`,
        hour,
        minute: Number(get("minute")),
    };
}

export interface SameDayRestrictionInput {
    /** The work date being submitted, YYYY-MM-DD (extra time part is ignored). */
    workDate: string;
    now?: Date;
    timeZone?: string;
    /** The employee's toggle. `false` switches the restriction off. Default: on. */
    enabled?: boolean;
    /** A daily submission already exists for this employee + date (nothing new is being submitted). */
    alreadySubmitted?: boolean;
}

export interface SameDayRestrictionResult {
    blocked: boolean;
    code?: typeof SAME_DAY_SUBMIT_ERROR_CODE;
    message?: string;
    today: string; // today's date in the zone
    timeZone: string;
    cutoffLabel: string;
}

/**
 * Decides whether submitting `workDate` is blocked right now.
 * Blocked only when ALL of these hold:
 *   - the restriction is enabled for the employee,
 *   - the work date is today in the employee's time zone,
 *   - the local time is before 5:00 PM,
 *   - the day has not already been submitted.
 * Past dates (e.g. yesterday), future dates and already-submitted days are never touched.
 */
export function evaluateSameDaySubmission(input: SameDayRestrictionInput): SameDayRestrictionResult {
    const timeZone = resolveTimeZone(input.timeZone);
    const local = getLocalDateTime(input.now ?? new Date(), timeZone);
    const base = { today: local.date, timeZone, cutoffLabel: SAME_DAY_SUBMIT_CUTOFF_LABEL };

    const enabled = input.enabled !== false;
    const workDate = String(input.workDate ?? "").slice(0, 10);
    const beforeCutoff = local.hour < SAME_DAY_SUBMIT_CUTOFF_HOUR;

    if (!enabled || input.alreadySubmitted || workDate !== local.date || !beforeCutoff) {
        return { blocked: false, ...base };
    }

    return {
        blocked: true,
        code: SAME_DAY_SUBMIT_ERROR_CODE,
        message:
            `You are trying to submit today's timesheet (${workDate}) before ${SAME_DAY_SUBMIT_CUTOFF_LABEL} (${timeZone}). ` +
            `Today's timesheet can only be submitted after ${SAME_DAY_SUBMIT_CUTOFF_LABEL}. ` +
            `If you meant to submit yesterday's timesheet, select yesterday's date instead. ` +
            `You can turn this check off in the "Today's submission after 5 PM" setting.`,
        ...base,
    };
}
