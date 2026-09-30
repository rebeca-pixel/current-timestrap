type Badge = { id: string; name: string; awardedAt: string };

const POINTS_KEY = 'ts_points_v1';
const STREAK_KEY = 'ts_streak_v1';
const BADGES_KEY = 'ts_badges_v1';
const DAILY_SUMMARY_KEY = 'ts_daily_points_summary_v1';

function projectPointsKey(projectId: string) {
  return `ts_points_v1_project_${String(projectId).replace(/\s+/g, '_')}`;
}

function projectLastActiveKey(projectId: string) {
  return `ts_points_v1_project_${String(projectId).replace(/\s+/g, '_')}_lastActive`;
}

// In-memory cache for project points (DB is source-of-truth)
const projectCache: Record<string, number> = {};
const projectLastActiveCache: Record<string, string | null> = {};

function readNumber(key: string) {
  try { return parseInt(localStorage.getItem(key) || '0') || 0; } catch { return 0; }
}

function writeNumber(key: string, value: number) {
  try { localStorage.setItem(key, String(value)); } catch { }
}

function readBadges(): Badge[] {
  try { return JSON.parse(localStorage.getItem(BADGES_KEY) || '[]'); } catch { return []; }
}

function writeBadges(b: Badge[]) { try { localStorage.setItem(BADGES_KEY, JSON.stringify(b)); } catch { } }

export function getPoints() { return readNumber(POINTS_KEY); }

export function getPointsForProject(projectId: string) {
  try { return typeof projectCache[projectId] === 'number' ? projectCache[projectId] : 0; } catch { return 0; }
}

/**
 * Calculates decayed points for a project based on inactivity.
 * Decay starts after 2 days of inactivity at a rate of 5% per day.
 */
export function getDecayedPointsForProject(projectId: string) {
  try {
    const points = typeof projectCache[projectId] === 'number' ? projectCache[projectId] : 0;
    const lastActive = projectLastActiveCache[projectId];
    if (!lastActive || points === 0) return points;
    const lastActiveDate = new Date(lastActive);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - lastActiveDate.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 2) return points;
    const decayDays = diffDays - 2;
    const decayFactor = Math.pow(0.95, decayDays);
    return Math.floor(points * decayFactor);
  } catch { return 0; }
}

export function addPoints(amount: number, reason?: string) {
  const prev = getPoints();
  const next = prev + Math.max(0, Math.floor(amount));
  writeNumber(POINTS_KEY, next);

  // badges logic: first task, milestone, streaks handled elsewhere
  const unlocked: string[] = [];
  if (prev === 0) {
    // first points
    const badges = readBadges();
    badges.push({ id: 'first-task', name: 'First Task', awardedAt: new Date().toISOString() });
    writeBadges(badges);
    unlocked.push('First Task');
  }

  return { pointsAdded: next - prev, totalPoints: next, unlockedBadges: unlocked };
}

export function subtractPoints(amount: number, reason?: string) {
  const prev = getPoints();
  const dec = Math.max(0, Math.floor(Math.abs(amount)));
  const next = Math.max(0, prev - dec);
  writeNumber(POINTS_KEY, next);
  return { pointsRemoved: prev - next, totalPoints: next };
}

/* ══════════════════════════════════════════════════════════════
   DAILY POINTS SUMMARY (NEW)
   - Tracks per-task points earned (on-time) and points
     deducted (overdue) for the current day.
   - Used to display the Daily Points Summary dialog after
     final timesheet submit.
══════════════════════════════════════════════════════════════ */

export interface DailyPointsEntry {
  id: string;
  taskName: string;
  projectName: string;
  amount: number;            // +ve for earned, -ve for deducted
  type: 'earned' | 'deducted';
  reason?: string;           // 'on-time' | 'overdue'
  timestamp: string;         // ISO
}

