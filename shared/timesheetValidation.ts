// Single source of truth for timesheet field validation.
//
// The rules are NOT hard-coded in the backend. The Admin edits them in the Admin Approval tab, they are
// saved in the database, and the SAME evaluator below is used:
//   - stage "submit"  : employee entry / final submit / resubmit (client + server)
//   - stage "approve" : the Admin Approval review
//
// Every field has two switches, one per stage. When a text field is switched on (mandatory) it must
// contain at least TIMESHEET_MIN_CHARS characters of real content (placeholders such as "n/a" and
// repeated characters do not count). Optional fields are accepted when empty. Tools Used, Key Step and
// Subtask are presence-only checks: they just have to be filled.

export type ValidationStage = "submit" | "approve";

export interface StageToggle {
  submit: boolean;
  approve: boolean;
}

export interface ValidationRules {
  quantify: StageToggle & { requireNumber: boolean; maxWords: number };
  achievements: StageToggle & {
    minWords: number;
    allowProblemsInstead: boolean; // when Achievements is empty, a valid Problems & Issues satisfies it
  };
  problemAndIssues: StageToggle;
  description: StageToggle & { minWords: number };
  toolsUsed: StageToggle;
  percentageComplete: StageToggle & { minValue: number };
  keyStep: StageToggle;
  subTask: StageToggle;
  scopeOfImprovements: StageToggle;
}

export const TIMESHEET_MIN_CHARS = 10;

// Only the starting point for a fresh install. Once an admin saves rules, the saved rules win.
export const DEFAULT_VALIDATION_RULES: ValidationRules = {
  quantify: { submit: true, approve: true, requireNumber: true, maxWords: 0 },
  achievements: { submit: true, approve: true, minWords: 10, allowProblemsInstead: true },
  problemAndIssues: { submit: false, approve: false },
  description: { submit: false, approve: false, minWords: 10 },
  toolsUsed: { submit: true, approve: true },
  percentageComplete: { submit: true, approve: true, minValue: 1 },
  keyStep: { submit: false, approve: true },
  subTask: { submit: false, approve: true },
  scopeOfImprovements: { submit: false, approve: false },
};

export const TIMESHEET_FIELD_LABELS = {
  quantify: "Quantify Your Result",
  achievements: "Achievements",
  problemAndIssues: "Problems & Issues",
  description: "Description",
  toolsUsed: "Tools Used",
  percentageComplete: "Completion Percentage",
  keyStep: "Key Step",
  subTask: "Subtask",
  scopeOfImprovements: "Scope of Improvements",
} as const;

const PLACEHOLDERS = new Set([
  "n/a", "na", "none", "nil", "null", "undefined", "no", "nothing", "test", "-", "--", ".", "...", "tbd",
  // System-generated filler that must never count as real content
  "auto-filled from daily plan", "scheduled via plan for day",
]);

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|dozen|half|all|both|single)\b/i;

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isBlank(value: unknown): boolean {
  const text = cleanText(value);
  return !text || PLACEHOLDERS.has(text.toLowerCase());
}

function wordCount(text: string): number {
  return text.split(" ").filter(Boolean).length;
}

function isGibberish(text: string): boolean {
  // "aaaaaaaaaa", "1111111111": fewer than 4 distinct characters
  return new Set(text.toLowerCase().replace(/\s/g, "").split("")).size < 4;
}

interface TextParams { mandatory: boolean; minWords?: number; maxWords?: number; needsNumber?: boolean }

