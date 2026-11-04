// Existing-progress validation for Tasks and Subtasks — single source of truth shared by client and server.
//
// Model: the user enters only the progress they are ADDING now (an increment), never the new total.
//   existing progress 80%  →  remaining 20%  →  user may enter 1–20  →  saved total = existing + entered.
// The total (existing + increment) is what gets stored on the time entry and sent to PMS, so everything
// downstream keeps receiving a cumulative percentage exactly as before.
// Pure functions: no I/O, no clock.

export const PROGRESS_INCREMENT_ERROR_CODE = "PROGRESS_INCREMENT_INVALID";

/** Clamp an arbitrary value to a whole percentage 0–100 (non-numbers become 0). */
export function normalizeExistingProgress(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
}

/** Percentage still available: 100 minus the existing progress (never below 0). */
export function getRemainingProgress(existing: unknown): number {
    return 100 - normalizeExistingProgress(existing);
}

export interface ProgressIncrementResult {
    valid: boolean;
    message?: string;
    existing: number;
    remaining: number;
    increment: number;
    /** existing + increment (only meaningful when valid). */
    total: number;
}

/**
 * Validates a newly entered progress increment against what is already submitted.
 * Rejects: nothing left to add (already 100%), re-submitting the same percentage as the existing one,
 * anything above the remaining balance, and non-positive / non-whole values.
 */
export function evaluateProgressIncrement(existingRaw: unknown, incrementRaw: unknown): ProgressIncrementResult {
    const existing = normalizeExistingProgress(existingRaw);
    const remaining = 100 - existing;
    const increment = Number(incrementRaw);
    const base = { existing, remaining, increment, total: existing + (Number.isFinite(increment) ? increment : 0) };

    if (remaining <= 0) {
        return { ...base, valid: false, message: "This task is already at 100% progress, so there is no remaining progress to submit." };
    }
    if (!Number.isFinite(increment) || !Number.isInteger(increment) || increment <= 0) {
        return { ...base, valid: false, message: `Enter a whole number between 1% and ${remaining}% (the remaining progress).` };
    }
    if (increment > remaining) {
        // Typical mistake: re-entering the existing percentage (e.g. 80% again) instead of the balance.
        const same = increment === existing
            ? `It is already at ${existing}%, so ${existing}% cannot be submitted again. `
            : "";
        return {
            ...base,
            valid: false,
            message: `${same}Progress cannot exceed the remaining ${remaining}% (existing ${existing}% + ${increment}% would be ${existing + increment}%). Enter ${remaining}% or less.`,
        };
    }
    return { ...base, valid: true };
}