export interface DailyPointsSummary {
  date: string;              // YYYY-MM-DD
  entries: DailyPointsEntry[];
  totalEarned: number;
  totalDeducted: number;
  netPoints: number;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readDailySummary(): DailyPointsSummary {
  const empty: DailyPointsSummary = {
    date: todayKey(),
    entries: [],
    totalEarned: 0,
    totalDeducted: 0,
    netPoints: 0,
  };
  try {
    const raw = localStorage.getItem(DAILY_SUMMARY_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    // If date doesn't match today, reset
    if (parsed.date !== empty.date) return empty;
    return {
      date: parsed.date || empty.date,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      totalEarned: typeof parsed.totalEarned === 'number' ? parsed.totalEarned : 0,
      totalDeducted: typeof parsed.totalDeducted === 'number' ? parsed.totalDeducted : 0,
      netPoints: typeof parsed.netPoints === 'number' ? parsed.netPoints : 0,
    };
  } catch { return empty; }
}

function writeDailySummary(summary: DailyPointsSummary) {
  try { localStorage.setItem(DAILY_SUMMARY_KEY, JSON.stringify(summary)); } catch { }
}

export function getDailyPointsSummary(): DailyPointsSummary {
  return readDailySummary();
}

export function clearDailyPointsSummary() {
  try { localStorage.removeItem(DAILY_SUMMARY_KEY); } catch { }
}

function pushDailyEntry(entry: Omit<DailyPointsEntry, 'id' | 'timestamp'>) {
  const summary = readDailySummary();
  const newEntry: DailyPointsEntry = {
    id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  summary.entries.push(newEntry);
  if (entry.type === 'earned') {
    summary.totalEarned += Math.abs(entry.amount);
    summary.netPoints += Math.abs(entry.amount);
  } else {
    summary.totalDeducted += Math.abs(entry.amount);
    summary.netPoints -= Math.abs(entry.amount);
  }
  writeDailySummary(summary);

  // Dispatch event so any listening component (Achievement page) can update
  try {
    window.dispatchEvent(new CustomEvent('gamification:daily-summary-updated', { detail: summary }));
  } catch {}

  return newEntry;
}

// Per-project points (stored in localStorage under project-specific keys)
// Extended to optionally accept a taskName so that we can record a
// daily points entry when the task is completed on-time.
export function addPointsForProject(
  projectId: string,
  amount: number,
  reason?: string,
  meta?: { taskName?: string; onTime?: boolean }
) {
  try {
    const key = projectPointsKey(projectId);
    const prev = typeof projectCache[projectId] === 'number' ? projectCache[projectId] : 0;
    const next = prev + Math.max(0, Math.floor(amount));
    try { projectCache[projectId] = next; } catch {}
    try { projectLastActiveCache[projectId] = new Date().toISOString(); } catch {}
    // persist to server async (best-effort)
    try { persistProjectDeltaToServer(projectId, Math.max(0, Math.floor(amount)), true); } catch {}

    const unlocked: string[] = [];
    // simple badge: first task on this project
    if (prev === 0) {
      const badges = readBadges();
      badges.push({ id: `first-task-${projectId}`, name: `First Task (${projectId})`, awardedAt: new Date().toISOString() });
      writeBadges(badges);
      unlocked.push(`First Task (${projectId})`);
    }

    // Record daily summary entry ONLY when called with a task name
    // so that we don't pollute the daily summary with non-task
    // point additions (e.g. badges / system actions).
    if (meta && meta.taskName) {
      pushDailyEntry({
        taskName: meta.taskName,
        projectName: projectId,
        amount: Math.max(0, Math.floor(amount)),
        type: 'earned',
        reason: meta.onTime === false ? 'overdue' : 'on-time',
      });
      // Add points to the employee's global score as well
      addPoints(Math.max(0, Math.floor(amount)), reason);
    }

    return { pointsAdded: next - prev, totalPoints: next, unlockedBadges: unlocked };
  } catch (e) {
    return { pointsAdded: 0, totalPoints: getPointsForProject(projectId), unlockedBadges: [] };
  }
}

// Subtract points from a project (penalty). Will not set points below 0.
// Extended to record a daily points entry for the deduction (overdue task).
export function subtractPointsForProject(
  projectId: string,
  amount: number,
  reason?: string,
  meta?: { taskName?: string; overdue?: boolean }
) {
  try {
    const key = projectPointsKey(projectId);
    const prev = typeof projectCache[projectId] === 'number' ? projectCache[projectId] : 0;
    const dec = Math.max(0, Math.floor(Math.abs(amount)));
    const next = Math.max(0, prev - dec);
    try { projectCache[projectId] = next; } catch {}

    const removed = prev - next;
    const unlocked: string[] = [];
    // also attempt to persist to server
    try {
      fetch(`/api/project-points/${encodeURIComponent(projectId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: -dec, touchLastActive: false })
      }).catch(() => { /* ignore */ });
    } catch { }

    // Record daily summary entry ONLY when called with a task name
    if (meta && meta.taskName) {
      pushDailyEntry({
        taskName: meta.taskName,
        projectName: projectId,
        amount: -dec,
        type: 'deducted',
        reason: meta.overdue === false ? 'on-time' : 'overdue',
      });
      // Deduct points from the employee's global score as well
      subtractPoints(dec, reason);
    }

    return { pointsRemoved: removed, totalPoints: next, unlockedBadges: unlocked };
  } catch (e) {
    return { pointsRemoved: 0, totalPoints: getPointsForProject(projectId), unlockedBadges: [] };
  }
}

// Try to persist project points to server asynchronously. Does not change local return value.
function persistProjectDeltaToServer(projectId: string, delta: number, touchLastActive = false) {
  try {
    fetch(`/api/project-points/${encodeURIComponent(projectId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta, touchLastActive })
    }).catch(() => { /* ignore */ });
  } catch { }
}

// Apply decay to all stored project point buckets once (persist decay so trees reflect inactivity)
function applyDecayToAllProjectsOnce() {
  try {
    const prefix = 'ts_points_v1_project_';
    const keys = Object.keys(localStorage || {});
    for (const k of keys) {
      if (!k.startsWith(prefix)) continue;
      // skip lastActive keys
      if (k.endsWith('_lastActive')) continue;
      const projectKeySuffix = k.slice(prefix.length);
      const prev = parseInt(localStorage.getItem(k) || '0') || 0;
      const decayed = getDecayedPointsForProject(projectKeySuffix);
      if (decayed < prev) {
        try { localStorage.setItem(k, String(decayed)); } catch { }
      }
    }
  } catch (e) {
    // ignore
  }
}

// Run decay once shortly after module load to persist inactivity penalties
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    setTimeout(() => applyDecayToAllProjectsOnce(), 800);
  }
} catch (e) { }

export function getProjectLastActive(projectId: string) {
  try { return projectLastActiveCache[projectId] || null; } catch { return null; }
}

export function getProjectDecayStatus(projectId: string) {
  // We will try to fetch status from server; fallback to local calculation
  try {
    const lastActive = getProjectLastActive(projectId);
    if (!lastActive) return 'active';
    const diffTime = Math.abs(new Date().getTime() - new Date(lastActive).getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 7) return 'dying';
    if (diffDays > 2) return 'wilting';
    return 'active';
  } catch { return 'active'; }
}

// Async server-backed helpers
export async function fetchProjectPoints(projectId: string) {
  try {
    const res = await fetch(`/api/project-points/${encodeURIComponent(projectId)}`);
    if (!res.ok) throw new Error('failed');
    const json = await res.json();
    const pts = parseInt(json.points || 0) || 0;
    // store in-memory cache
    try { projectCache[projectId] = pts; } catch {}
    try { projectLastActiveCache[projectId] = json.lastActive || null; } catch {}
    return pts;
  } catch (e) {
    try { return typeof projectCache[projectId] === 'number' ? projectCache[projectId] : 0; } catch { return 0; }
  }
}

export async function fetchProjectDecayStatus(projectId: string) {
  try {
    const res = await fetch(`/api/project-points/${encodeURIComponent(projectId)}`);
    if (!res.ok) throw new Error('failed');
    const json = await res.json();
    const last = json.lastActive || null;
    if (!last) return 'active';
    const diffTime = Math.abs(new Date().getTime() - new Date(last).getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 7) return 'dying';
    if (diffDays > 2) return 'wilting';
    return 'active';
  } catch (e) {
    return getProjectDecayStatus(projectId);
  }
}

export function getBadges() { return readBadges(); }

export function getStreak() { return readNumber(STREAK_KEY); }

export function incrementStreak() {
  const s = getStreak() + 1;
  try { localStorage.setItem(STREAK_KEY, String(s)); } catch { }
  const unlocked: string[] = [];
  if (s === 3) {
    const badges = readBadges();
    badges.push({ id: '3-day-streak', name: '3-Day Streak', awardedAt: new Date().toISOString() });
    writeBadges(badges);
    unlocked.push('3-Day Streak');
  }
  return { streak: s, unlockedBadges: unlocked };
}

export function resetStreak() { try { localStorage.setItem(STREAK_KEY, '0'); } catch { } }

export default {
  getPoints,
  addPoints,
  getBadges,
  getStreak,
  incrementStreak,
  resetStreak,
  getPointsForProject,
  addPointsForProject,
  subtractPointsForProject,
  getDecayedPointsForProject,
  getProjectDecayStatus,
  getProjectLastActive,
  // New for daily summary
  getDailyPointsSummary,
  clearDailyPointsSummary,
};