// Checks a text value. Mandatory => empty/placeholder is an error and the 10-character minimum applies.
// Optional => empty/placeholder is fine; a filled value must still meet the minimum word count.
function checkText(label: string, value: unknown, p: TextParams): string | null {
  const text = cleanText(value);
  if (!text || PLACEHOLDERS.has(text.toLowerCase())) {
    if (!p.mandatory) return null;
    return text ? `${label} cannot be a placeholder such as "${text}"` : `${label} is required`;
  }
  if (p.mandatory) {
    if (text.length < TIMESHEET_MIN_CHARS) {
      return `${label} must be at least ${TIMESHEET_MIN_CHARS} characters (currently ${text.length})`;
    }
    if (isGibberish(text)) return `${label} must be meaningful, not repeated characters`;
    
    const words = wordCount(text);
    if (p.minWords && p.minWords > 0 && words < p.minWords) {
      return `${label} must be at least ${p.minWords} words (currently ${words})`;
    }
    // maxWords = 0 means unlimited (no cap).
    if (p.maxWords && p.maxWords > 0 && words > p.maxWords) {
      return `${label} must be at most ${p.maxWords} words (currently ${words})`;
    }
    if (p.needsNumber && !/\d/.test(text) && !NUMBER_WORDS.test(text)) {
      return `${label} must contain a measurable result, e.g. the number of items/tasks completed ("5 reports", "12 test cases")`;
    }
  }
  return null;
}

// "Task | Subtask | Description" is how the task text is stored.
export function extractDescription(entry: { description?: unknown; taskDescription?: unknown }): string {
  if (entry.description !== undefined && entry.description !== null) return String(entry.description);
  return String(entry.taskDescription ?? "").split(" | ").slice(2).join(" | ");
}

export function extractSubTask(entry: { subTask?: unknown; taskDescription?: unknown }): string {
  if (entry.subTask !== undefined && entry.subTask !== null) return String(entry.subTask);
  return String(entry.taskDescription ?? "").split(" | ")[1] ?? "";
}

// Returns every problem found (empty array = valid).
export function validateWithRules(entry: any, rules: ValidationRules, stage: ValidationStage): string[] {
  const e = entry ?? {};
  const L = TIMESHEET_FIELD_LABELS;
  const problems: string[] = [];
  const push = (msg: string | null) => { if (msg) problems.push(msg); };

  // Quantify Your Result — presence + number check + optional max word cap
  push(checkText(L.quantify, e.quantify, {
    mandatory: rules.quantify[stage],
    needsNumber: rules.quantify.requireNumber,
    maxWords: rules.quantify.maxWords,
  }));

  // Achievements, or Problems & Issues when there is no achievement
  const ach = rules.achievements;
  if (!isBlank(e.achievements)) {
    push(checkText(L.achievements, e.achievements, { mandatory: ach[stage], minWords: ach.minWords }));
  } else if (ach[stage]) {
    if (!ach.allowProblemsInstead) {
      problems.push(`${L.achievements} is required`);
    } else if (isBlank(e.problemAndIssues)) {
      problems.push(
        `Achievements is empty: provide Achievements, or a meaningful Problems & Issues entry (min ${TIMESHEET_MIN_CHARS} characters)`
      );
    } else {
      const err = checkText(L.problemAndIssues, e.problemAndIssues, { mandatory: true });
      if (err) problems.push(`Achievements is empty and ${err}`);
    }
  }

  // Problems & Issues as a mandatory field of its own
  if (rules.problemAndIssues[stage]) {
    push(checkText(L.problemAndIssues, e.problemAndIssues, { mandatory: true }));
  }

  // Description
  push(checkText(L.description, extractDescription(e), {
    mandatory: rules.description[stage],
    minWords: rules.description.minWords,
  }));

  // Tools Used (picked from a list, so "mandatory" = at least one tool)
  if (rules.toolsUsed[stage]) {
    const tools = Array.isArray(e.toolsUsed) ? e.toolsUsed : [];
    if (!tools.some((t: unknown) => cleanText(t))) problems.push(`${L.toolsUsed} is required (select at least one tool)`);
  }

  // Completion Percentage
  const raw = e.percentageComplete;
  const pct = typeof raw === "number" ? raw : raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(pct)) {
    if (rules.percentageComplete[stage]) problems.push(`${L.percentageComplete} is required`);
  } else if (rules.percentageComplete[stage] && (pct < rules.percentageComplete.minValue || pct > 100)) {
    problems.push(`${L.percentageComplete} must be between ${rules.percentageComplete.minValue} and 100`);
  }

  // Key Step / Subtask / Scope of Improvements
  // Key Step and Subtask only need to be present (no length rule), like Tools Used.
  if (rules.keyStep[stage] && isBlank(e.keyStep)) problems.push(`${L.keyStep} must be filled`);
  if (rules.subTask[stage] && isBlank(extractSubTask(e))) problems.push(`${L.subTask} must be filled`);
  push(checkText(L.scopeOfImprovements, e.scopeOfImprovements, { mandatory: rules.scopeOfImprovements[stage] }));

  return problems;
}

// Convenience wrapper using the built-in starting rules (only for callers that have no saved rules yet).
export function validateTimesheetEntry(entry: any): string[] {
  return validateWithRules(entry, DEFAULT_VALIDATION_RULES, "submit");
}

// Sanitises rules coming from the browser or the database: unknown keys dropped, wrong types fall
// back to the starting rules, numbers clamped.
export function normalizeValidationRules(input: any): ValidationRules {
  const d = DEFAULT_VALIDATION_RULES;
  const src = input && typeof input === "object" ? input : {};
  const bool = (v: any, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const num = (v: any, fallback: number, max: number) => {
    const n = Number(v);
    return v !== "" && v !== null && v !== undefined && Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), max) : fallback;
  };
  const g = (k: keyof ValidationRules): any => (src[k] && typeof src[k] === "object" ? src[k] : {});
  const toggle = (k: keyof ValidationRules): StageToggle => ({
    submit: bool(g(k).submit, d[k].submit),
    approve: bool(g(k).approve, d[k].approve),
  });

  return {
    quantify: {
      ...toggle("quantify"),
      requireNumber: bool(g("quantify").requireNumber, d.quantify.requireNumber),
      // maxWords = 0 means no cap. DB may store a value like 15 from older admin config.
      // Default to 0 (unlimited) so existing entries aren't blocked by a tight word limit.
      maxWords: num(g("quantify").maxWords, d.quantify.maxWords, 10000),
    },
    achievements: {
      ...toggle("achievements"),
      minWords: num(g("achievements").minWords ?? g("achievements").maxWords, d.achievements.minWords, 10000),
      allowProblemsInstead: bool(g("achievements").allowProblemsInstead, d.achievements.allowProblemsInstead),
    },
    problemAndIssues: toggle("problemAndIssues"),
    description: {
      ...toggle("description"),
      minWords: num(g("description").minWords ?? g("description").maxWords, d.description.minWords, 10000),
    },
    toolsUsed: toggle("toolsUsed"),
    percentageComplete: {
      ...toggle("percentageComplete"),
      minValue: num(g("percentageComplete").minValue, d.percentageComplete.minValue, 100),
    },
    keyStep: toggle("keyStep"),
    subTask: toggle("subTask"),
    scopeOfImprovements: toggle("scopeOfImprovements"),
  };
}

// ---------- 24-hour submission period ----------
// Timesheet validation (and the admin "Auto Reject" switch) only applies while an entry is inside its
// submission period. For a work date the period is the 24 hours of that date; for a rejected entry that is
// being re-applied it is the 24 hours after the rejection. Outside the period nothing is validated here.
export const SUBMISSION_WINDOW_HOURS = 24;

export function submissionWindowEnd(workDate: string, rejectedAt?: Date | string | null): Date {
  const start = new Date(`${String(workDate).slice(0, 10)}T00:00:00`);
  let end = start.getTime() + SUBMISSION_WINDOW_HOURS * 3600 * 1000;
  if (rejectedAt) {
    const r = new Date(rejectedAt).getTime();
    if (Number.isFinite(r)) end = Math.max(end, r + SUBMISSION_WINDOW_HOURS * 3600 * 1000);
  }
  return new Date(end);
}

export function isWithinSubmissionWindow(
  workDate: string,
  now: Date = new Date(),
  rejectedAt?: Date | string | null
): boolean {
  const end = submissionWindowEnd(workDate, rejectedAt);
  return Number.isFinite(end.getTime()) && now.getTime() < end.getTime();
}