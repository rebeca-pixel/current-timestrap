import { useState, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { CheckCircle2, ArrowRight, ArrowLeft, Send, AlertTriangle, Clock, Calendar as CalendarIcon, ClipboardList, Target, Power, PowerOff, ArrowUp, ArrowDown, Search as PlannedTaskSearchIcon, ChevronUp, ChevronDown, Minus, Plus, Copy, ShieldCheck, Loader2, X, History, Coffee, Pin, MoreHorizontal } from 'lucide-react';
import { motion } from 'framer-motion';
import { format, addDays } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TOOLS_LIST, isNonDevelopmentTool } from '@shared/toolCategories';

/* ------------------------------------------------------------------ */
/*  Scheduling helpers (module level so they are pure & easy to test)  */
/* ------------------------------------------------------------------ */

const toMinutes = (time: string) => {
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

const toTime = (minutes: number) => {
  const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

// Friendly 12-hour display, e.g. 1020 -> "5:00 PM"
const toDisplayTime = (minutes: number) => {
  const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const h24 = Math.floor(safe / 60);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(safe % 60).padStart(2, '0')} ${period}`;
};

const fmtDuration = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const WORK_DAY_START_MIN = 6 * 60;   // 6:00 AM
const WORK_DAY_NOON_MIN = 12 * 60;   // 12:00 PM
const WORK_DAY_END_MIN = 23 * 60;    // 11:00 PM
const MIN_BLOCK_MINUTES = 15;
const MAX_BLOCK_MINUTES = 60;        // longest single plan block (change here if policy changes)
const DURATION_CHOICES = [15, 30, 45, 60];
const DEFAULT_BLOCK_MINUTES = 30;

// Breaks float: they are placed as soon as the running clock reaches their
// target time, so nothing can ever overlap them and no gaps are created.
const BREAK_DEFINITIONS = [
  { id: 'break-morning', task_name: 'Morning Break', start: 11 * 60, duration: 15 },
  { id: 'break-lunch', task_name: 'Lunch', start: 14 * 60, duration: 30 },
  { id: 'break-evening', task_name: 'Evening Break', start: 17 * 60, duration: 15 },
];

const clampDuration = (d: number) => Math.max(MIN_BLOCK_MINUTES, Math.min(MAX_BLOCK_MINUTES, d));

type ScheduledItem = any;

/**
 * Turns the employee's ordered task list + one "day starts at" time into a
 * conflict-free timeline. Task N always starts when task N-1 ends.
 * An optional fixed start (e.g. a meeting) is honoured when it is later than
 * the running clock; if it is earlier, the task simply follows the previous one.
 */
function layoutPlan(tasks: any[], dayStart: number, breaksOn: Record<string, boolean>): ScheduledItem[] {
  const pendingBreaks = BREAK_DEFINITIONS
    .filter(b => breaksOn[b.id] && b.start >= dayStart)
    .sort((a, b) => a.start - b.start);

  const out: ScheduledItem[] = [];
  let cursor = dayStart;
  let bi = 0;

  const pushBreak = (b: typeof BREAK_DEFINITIONS[number], start: number) => {
    const end = start + b.duration;
    out.push({
      id: b.id,
      instanceId: b.id,
      task_name: b.task_name,
      projectName: 'Break',
      isBreak: true,
      source: 'Break',
      startTime: toTime(start),
      endTime: toTime(end),
      durationMinutes: b.duration,
      _startMin: start,
      _endMin: end,
      scheduleData: { startTime: toTime(start), endTime: toTime(end), durationMinutes: b.duration },
    });
    cursor = end;
    bi++;
  };

  // Place every break that is due before the next block begins (or that fits inside a gap).
  const flushBreaks = (gapUntil: number | null) => {
    while (bi < pendingBreaks.length) {
      const b = pendingBreaks[bi];
      if (cursor >= b.start) pushBreak(b, cursor);
      else if (gapUntil !== null && b.start + b.duration <= gapUntil) pushBreak(b, b.start);
      else break;
    }
  };

  tasks.forEach(task => {
    const pinned: number | null = typeof task.pinnedStart === 'number' ? task.pinnedStart : null;
    flushBreaks(pinned !== null && pinned > cursor ? pinned : null);

    const start = pinned !== null ? Math.max(cursor, pinned) : cursor;
    const pinIgnored = pinned !== null && pinned < start;
    const duration = clampDuration(task.durationMinutes ?? task.scheduleData?.durationMinutes ?? DEFAULT_BLOCK_MINUTES);
    const end = start + duration;
    const prevSchedule = typeof task.scheduleData === 'object' && task.scheduleData ? task.scheduleData : {};

    out.push({
      ...task,
      isBreak: false,
      startTime: toTime(start),
      endTime: toTime(end),
      durationMinutes: duration,
      _startMin: start,
      _endMin: end,
      _pinIgnored: pinIgnored,
      isAutoSelected: !!task.isAutoSelected || !!task.isLocked || task.source === 'PMS',
      scheduleData: {
        ...prevSchedule,
        startTime: toTime(start),
        endTime: toTime(end),
        durationMinutes: duration,
        extensionReason: prevSchedule.extensionReason || task.extensionReason || '',
      },
    });
    cursor = end;
  });

  return out.map((item, idx) => ({
    ...item,
    order: idx + 1,
    scheduleData: { ...item.scheduleData, order: idx + 1 },
  }));
}

function getTimingErrors(scheduled: ScheduledItem[], dayStart: number): string[] {
  const errors: string[] = [];
  if (scheduled.length === 0) return errors;

  if (dayStart >= WORK_DAY_NOON_MIN) {
    errors.push(`Your day starts at ${toDisplayTime(dayStart)}. Work usually starts in the morning — check the AM/PM of your start time.`);
  }
  if (dayStart < WORK_DAY_START_MIN) {
    errors.push(`Your day starts at ${toDisplayTime(dayStart)}, which is before 6:00 AM. Check the AM/PM of your start time.`);
  }
  const last = scheduled[scheduled.length - 1];
  if (last._endMin > WORK_DAY_END_MIN) {
    errors.push(`Your plan runs until ${toDisplayTime(last._endMin)}, past 11:00 PM. Start earlier or remove a task.`);
  }
  return errors;
}


const GLASS = 'rounded-3xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]';

// This page is always light. The app's global dark/light switch works by inverting the whole screen,
// so we (1) override the theme variables locally with light values and (2) cancel the inversion
// whenever it is active. Popups (which render outside the page) get the same treatment.
const LIGHT_VARS = {
  '--background': '0 0% 100%', '--foreground': '222 47% 11%',
  '--card': '0 0% 100%', '--card-foreground': '222 47% 11%',
  '--popover': '0 0% 100%', '--popover-foreground': '222 47% 11%',
  '--muted': '210 40% 96%', '--muted-foreground': '215 16% 40%',
  '--accent': '210 40% 96%', '--accent-foreground': '222 47% 11%',
  '--secondary': '210 40% 96%', '--secondary-foreground': '222 47% 11%',
  '--border': '214 32% 91%', '--input': '214 32% 80%', '--ring': '217 91% 60%',
  '--primary': '217 91% 45%', '--primary-foreground': '0 0% 100%', '--primary-border': 'hsl(217 91% 40%)',
  '--destructive': '0 84% 45%', '--destructive-foreground': '0 0% 100%', '--destructive-border': 'hsl(0 84% 40%)',
  '--secondary-border': 'hsl(214 32% 85%)', '--accent-border': 'hsl(214 32% 88%)', '--muted-border': 'hsl(214 32% 88%)',
  '--popover-border': 'hsl(214 32% 88%)', '--card-border': 'hsl(214 32% 91%)',
  '--button-outline': 'rgba(15,23,42,0.15)', '--elevate-1': 'rgba(0,0,0,.04)', '--elevate-2': 'rgba(0,0,0,.08)',
  colorScheme: 'light',
} as CSSProperties;
const CANCEL_INVERT = 'invert(1) hue-rotate(180deg)';
// NOTE: index.css has a global rule that forces any element with an INLINE white background
// (#fff / white / rgb(255,255,255)) to black while the app is toggled. Never use an inline white
// background on this page - use the `bg-white` class instead, which that rule doesn't touch.

// The page is designed to look like "browser zoom 80%" while the browser is at 100%.
// Change this one number to make the whole page bigger (e.g. 0.9) or smaller (e.g. 0.75).
// Only applied on desktop widths; phones/tablets (stacked layout) stay at 100%.
const PAGE_SCALE_DESKTOP = 0.8;
function usePageScale() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState<boolean>(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide ? PAGE_SCALE_DESKTOP : 1;
}

// Does this element apply an invert() filter? (read from the real computed style, so it works no matter
// HOW the app's toggle is implemented: data-theme, a class, inline style, on <html>, <body> or #root...)
const hasInvertFilter = (el: Element) => {
  const f = getComputedStyle(el).filter;
  return !!f && f !== 'none' && f.includes('invert');
};

// Walks from `start` up to <html>, collecting every element that inverts the screen.
const getInvertingChain = (start: Element | null) => {
  const chain: Element[] = [];
  for (let el: Element | null = start; el; el = el.parentElement) chain.push(el);
  return chain;
};

/**
 * Returns true while an odd number of ancestors invert the screen (i.e. the page would look dark/inverted).
 * - Pass a ref to the page's root element: only its ancestors are checked.
 * - Omit the ref for popups rendered in a portal: they live directly under <body>, so <body> and <html> are checked.
 */
function useIsInverted(ref?: RefObject<HTMLElement | null>) {
  const compute = () => {
    if (typeof document === 'undefined') return false;
    const start = ref?.current ? ref.current.parentElement : document.body;
    return getInvertingChain(start).filter(hasInvertFilter).length % 2 === 1;
  };
  const [inverted, setInverted] = useState<boolean>(compute);

  // Re-check before paint on mount so there is no flash of the wrong theme.
  useLayoutEffect(() => { setInverted(compute()); });

  useEffect(() => {
    const update = () => setInverted(prev => { const next = compute(); return prev === next ? prev : next; });

    // Watch every ancestor for ANY attribute change (class, data-theme, style, ...)
    const start = ref?.current ? ref.current.parentElement : document.body;
    const obs = new MutationObserver(update);
    getInvertingChain(start).forEach(el => obs.observe(el, { attributes: true }));

    // Safety nets: system theme change, and a cheap poll in case the filter is switched by a stylesheet swap
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', update);
    window.addEventListener('storage', update);
    const poll = window.setInterval(update, 500);

    update();
    return () => {
      obs.disconnect();
      mq?.removeEventListener?.('change', update);
      window.removeEventListener('storage', update);
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return inverted;
}

// A stable colour per project so the same project always looks the same everywhere on the page
const projectHue = (_name: string = '') => 215; // single accent colour (kept as a function so per-project colours can be re-enabled)
const hsla = (h: number, alpha: number, light = 60) => `hsl(${h} 85% ${light}% / ${alpha})`;

function StepBadge({ n }: { n: number }) {
  return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black text-white shrink-0 shadow-md shadow-blue-300/50" style={{ background: '#2563eb' }}>{n}</span>
  );
}

function ProgressRing({ pct, done }: { pct: number; done: boolean }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg viewBox="0 0 60 60" className="w-12 h-12 -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle
          cx="30" cy="30" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          stroke={done ? '#10b981' : '#3b82f6'}
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.min(100, pct)) / 100}
          style={{ transition: 'stroke-dashoffset .4s ease' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black">{done ? '✓' : `${pct}%`}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PlanForDayPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // userTasks = the employee's ordered work blocks (breaks are derived, not stored)
  const [userTasks, setUserTasks] = useState<any[]>([]);
  const [dayStartMin, setDayStartMin] = useState<number>(() => {
    const now = new Date();
    const anchor = Math.floor((now.getHours() * 60 + now.getMinutes() - 15) / 5) * 5;
    return Math.min(Math.max(anchor, 9 * 60), WORK_DAY_END_MIN);
  });
  const [breaksOn, setBreaksOn] = useState<Record<string, boolean>>({
    'break-morning': true, 'break-lunch': true, 'break-evening': true,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const initialisedRef = useRef(false);

  const [commonReason, setCommonReason] = useState('');
  const [commonNewDueDate, setCommonNewDueDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [showUnselectedForm, setShowUnselectedForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'plan' | 'history'>('plan');
  const [historyDate, setHistoryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [assignedTaskSearch, setAssignedTaskSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectDropdownSearch, setProjectDropdownSearch] = useState('');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [adminViewType, setAdminViewType] = useState<'admin' | 'department' | 'my-tasks'>('admin');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inverted = useIsInverted(rootRef);
  const pageScale = usePageScale();

  const today = format(new Date(), 'yyyy-MM-dd');
  const isController = user?.role === 'admin' || user?.role === 'manager' || user?.employeeCode === 'E0046';

  /* ---------- derived schedule: the single source of truth ---------- */
  const scheduled = useMemo(
    () => layoutPlan(userTasks, dayStartMin, breaksOn),
    [userTasks, dayStartMin, breaksOn],
  );
  const timingErrors = getTimingErrors(scheduled, dayStartMin);
  const totalWorkingMinutes = scheduled.reduce((sum, t) => sum + t.durationMinutes, 0);
  const dayEndMin = scheduled.length ? scheduled[scheduled.length - 1]._endMin : dayStartMin;

  /* ---------- task mutations ---------- */
  const patchTask = (instanceId: string, patch: (t: any) => any) =>
    setUserTasks(prev => prev.map(t => (t.instanceId === instanceId ? patch(t) : t)));

  const updateTaskSchedule = (instanceId: string, field: 'extensionReason', value: string) =>
    patchTask(instanceId, t => ({ ...t, scheduleData: { ...(t.scheduleData || {}), [field]: value } }));

  const updateTaskSubtask = (instanceId: string, subtaskIds: string[], subtaskNames: string[]) =>
    patchTask(instanceId, task => ({
      ...task,
      subtaskId: subtaskIds.length > 0 ? subtaskIds[0] : undefined,
      subtaskIds: subtaskIds.length > 0 ? subtaskIds : undefined,
      subtaskName: subtaskNames.length > 0 ? subtaskNames.join(', ') : undefined,
      subtaskNames: subtaskNames.length > 0 ? subtaskNames : undefined,
      scheduleData: {
        ...(task.scheduleData || {}),
        subtaskId: subtaskIds.length > 0 ? subtaskIds[0] : null,
        subtaskIds: subtaskIds.length > 0 ? subtaskIds : null,
        subtaskName: subtaskNames.length > 0 ? subtaskNames.join(', ') : null,
        subtaskNames: subtaskNames.length > 0 ? subtaskNames : null,
      },
    }));

  const updateTaskTools = (instanceId: string, tools: string[]) =>
    patchTask(instanceId, task => {
      const joined = tools.length > 0 ? tools.join(', ') : undefined;
      return {
        ...task,
        tool: joined,
        tools: tools.length > 0 ? tools : undefined,
        scheduleData: { ...(task.scheduleData || {}), tool: joined || null, tools: tools.length > 0 ? tools : null },
      };
    });

  const setTaskDuration = (instanceId: string, durationMin: number) =>
    patchTask(instanceId, t => ({ ...t, durationMinutes: clampDuration(durationMin) }));

  const setTaskPin = (instanceId: string, pinned: number | null) =>
    patchTask(instanceId, t => ({ ...t, pinnedStart: pinned === null ? undefined : pinned }));

  // Edit one task's time directly. Start -> fixes that task at that time (later tasks follow it);
  // End -> sets that task's length. Everything after re-aligns automatically.
  const editTaskTime = (item: any, which: 'start' | 'end', value: number) => {
    const idx = scheduled.findIndex(s => s.instanceId === item.instanceId);
    if (idx < 0) return;
    if (which === 'start') {
      const isFirstWork = !scheduled.slice(0, idx).some(s => !s.isBreak);
      if (isFirstWork) { setDayStartMin(value); setTaskPin(item.instanceId, null); return; }
      const prevEnd = scheduled[idx - 1]._endMin;
      if (value <= prevEnd) {
        setTaskPin(item.instanceId, null);
        if (value < prevEnd) toast({ title: 'Starts after the previous task', description: `The earliest start here is ${toDisplayTime(prevEnd)}. To go earlier, shorten the task above or move this task up.` });
        return;
      }
      setTaskPin(item.instanceId, value);
      return;
    }
    const duration = value - item._startMin;
    if (duration < MIN_BLOCK_MINUTES) {
      toast({ title: 'Too short', description: `A task needs at least ${MIN_BLOCK_MINUTES} minutes.` });
      return;
    }
    if (duration > MAX_BLOCK_MINUTES) {
      toast({ title: 'Max 1 hour per block', description: 'Use the duplicate option to add another block for the same task.' });
    }
    setTaskDuration(item.instanceId, duration);
  };

  const clearGapBefore = (idx: number) => {
    const next = scheduled.slice(idx).find(s => !s.isBreak);
    if (next) setTaskPin(next.instanceId, null);
  };

  const moveTask = (instanceId: string, direction: 'up' | 'down') =>
    setUserTasks(prev => {
      const index = prev.findIndex(t => t.instanceId === instanceId);
      const swap = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });

  const newInstanceId = (id: string) => `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const addTask = (task: any) => {
    const count = userTasks.filter(t => t.id === task.id).length;
    if (count >= 10) {
      toast({ title: 'Limit Reached', description: 'You cannot select the same task more than 10 times.' });
      return;
    }
    setUserTasks(prev => [...prev, { ...task, instanceId: newInstanceId(task.id), durationMinutes: DEFAULT_BLOCK_MINUTES }]);
  };

  const duplicateTask = (instanceId: string) => {
    const src = userTasks.find(t => t.instanceId === instanceId);
    if (!src) return;
    if (userTasks.filter(t => t.id === src.id).length >= 10) {
      toast({ title: 'Limit Reached', description: 'You cannot select the same task more than 10 times.' });
      return;
    }
    setUserTasks(prev => {
      const idx = prev.findIndex(t => t.instanceId === instanceId);
      const copy = { ...src, instanceId: newInstanceId(src.id), isLocked: false, isAutoSelected: false, pinnedStart: undefined };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const removeTask = (instanceId: string) => {
    const task = userTasks.find(t => t.instanceId === instanceId);
    if (task?.isLocked) {
      toast({ title: 'Task Locked', description: 'This is a PMS scheduled task and cannot be removed.' });
      return;
    }
    setUserTasks(prev => prev.filter(t => t.instanceId !== instanceId));
  };

  // "-" on the left card: remove the last non-locked instance of that task
  const removeOneInstance = (taskId: string) => {
    let lastIdx = -1;
    for (let i = userTasks.length - 1; i >= 0; i--) {
      if (userTasks[i].id === taskId && !userTasks[i].isLocked) { lastIdx = i; break; }
    }
    if (lastIdx === -1) {
      toast({ title: 'Task Locked', description: 'This is a PMS scheduled task and cannot be removed.' });
      return;
    }
    setUserTasks(prev => prev.filter((_, i) => i !== lastIdx));
  };

  /* ---------- data ---------- */
  const { data: windowData } = useQuery({
    queryKey: ['/api/plan-window', user?.id],
    enabled: !!user?.id,
    queryFn: async () => (await fetch(`/api/plan-window?employeeId=${user?.id}`)).json(),
    refetchInterval: 30000,
  });

  const { data: planStatus, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['/api/daily-plans/today', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const res = await fetch(`/api/daily-plans/today/${user?.id}`);
      if (!res.ok) return { submitted: false };
      return res.json();
    },
  });

  const { data: lmsHoursData } = useQuery<{ leaveHours: number; permissionHours: number; totalLMSHours: number }>({
    queryKey: ['/api/lms/hours', user?.employeeCode, today],
    enabled: !!user?.employeeCode,
    queryFn: async () => {
      const res = await fetch(`/api/lms/hours?employeeCode=${user?.employeeCode}&date=${today}`);
      if (!res.ok) return { leaveHours: 0, permissionHours: 0, totalLMSHours: 0 };
      return res.json();
    },
  });

  const { data: leaveStatusData } = useQuery<{ hasLeave: boolean; status: string | null; message?: string }>({
    queryKey: ['/api/employee/leave-status', user?.employeeCode, today],
    enabled: !!user?.employeeCode,
    queryFn: async () => {
      const res = await fetch(`/api/employee/leave-status?employeeCode=${user?.employeeCode}&date=${today}`);
      if (!res.ok) return { hasLeave: false, status: null };
      return res.json();
    },
  });

  const { data: historyData, isLoading: isLoadingHistory } = useQuery({
    queryKey: ['/api/daily-plans', historyDate, user?.id],
    enabled: !!user?.id && !!historyDate,
    queryFn: async () => {
      const res = await fetch(`/api/daily-plans/${historyDate}/${user?.id}`);
      if (!res.ok) return { submitted: false };
      return res.json();
    },
  });

  const { data: availableTasks = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ['/api/available-tasks', user?.id, adminViewType],
    enabled: !!user?.id,
    queryFn: async () => {
      const res = await fetch(`/api/available-tasks?employeeId=${user?.id}&viewType=${adminViewType}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: allAccessibleProjects = [] } = useQuery({
    queryKey: ['/api/projects', user?.employeeCode, user?.role, user?.department],
    enabled: !!user?.id,
    queryFn: async () => {
      const params = new URLSearchParams({
        userRole: user?.role || '',
        userEmpCode: user?.employeeCode || '',
        userDepartment: user?.department || '',
      });
      const res = await fetch(`/api/projects?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: settings = {} } = useQuery({
    queryKey: ['/api/settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      return res.json();
    },
  });

  const isWindowOpen = !!windowData?.planWindowOpen;
  const isPastCutoff = !!windowData?.isPastCutoff;
  const isOverrideToday = !!windowData?.isOverrideToday;
  const isOnApprovedOD = !!windowData?.odExempt;
  const odIsFullDay = !!windowData?.odIsFullDay;
  const odWindow = windowData?.odWindow as { from: string; to: string } | null | undefined;
  const isAlreadySubmittedAndBlocked = planStatus?.submitted;
  const isWindowClosedNotSubmitted = !isWindowOpen && !planStatus?.submitted;

  useEffect(() => {
    if (windowData?.serverTime) {
      setServerTimeOffset(new Date(windowData.serverTime).getTime() - new Date().getTime());
    }
  }, [windowData?.serverTime]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { if (activeTab === 'plan') setShowUnselectedForm(false); }, [activeTab]);

  // Close project dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (isProjectDropdownOpen && !target.closest('[data-project-dropdown]')) setIsProjectDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProjectDropdownOpen]);

  // Pre-load the locked / PMS-scheduled tasks exactly once
  useEffect(() => {
    if (initialisedRef.current || isLoadingTasks || isLoadingPlan) return;
    initialisedRef.current = true;
    if (planStatus?.submitted) return;
    const auto = availableTasks
      .filter((t: any) => t.isAutoSelected)
      .map((t: any) => ({
        ...t,
        instanceId: newInstanceId(t.id),
        durationMinutes: clampDuration(t.scheduleData?.durationMinutes ?? t.durationMinutes ?? DEFAULT_BLOCK_MINUTES),
      }));
    if (auto.length > 0) setUserTasks(auto);
  }, [availableTasks, planStatus, isLoadingTasks, isLoadingPlan]);

  /* ---------- mutations ---------- */
  const toggleWindowMutation = useMutation({
    mutationFn: async (open: boolean) => (await apiRequest('PATCH', '/api/plan-window', { employeeId: user?.id, open })).json(),
    onSuccess: (data) => {
      queryClient.setQueryData(['/api/plan-window', user?.id], data);
      toast({
        title: data.planWindowOpen ? '🟢 Plan Window Opened' : '🔴 Plan Window Closed',
        description: data.planWindowOpen ? 'Employees can submit plans.' : 'Submission restricted.',
      });
    },
  });

  const toggleLatePlanOverrideMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch('/api/settings/late-plan-override', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: user?.id, enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to update late plan override');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({
        title: data?.settings?.allowLatePlanSubmission ? '⚠️ Late Plan Override Enabled' : 'Late Plan Override Disabled',
        description: data?.settings?.allowLatePlanSubmission
          ? 'Employees can now submit the daily plan even after the cutoff.'
          : 'The normal daily-plan cutoff is back in force.',
      });
    },
    onError: (error: any) => {
      toast({ title: 'Update Failed', description: error?.message || 'Could not update the late plan override.', variant: 'destructive' });
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/daily-plans/reminder', { employeeId: user?.id })).json(),
    onSuccess: (data) => toast({ title: '✅ Alert Emails Sent', description: `Sent ${data.count} alerts.` }),
  });

  const sendEODReportMutation = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/admin/check-missing-submissions', { actorId: user?.id })).json(),
    onSuccess: () => toast({ title: '📊 EOD Report Sent', description: 'Report sent to admins.' }),
  });

  const submitPlanMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest('POST', '/api/daily-plans', payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || body?.message || 'Failed to submit plan.');
      }
      return res.json();
    },
    onMutate: () => setIsSubmitted(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-plans/today', user?.id] });
      setTimeout(() => setLocation('/tracker'), 1500);
    },
    onError: (err: any) => {
      setIsSubmitted(false);
      toast({ title: 'Submission Failed', description: err.message || 'Failed to submit plan.', variant: 'destructive' });
    },
  });

  /* ---------- filtering ---------- */
  const filteredAvailableTasks = availableTasks.filter((task: any) => {
    const q = assignedTaskSearch.toLowerCase();
    const matchesSearch = task.task_name.toLowerCase().includes(q) || task.projectName.toLowerCase().includes(q);
    const matchesProject = projectSearch === '' || task.projectName === projectSearch;

    let matchesViewType = true;
    if (adminViewType === 'my-tasks') {
      const userCode = user?.employeeCode || '';
      const userName = user?.name || '';
      matchesViewType = (task.assignedTo || '') === userCode
        || (task.task_name?.toLowerCase() || '').includes(userName.toLowerCase())
        || task.isAssignedToEmployee === true;
    }
    return matchesSearch && matchesProject && matchesViewType && !task.isAutoSelected;
  });

  const uniqueProjects = Array.from(new Set([
    ...availableTasks.map((t: any) => t.projectName).filter(Boolean),
    ...allAccessibleProjects.filter((p: any) => {
      // Only active projects: not completed and today inside start..end timeline
      const now = new Date();
      const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const status = String(p.status || '').trim().toLowerCase();
      if (['completed', 'complete', 'done', 'closed'].includes(status)) return false;
      const progress = Number(p.progress_percentage ?? p.progress);
      if (!isNaN(progress) && progress >= 100) return false;
      const startKey = p.start_date ? String(p.start_date).substring(0, 10) : null;
      const endKey = p.end_date ? String(p.end_date).substring(0, 10) : null;
      if (startKey && startKey > todayKey) return false;
      if (endKey && endKey < todayKey) return false;
      return true;
    }).map((p: any) => p.project_name).filter(Boolean),
  ])).sort() as string[];

  /* ---------- required hours (unchanged business rules) ---------- */
  const STANDARD_DAY_MINUTES = 540; // 9:00 AM – 6:00 PM
  const STANDARD_DAY_START_MIN = 9 * 60;
  const STANDARD_DAY_END_MIN = 18 * 60;

  const odOverlapMinutes = (() => {
    if (!isOnApprovedOD) return 0;
    if (odIsFullDay) return STANDARD_DAY_MINUTES;
    if (!odWindow?.from || !odWindow?.to) return 0;
    const odStart = Math.max(STANDARD_DAY_START_MIN, toMinutes(odWindow.from));
    const odEnd = Math.min(STANDARD_DAY_END_MIN, toMinutes(odWindow.to));
    return Math.max(0, odEnd - odStart);
  })();

  const approvedLmsMinutes = Math.round((lmsHoursData?.totalLMSHours || 0) * 60);
  const reducedByApprovedHours = Math.min(approvedLmsMinutes, STANDARD_DAY_MINUTES);
  const requiredMinutes = Math.max(0, STANDARD_DAY_MINUTES - odOverlapMinutes - reducedByApprovedHours);
  const remainingMinutes = Math.max(0, requiredMinutes - totalWorkingMinutes);
  const isValidPlan = totalWorkingMinutes >= requiredMinutes && timingErrors.length === 0 && scheduled.length > 0;
  const isOnLeaveToday = !!leaveStatusData?.hasLeave;

  /* ---------- submit ---------- */
  const handleNext = () => {
    if (userTasks.length === 0) {
      toast({ title: 'Selection Required', description: 'Please select at least one task for your plan.', variant: 'destructive' });
      return;
    }
    if (timingErrors.length > 0) {
      toast({ title: 'Fix Timing Errors', description: timingErrors[0], variant: 'destructive' });
      return;
    }
    const unselected = availableTasks.filter((task: any) => !userTasks.find(s => s.id === task.id));
    if (unselected.length > 0) {
      setShowUnselectedForm(true);
      setCommonReason('');
      setCommonNewDueDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    } else {
      submitPlan();
    }
  };

  const submitPlan = () => {
    if (isOnLeaveToday) {
      toast({ title: 'Leave in effect', description: 'You are on leave today, so the plan for this day is blocked.', variant: 'destructive' });
      return;
    }
    if (!isWindowOpen) {
      toast({ title: 'Submission Blocked', description: 'The plan window is closed.', variant: 'destructive' });
      return;
    }
    if (timingErrors.length > 0) {
      toast({ title: 'Invalid Timings', description: timingErrors[0], variant: 'destructive' });
      return;
    }

    // Strip UI-only fields before sending
    const normalized = scheduled.map(({ _startMin, _endMin, _pinIgnored, pinnedStart, ...rest }: any) => rest);

    const unselected = availableTasks
      .filter((task: any) => !userTasks.find(s => s.id === task.id))
      .map((task: any) => ({
        taskId: task.id,
        taskName: task.task_name,
        reason: commonReason,
        newDueDate: commonNewDueDate,
        start_date: task.start_date,
        end_date: task.end_date,
        progress: task.progress,
        isOverdue: task.isOverdue,
      }));

    if (showUnselectedForm && (!commonReason || !commonNewDueDate)) {
      toast({ title: 'Missing Information', description: 'Please provide a reason and new due date.', variant: 'destructive' });
      return;
    }

    persistPlanSchedule(normalized);

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }

    submitPlanMutation.mutate({ employeeId: user?.id, date: today, selectedTasks: normalized, unselectedTasks: unselected });
  };

  const persistPlanSchedule = (planTasks: any[]) => {
    if (!user?.id) return;
    localStorage.setItem(`plan_schedule_${user.id}_${today}`, JSON.stringify(planTasks));
    const pendingKey = `pendingTasks_${user.id}_${today}`;
    try {
      const storedDrafts = JSON.parse(localStorage.getItem(pendingKey) || '[]');
      if (Array.isArray(storedDrafts)) {
        const manualDrafts = storedDrafts.filter((task: any) =>
          task?.source !== 'plan'
          && task?.isPlanTask !== true
          && task?.description !== 'Scheduled via Plan for Day'
          && task?.problemAndIssues !== 'Auto-filled from daily plan');
        localStorage.setItem(pendingKey, JSON.stringify(manualDrafts));
      }
    } catch {
      localStorage.removeItem(pendingKey);
    }
  };

  /* ---------- cutoff banner ---------- */
  const OD_CUTOFF_GRACE_MINUTES = 60;
  const getMinutesUntilCutoff = () => {
    const serverNow = new Date(currentTime.getTime() + serverTimeOffset);
    const utcTime = serverNow.getTime() + (serverNow.getTimezoneOffset() * 60000);
    const istNow = new Date(utcTime + (5.5 * 60 * 60 * 1000));
    const istCutoff = new Date(istNow);
    let cutoffHour = 12;
    let cutoffMinute = 30;
    if (isOnApprovedOD && !odIsFullDay && odWindow?.to) {
      const odEndMin = toMinutes(odWindow.to) + OD_CUTOFF_GRACE_MINUTES;
      if (odEndMin > 12 * 60 + 30) {
        cutoffHour = Math.floor(odEndMin / 60);
        cutoffMinute = odEndMin % 60;
      }
    }
    istCutoff.setUTCHours(cutoffHour, cutoffMinute, 0, 0);
    return Math.floor((istCutoff.getTime() - istNow.getTime()) / 60000);
  };
  const minutesUntilCutoff = getMinutesUntilCutoff();
  const isNearCutoff = minutesUntilCutoff > 0 && minutesUntilCutoff <= 30;

  const formatODTime = (t?: string | null) => {
    if (!t) return '';
    const [hStr, mStr] = t.split(':');
    let h = parseInt(hStr, 10);
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${mStr} ${period}`;
  };

  /* ---------- early returns ---------- */
  if (isLoadingPlan || isLoadingTasks) {
    return (
      <div ref={rootRef} className="flex flex-col items-center justify-center text-slate-900 gap-4" style={{ ...LIGHT_VARS, minHeight: 'calc(100vh - var(--app-header-h, 4rem))', filter: inverted ? CANCEL_INVERT : undefined, backgroundColor: '#f5f7fb' }}>
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-500 font-medium">Checking your schedule...</p>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div
        ref={rootRef}
        className="text-slate-900 flex items-center justify-center"
        style={{
          ...LIGHT_VARS,
          minHeight: 'calc(100vh - var(--app-header-h, 4rem))',
          filter: inverted ? CANCEL_INVERT : undefined,
          backgroundColor: '#f5f7fb',
          backgroundImage: 'radial-gradient(900px 500px at 50% -20%, rgba(59,130,246,0.10), transparent 60%)',
        }}
      >
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20 }}
          className="flex flex-col items-center gap-6 text-center"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
            <div className="w-28 h-28 rounded-full bg-green-500/20 border-2 border-green-500/50 flex items-center justify-center relative">
              <CheckCircle2 className="w-14 h-14 text-green-600" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-slate-900">Plan Submitted!</h2>
            <p className="text-slate-500 font-medium">Your day is locked in. Redirecting to Tracker…</p>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-green-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  /* ---------- day strip (compact calendar-style overview) ---------- */
  const stripSpan = Math.max(dayEndMin - dayStartMin, requiredMinutes, 60);
  const stripTicks: number[] = [];
  {
    const step = stripSpan > 9 * 60 ? 120 : 60;
    for (let t = Math.ceil(dayStartMin / 60) * 60; t < dayStartMin + stripSpan; t += step) stripTicks.push(t);
  }

  const progressPct = requiredMinutes > 0 ? Math.min(100, Math.round((totalWorkingMinutes / requiredMinutes) * 100)) : 100;

  return (
    <div style={{ width: '100%', height: 'calc(100vh - var(--app-header-h, 4rem))', overflow: 'hidden' }}>
      <div
        ref={rootRef}
        className="text-slate-900 flex flex-col"
        style={{
          // Render at 1/scale size, then shrink with a transform so it lays out as if the browser were zoomed out.
          width: `${100 / pageScale}%`,
          height: `${100 / pageScale}%`,
          transform: pageScale === 1 ? undefined : `scale(${pageScale})`,
          transformOrigin: '0 0',
          ...LIGHT_VARS,
          filter: inverted ? CANCEL_INVERT : undefined,
          backgroundColor: '#f5f7fb',
          backgroundImage: 'radial-gradient(900px 500px at 50% -20%, rgba(59,130,246,0.10), transparent 60%)',
        }}
      >
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-blue-300/50" style={{ background: '#2563eb' }}>
              <CalendarIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-extrabold leading-tight tracking-tight">Plan your day</h1>
              <p className="text-[11px] text-slate-500">{format(new Date(), 'EEEE, d MMMM')} · takes about 3 minutes</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
              {([['plan', 'Plan', ClipboardList], ['history', 'History', History]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all ${activeTab === key ? 'text-white shadow-md' : 'text-slate-500 hover:text-white hover:bg-slate-100'}`}
                  style={activeTab === key ? { background: '#2563eb' } : undefined}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {isController && (
              <>
                <Button onClick={() => sendReminderMutation.mutate()} size="sm" variant="outline" className="rounded-xl border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100">Remind All</Button>
                <Button onClick={() => sendEODReportMutation.mutate()} size="sm" variant="outline" className="rounded-xl border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100">EOD Report</Button>
                <Button onClick={() => toggleLatePlanOverrideMutation.mutate(!Boolean(settings?.allowLatePlanSubmission))} size="sm" className={`rounded-xl font-black text-xs px-3 h-9 ${settings?.allowLatePlanSubmission ? 'bg-amber-600' : 'bg-slate-700'}`}>
                  {settings?.allowLatePlanSubmission ? 'LATE ON' : 'LATE OFF'}
                </Button>
                <Button onClick={() => toggleWindowMutation.mutate(!isWindowOpen)} size="sm" className={`rounded-xl font-black text-xs px-3 h-9 ${isWindowOpen ? 'bg-red-600/80' : 'bg-green-600'}`}>
                  {isWindowOpen ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                </Button>
              </>
            )}
          </div>
        </header>

        {activeTab === 'history' ? (
          <div className="flex-1 overflow-auto p-6">
            <HistorySection historyDate={historyDate} setHistoryDate={setHistoryDate} isLoadingHistory={isLoadingHistory} historyData={historyData} today={today} />
          </div>
        ) : isAlreadySubmittedAndBlocked ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="bg-white shadow-2xl p-12 rounded-3xl border border-blue-200 max-w-lg w-full">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-8" />
              <h1 className="text-3xl font-extrabold mb-4">Today's Plan Ready!</h1>
              <p className="text-slate-500 mb-8">You've already locked in your tasks for today.</p>
              <div className="flex gap-4 justify-center">
                <Button onClick={() => setLocation('/tracker')} className="px-8 bg-blue-600">Go to Tracker</Button>
                <Button onClick={() => setActiveTab('history')} variant="outline" className="px-8">View Plan</Button>
              </div>
            </div>
          </div>
        ) : isOnLeaveToday ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="bg-white shadow-2xl p-12 rounded-3xl border border-amber-500/30 max-w-lg w-full">
              <CalendarIcon className="w-12 h-12 text-amber-600 mx-auto mb-8" />
              <h1 className="text-3xl font-extrabold mb-4">Leave Applied for Today</h1>
              <p className="text-slate-600 mb-8">
                {leaveStatusData?.status === 'Pending'
                  ? 'You have a pending leave request for today, so the plan for this day is blocked.'
                  : 'You are on leave today, so the plan for this day is blocked.'}
              </p>
              <Button onClick={() => setLocation('/tracker')} className="px-8 bg-slate-700">Go to Tracker</Button>
            </div>
          </div>
        ) : isWindowClosedNotSubmitted ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="bg-white shadow-2xl p-12 rounded-3xl border border-red-200 max-w-lg w-full">
              <PowerOff className="w-12 h-12 text-red-500 mx-auto mb-8" />
              <h1 className="text-3xl font-extrabold mb-4">Plan Window Closed</h1>
              <p className="text-slate-500 mb-8">{isOverrideToday ? 'Currently closed by administrator.' : (isPastCutoff ? 'Closed (12:30 PM cutoff)' : 'Currently closed by administrator.')}</p>
              <Button onClick={() => setLocation('/tracker')} className="px-8 bg-slate-700">Go to Tracker</Button>
            </div>
          </div>
        ) : !showUnselectedForm ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {(isOnApprovedOD || isNearCutoff) && (
              <div className="shrink-0 px-4 pb-2 space-y-1.5">
                {isOnApprovedOD && (
                  <div className="rounded-2xl px-4 py-2 flex items-center gap-3 text-slate-700 border border-slate-300 bg-slate-100">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <p className="text-xs font-bold">
                      On Approved OD —
                      {odIsFullDay
                        ? ' Plan not required today.'
                        : odWindow
                          ? ` ${formatODTime(odWindow.from)}–${formatODTime(odWindow.to)} exempt. Required: ${Math.floor(requiredMinutes / 60)}h ${requiredMinutes % 60}m.`
                          : ' Plan optional during OD.'}
                    </p>
                  </div>
                )}
                {isNearCutoff && !isOnApprovedOD && (
                  <div className="rounded-2xl px-4 py-2 flex items-center gap-3 text-amber-700 border border-amber-300 bg-amber-50">
                    <Clock className="w-4 h-4 animate-pulse shrink-0" />
                    <p className="text-xs font-bold">Plan Window Closing in {minutesUntilCutoff} minutes!</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 flex flex-col lg:flex-row gap-3 px-3 pb-3 overflow-auto lg:overflow-hidden">
              {/* ============ LEFT: pick tasks ============ */}
              <section className={`${GLASS} flex flex-col lg:w-[36%] min-w-0 shrink-0 lg:min-h-0 max-h-[60vh] lg:max-h-none`}>
                <div className="p-3 pb-2 space-y-2 shrink-0">
                  <div className="flex items-center gap-3">
                    <StepBadge n={1} />
                    <div className="flex-1">
                      <h2 className="text-base font-extrabold leading-tight">Pick your tasks</h2>
                      <p className="text-[11px] text-slate-500">Tap a task to add it to your day</p>
                    </div>
                    <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1">{userTasks.length} added</span>
                  </div>

                  {isController && (
                    <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
                      {([['admin', 'All Tasks'], ['department', 'Department'], ['my-tasks', 'My Tasks']] as const).map(([key, label]) => (
                        <button key={key} onClick={() => setAdminViewType(key)} className={`flex-1 h-7 text-[10px] uppercase font-bold rounded-lg transition-colors ${adminViewType === key ? 'bg-blue-500 text-white shadow' : 'text-slate-500 hover:text-white'}`}>{label}</button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <PlannedTaskSearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <Input placeholder="Search tasks..." value={assignedTaskSearch} onChange={(e) => setAssignedTaskSearch(e.target.value)} className="bg-slate-100 border-slate-200 rounded-xl pl-9 h-9 text-sm placeholder:text-slate-500" />
                    </div>
                    <div className="relative flex-1 z-30" data-project-dropdown>
                      <button
                        onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                        className="w-full h-9 rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-800 flex items-center justify-between hover:bg-slate-100 transition-colors"
                      >
                        <span className="truncate">{projectSearch || 'All Projects'}</span>
                        <ArrowDown className={`w-3 h-3 shrink-0 text-slate-500 transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isProjectDropdownOpen && (
                        <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 w-72 max-w-[85vw] overflow-hidden">
                          <div className="p-2 border-b border-slate-200">
                            <Input placeholder="Search projects..." value={projectDropdownSearch} onChange={(e) => setProjectDropdownSearch(e.target.value)} className="bg-slate-100 border-slate-200 rounded-lg h-8 text-sm placeholder:text-slate-500" />
                          </div>
                          <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                            <button onClick={() => { setProjectSearch(''); setIsProjectDropdownOpen(false); setProjectDropdownSearch(''); }} className="w-full text-left px-3 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-100">All Projects</button>
                            {uniqueProjects.filter(p => p.toLowerCase().includes(projectDropdownSearch.toLowerCase())).map(p => (
                              <button
                                key={p}
                                onClick={() => { setProjectSearch(p); setIsProjectDropdownOpen(false); setProjectDropdownSearch(''); }}
                                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${projectSearch === p ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-slate-700 hover:bg-slate-100'}`}
                              >
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#64748b' }} />
                                <span className="truncate">{p}</span>
                              </button>
                            ))}
                            {uniqueProjects.filter(p => p.toLowerCase().includes(projectDropdownSearch.toLowerCase())).length === 0 && (
                              <div className="px-3 py-2 text-xs text-slate-500 text-center">No projects found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  <div className="px-3 pb-3 space-y-1.5">
                    {filteredAvailableTasks.length === 0 && (
                      <div className="py-12 text-center space-y-2">
                        <div className="text-4xl">🔎</div>
                        <p className="text-slate-500 text-sm font-medium">No manual tasks available.</p>
                      </div>
                    )}
                    {filteredAvailableTasks.map((task: any) => {
                      const count = userTasks.filter(c => c.id === task.id).length;
                      const limit = count >= 10;
                      const h = projectHue(task.projectName);
                      return (
                        <div
                          key={task.id}
                          onClick={() => !limit && addTask(task)}
                          className={`group flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-all select-none ${count > 0 ? '' : 'bg-white'} ${limit ? 'opacity-40 cursor-not-allowed border-slate-100' : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-300/60'}`}
                          style={count > 0
                            ? { borderColor: '#93c5fd', background: '#eff6ff' }
                            : { borderColor: '#e2e8f0' }}
                        >
                          <div className="relative shrink-0">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-slate-900 text-xs shadow-sm" style={{ background: '#e8eefc' }}>
                              {(task.projectName || '?').trim().charAt(0).toUpperCase()}
                            </div>
                            {count > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-black flex items-center justify-center shadow">{count}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-slate-900 truncate">{task.task_name}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: '#94a3b8' }}>{task.projectName}</p>
                          </div>
                          {count > 0 && (
                            <button type="button" title="Remove one" onClick={(e) => { e.stopPropagation(); removeOneInstance(task.id); }} className="w-7 h-7 rounded-full flex items-center justify-center text-rose-600 hover:bg-rose-400/15 shrink-0">
                              <Minus className="w-4 h-4" />
                            </button>
                          )}
                          <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-slate-100 text-slate-700 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                            <Plus className="w-4 h-4" />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* ============ RIGHT: your day ============ */}
              <section className={`${GLASS} flex flex-col flex-1 min-w-0 lg:min-h-0`}>
                <div className="shrink-0 p-3 pb-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                      <StepBadge n={2} />
                      <div className="space-y-2">
                        <div>
                          <h2 className="text-base font-extrabold leading-tight">Set your start time</h2>
                          <p className="text-[11px] text-slate-500">Everything else lines up automatically</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <TimeSelect value={dayStartMin} onChange={setDayStartMin} />
                          {[9 * 60, 9 * 60 + 30, 10 * 60].map(m => (
                            <button key={m} type="button" onClick={() => setDayStartMin(m)} className={`h-8 px-2.5 rounded-full text-[11px] font-bold border transition-colors ${dayStartMin === m ? 'bg-blue-500 border-blue-400 text-white shadow' : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100'}`}>{toDisplayTime(m)}</button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              const now = new Date();
                              setDayStartMin(Math.min(Math.max(Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5, WORK_DAY_START_MIN), WORK_DAY_END_MIN));
                            }}
                            className="h-8 px-2.5 rounded-full text-[11px] font-bold border border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100"
                          >Now</button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2">
                      <ProgressRing pct={progressPct} done={remainingMinutes === 0} />
                      <div className="leading-tight">
                        <p className="text-base font-black">{fmtDuration(totalWorkingMinutes)}</p>
                        <p className="text-[11px] text-slate-500">of {fmtDuration(requiredMinutes)} planned</p>
                        <p className="text-[11px] text-slate-500">{scheduled.length ? `Ends ${toDisplayTime(dayEndMin)}` : 'No tasks yet'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Day strip */}
                  <div>
                    <div className="relative h-7 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden">
                      {scheduled.map((item, i) => {
                        return (
                          <div
                            key={item.instanceId + i}
                            title={`${item.task_name}  ${toDisplayTime(item._startMin)} – ${toDisplayTime(item._endMin)}`}
                            className="absolute top-0.5 bottom-0.5 rounded-md"
                            style={{
                              left: `calc(${((item._startMin - dayStartMin) / stripSpan) * 100}% + 1px)`,
                              width: `calc(${(item.durationMinutes / stripSpan) * 100}% - 2px)`,
                              background: item.isBreak ? '#cbd5e1' : (i % 2 === 0 ? '#3b82f6' : '#60a5fa'),
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="relative h-4 mt-1">
                      {stripTicks.filter(t => (t - dayStartMin) / stripSpan < 0.94).map(t => (
                        <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] text-slate-500 font-semibold" style={{ left: `${((t - dayStartMin) / stripSpan) * 100}%` }}>
                          {toDisplayTime(t).replace(':00', '')}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-2 flex items-center gap-2 shrink-0">
                  <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500">Your timeline</span>
                  <span className="flex-1 h-px bg-slate-100" />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  <div className="px-3 pb-3 space-y-1.5">
                    {scheduled.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
                        <div className="text-4xl mb-2">✨</div>
                        <p className="text-sm font-bold text-slate-700">Your day is a blank canvas</p>
                        <p className="text-xs text-slate-500 mt-1">Tap tasks on the left — they appear here in time order.</p>
                      </div>
                    )}

                    {scheduled.map((item: any, idx: number) => {
                      const prevEnd = idx > 0 ? scheduled[idx - 1]._endMin : dayStartMin;
                      const gap = idx > 0 ? item._startMin - prevEnd : 0;
                      const gapRow = gap > 0 ? (
                        <div key={`gap-${item.instanceId}`} className="flex items-center gap-2 text-[11px] text-slate-500 mb-2">
                          <span className="flex-1 border-t border-dashed border-slate-300" />
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5">Free {fmtDuration(gap)}</span>
                          <button type="button" onClick={() => clearGapBefore(idx)} className="text-blue-600 hover:text-blue-700 font-bold">Close gap</button>
                          <span className="flex-1 border-t border-dashed border-slate-300" />
                        </div>
                      ) : null;

                      if (item.isBreak) {
                        return (
                          <div key={item.id}>
                            {gapRow}
                            <div className="flex items-center gap-3 rounded-2xl px-3 py-2 border border-slate-200 bg-slate-50">
                              <span className="w-[96px] shrink-0 text-xs font-bold text-slate-500">{toDisplayTime(item._startMin)}</span>
                              <Coffee className="w-4 h-4 text-slate-500" />
                              <span className="text-sm font-semibold text-slate-600 flex-1">{item.task_name} <span className="text-slate-500 font-medium">· {item.durationMinutes}m</span></span>
                              <button type="button" title="Remove break" onClick={() => setBreaksOn(prev => ({ ...prev, [item.id]: false }))} className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-slate-100"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        );
                      }

                      const h = projectHue(item.projectName);
                      const taskIdx = userTasks.findIndex(t => t.instanceId === item.instanceId);
                      const expanded = expandedId === item.instanceId;
                      const hasExtras = !!(item.subtaskName || item.tool || item.scheduleData?.extensionReason);
                      return (
                        <div key={item.instanceId}>
                          {gapRow}
                          <div
                            className="rounded-2xl border overflow-hidden relative bg-white"
                            style={{
                              borderColor: item._pinIgnored ? '#fbbf24' : '#e2e8f0',
                            }}
                          >
                            <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: '#3b82f6' }} />
                            <div className="flex items-center gap-2 pl-3.5 pr-2 py-2">
                              <TimeEditor item={item} hue={h} onEdit={(which, v) => editTaskTime(item, which, v)} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-bold text-slate-900 truncate">
                                  {item.task_name}
                                  {item.isAutoSelected && <span className="ml-2 text-[9px] font-bold uppercase text-violet-700 bg-violet-100 rounded-full px-1.5 py-0.5 align-middle">PMS</span>}
                                </p>
                                <p className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: '#94a3b8' }}>{item.projectName}{item.subtaskName ? ` · ${item.subtaskName}` : ''}</p>
                              </div>
                              <select
                                aria-label="Duration"
                                value={item.durationMinutes}
                                onChange={(e) => setTaskDuration(item.instanceId, Number(e.target.value))}
                                className="h-7 rounded-full bg-white border border-slate-300 text-xs font-bold text-slate-900 px-2 outline-none focus:border-blue-400 cursor-pointer shrink-0"
                              >
                                {Array.from(new Set([...DURATION_CHOICES, item.durationMinutes])).sort((x, y) => x - y).map(d => <option key={d} value={d}>{fmtDuration(d)}</option>)}
                              </select>
                              <button type="button" title="Subtask & tools" onClick={() => setExpandedId(expanded ? null : item.instanceId)} className={`w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 ${hasExtras ? 'text-blue-600' : 'text-slate-500'}`}>
                                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button type="button" aria-label="More" className="w-7 h-7 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100"><MoreHorizontal className="w-4 h-4" /></button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" style={{ ...LIGHT_VARS, filter: inverted ? CANCEL_INVERT : undefined }} className="bg-white border-slate-200 text-slate-700 rounded-xl shadow-xl">
                                  <DropdownMenuItem disabled={taskIdx <= 0} onClick={() => moveTask(item.instanceId, 'up')}><ArrowUp className="w-4 h-4 mr-2" /> Move up</DropdownMenuItem>
                                  <DropdownMenuItem disabled={taskIdx >= userTasks.length - 1} onClick={() => moveTask(item.instanceId, 'down')}><ArrowDown className="w-4 h-4 mr-2" /> Move down</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => duplicateTask(item.instanceId)}><Copy className="w-4 h-4 mr-2" /> Add another block</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => removeTask(item.instanceId)} className="text-rose-600 focus:text-rose-600"><X className="w-4 h-4 mr-2" /> Remove</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>

                            {typeof item.pinnedStart === 'number' && (
                              <p className="pl-4 pr-3 pb-2 -mt-1 text-[11px] text-slate-600 flex items-center gap-1">
                                <Pin className="w-3 h-3" /> Fixed at {toDisplayTime(item.pinnedStart)}
                                <button type="button" onClick={() => setTaskPin(item.instanceId, null)} className="ml-1 text-blue-600 hover:text-blue-700 font-bold">Unfix</button>
                              </p>
                            )}

                            {expanded && (
                              <div className="pl-4 pr-3 pb-3 pt-3 space-y-3 border-t border-slate-200 bg-slate-50">
                                <SubtaskSelect
                                  taskId={item.id}
                                  values={item.subtaskIds || item.scheduleData?.subtaskIds || (item.subtaskId ? [item.subtaskId] : [])}
                                  onChange={(ids, names) => updateTaskSubtask(item.instanceId, ids, names)}
                                />
                                <ToolSelect
                                  values={
                                    item.tools
                                    || item.scheduleData?.tools
                                    || (() => {
                                      const legacy = item.tool || item.scheduleData?.tool || '';
                                      return legacy ? legacy.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                                    })()
                                  }
                                  onChange={(tools) => updateTaskTools(item.instanceId, tools)}
                                />
                                <div>
                                  <label className="text-[10px] uppercase text-slate-500 font-bold">Extension reason (optional)</label>
                                  <Input placeholder="Optional reason for extension" value={item.scheduleData?.extensionReason || ''} onChange={(e) => updateTaskSchedule(item.instanceId, 'extensionReason', e.target.value)} className="bg-slate-100 border-slate-200 rounded-lg h-8 text-sm" />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {BREAK_DEFINITIONS.some(b => !breaksOn[b.id]) && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {BREAK_DEFINITIONS.filter(b => !breaksOn[b.id]).map(b => (
                          <button key={b.id} type="button" onClick={() => setBreaksOn(prev => ({ ...prev, [b.id]: true }))} className="h-8 px-3 rounded-full text-[11px] font-bold border border-dashed border-slate-300 text-slate-500 hover:bg-slate-100 flex items-center gap-1">
                            <Plus className="w-3 h-3" /> {b.task_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-3 border-t border-slate-200 space-y-2 shrink-0 bg-slate-50 rounded-b-3xl">
                  {timingErrors.length > 0 && (
                    <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 space-y-1">
                      {timingErrors.map((err, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-rose-700">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{err}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className={remainingMinutes === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                      {remainingMinutes === 0 ? '✓ Your day is full' : `${fmtDuration(remainingMinutes)} left to plan`}{odOverlapMinutes > 0 ? ' · reduced for OD' : ''}
                    </span>
                    <span className="text-slate-500 uppercase tracking-wide flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Tasks must be completed today</span>
                  </div>

                  <Button
                    className={`w-full h-10 text-sm font-extrabold rounded-xl transition-all ${isValidPlan && !submitPlanMutation.isPending ? 'text-white shadow-lg shadow-blue-300/50 hover:brightness-110 hover:-translate-y-0.5' : 'bg-slate-100 text-slate-500 cursor-not-allowed hover:bg-slate-100'}`}
                    style={isValidPlan && !submitPlanMutation.isPending ? { background: '#2563eb' } : undefined}
                    disabled={!isValidPlan || !isWindowOpen || submitPlanMutation.isPending}
                    onClick={handleNext}
                  >
                    {submitPlanMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />SUBMITTING YOUR PLAN...</>
                    ) : isValidPlan
                      ? <><span>LOCK IN MY PLAN</span><ArrowRight className="w-4 h-4 ml-2" /></>
                      : timingErrors.length > 0
                        ? 'FIX TIMING ERRORS TO CONTINUE'
                        : scheduled.length === 0
                          ? 'ADD A TASK TO START'
                          : `ADD ${fmtDuration(remainingMinutes)} MORE TO LOCK IN`}
                  </Button>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-6">
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="max-w-4xl mx-auto">
              <Card className="bg-white border-amber-200">
                <CardHeader className="bg-amber-50 border-b border-amber-200 p-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-500/20 rounded-2xl flex items-center justify-center border border-amber-500/30"><AlertTriangle className="w-6 h-6 text-amber-500" /></div>
                    <div><CardTitle className="text-2xl font-black text-slate-900">Controlled Deviation Required</CardTitle><p className="text-amber-600 font-bold text-sm uppercase">Unselected tasks require justification</p></div>
                  </div>
                </CardHeader>
                <CardContent className="p-8 space-y-8">
                  <div className="p-8 rounded-3xl bg-slate-50 border border-slate-200 space-y-8">
                    <div>
                      <Label className="text-slate-500 font-bold text-xs uppercase mb-4 block">Pending Tasks Being Postponed</Label>
                      <div className="flex flex-wrap gap-2">
                        {availableTasks.filter((task: any) => !userTasks.find(s => s.id === task.id)).map((task: any) => (
                          <div key={task.id} className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-600 text-sm font-bold flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500/50" /> {task.task_name}</div>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <Label className="text-slate-500 font-bold text-xs uppercase">Reason for Deviation *</Label>
                        <Textarea placeholder="Justification..." value={commonReason} onChange={(e) => setCommonReason(e.target.value)} className="bg-white border-slate-300 text-slate-900 min-h-[120px]" />
                      </div>
                      <div className="space-y-3">
                        <Label className="text-slate-500 font-bold text-xs uppercase">New Target Due Date *</Label>
                        <Input type="date" value={commonNewDueDate} min={today} onChange={(e) => setCommonNewDueDate(e.target.value)} className="bg-white border-slate-200 h-16 text-lg" />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 pt-4">
                    <Button variant="outline" onClick={() => setShowUnselectedForm(false)} disabled={submitPlanMutation.isPending} className="px-8 py-6 rounded-2xl"><ArrowLeft className="w-5 h-5 mr-2" /> Back</Button>
                    <Button onClick={submitPlan} className="flex-1 py-6 bg-gradient-to-r from-amber-600 to-orange-600 text-white font-black text-lg rounded-2xl" disabled={submitPlanMutation.isPending}>
                      {submitPlanMutation.isPending ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />SUBMITTING...</> : <>SUBMIT PLAN <Send className="w-6 h-6 ml-3" /></>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Click the time on a row to change when it starts or ends */
function TimeEditor({ item, hue, onEdit }: { item: any; hue: number; onEdit: (which: 'start' | 'end', value: number) => void }) {
  const inverted = useIsInverted();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Click to change time"
          className="w-[96px] shrink-0 text-left rounded-lg px-2 py-1 border border-slate-200 bg-slate-100 hover:bg-slate-200 hover:border-slate-400 transition-colors"
        >
          <span className="block text-xs font-extrabold leading-tight" style={{ color: '#1d4ed8' }}>{toDisplayTime(item._startMin)}</span>
          <span className="block text-[10px] font-semibold text-slate-500 leading-tight">to {toDisplayTime(item._endMin)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" style={{ ...LIGHT_VARS, filter: inverted ? CANCEL_INVERT : undefined }} className="w-auto bg-white border-slate-200 text-slate-700 rounded-2xl p-4 space-y-3 shadow-xl">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Starts at</p>
          <TimeSelect value={item._startMin} onChange={(m) => onEdit('start', m)} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Ends at</p>
          <TimeSelect value={item._endMin} onChange={(m) => onEdit('end', m)} />
        </div>
        <p className="text-[10px] text-slate-500 max-w-[210px]">Tasks after this one move automatically.</p>
      </PopoverContent>
    </Popover>
  );
}

/* Hour / minute / AM-PM pickers: no free typing, so no format mistakes */
function TimeSelect({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const h24 = Math.floor(value / 60);
  const minute = Math.round((value % 60) / 5) * 5 % 60;
  const isPM = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const commit = (nextH12: number, nextMin: number, nextPM: boolean) => {
    const base = nextH12 % 12;
    onChange((base + (nextPM ? 12 : 0)) * 60 + nextMin);
  };
  const selectCls = 'h-8 rounded-lg bg-white border border-slate-300 text-sm font-bold text-slate-900 px-1.5 outline-none focus:border-blue-400 cursor-pointer';

  return (
    <div className="inline-flex items-center gap-1">
      <select aria-label="Hour" value={h12} onChange={(e) => commit(Number(e.target.value), minute, isPM)} className={selectCls}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-slate-500 font-bold">:</span>
      <select aria-label="Minute" value={minute} onChange={(e) => commit(h12, Number(e.target.value), isPM)} className={selectCls}>
        {Array.from({ length: 12 }, (_, i) => i * 5).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <select aria-label="AM or PM" value={isPM ? 'PM' : 'AM'} onChange={(e) => commit(h12, minute, e.target.value === 'PM')} className={`${selectCls} ${isPM ? 'text-amber-600' : ''}`}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

// Parse a plan task's scheduleData, which the API may return as a JSON string or an object
const parseScheduleData = (t: any): any => {
  if (!t) return {};
  const raw = t.scheduleData;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
};

// Format a 24h "HH:mm" string as a friendly 12h time, e.g. "17:00" -> "5:00 PM"
const formatTime12h = (time?: string | null): string | null => {
  if (!time) return null;
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

function HistorySection({ historyDate, setHistoryDate, isLoadingHistory, historyData, today }: any) {
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-black flex items-center gap-3"><CalendarIcon className="w-6 h-6 text-green-500" /> PLAN HISTORY</h2>
        <div className="bg-white p-2 rounded-2xl border border-slate-200 flex items-center">
          <CalendarIcon className="w-4 h-4 text-green-500 mx-3" />
          <Input type="date" value={historyDate} max={today} onChange={(e) => setHistoryDate(e.target.value)} className="bg-white border-none h-10 w-48 text-sm" />
        </div>
      </div>
      {isLoadingHistory ? <div className="py-20 text-center"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" /><p className="text-slate-500 font-bold uppercase text-xs">Loading...</p></div> :
        historyData?.submitted ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="bg-white border-slate-200 p-6">
              <h4 className="text-green-600 font-black mb-4 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> SELECTED</h4>
              <div className="space-y-3">
                {[...historyData.tasks].sort((a: any, b: any) => {
                  const sa = parseScheduleData(a).startTime || a.startTime || '';
                  const sb = parseScheduleData(b).startTime || b.startTime || '';
                  return sa.localeCompare(sb);
                }).map((t: any) => {
                  const schedule = parseScheduleData(t);
                  const start = formatTime12h(schedule.startTime || t.startTime);
                  const end = formatTime12h(schedule.endTime || t.endTime);
                  const subtaskName = schedule.subtaskName || t.subtaskName;
                  const toolNames: string[] = Array.isArray(t.tools) && t.tools.length > 0
                    ? t.tools
                    : Array.isArray(schedule.tools) && schedule.tools.length > 0
                      ? schedule.tools
                      : (t.tool || schedule.tool || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                  return (
                    <div key={t.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-bold text-slate-800">{t.taskName}</h4>
                          <p className="text-xs text-slate-500 uppercase font-bold">{t.projectName}</p>
                          {subtaskName && <p className="text-[11px] text-blue-600 mt-1">↳ {subtaskName}</p>}
                          {toolNames.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              {toolNames.map((tn) => (
                                <span key={tn} className="inline-flex items-center gap-1 text-[10px] bg-slate-100 border border-slate-200 text-slate-600 rounded px-1.5 py-0.5">
                                  🛠 {tn}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {(start && end) && (
                          <span className="text-[10px] font-mono text-green-600 bg-green-50 border border-green-200 px-2 py-1 rounded-lg whitespace-nowrap shrink-0">
                            {start} – {end}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="bg-white border-slate-200 p-6"><h4 className="text-amber-600 font-black mb-4 flex items-center gap-2"><Clock className="w-5 h-5" /> NOT SELECTED</h4><div className="space-y-3">{historyData.postponedTasks.length === 0 ? <p className="text-slate-500 italic">None</p> : historyData.postponedTasks.map((t: any, idx: number) => (<div key={idx} className="p-4 rounded-xl bg-amber-50 border border-amber-200"><h4 className="font-bold text-amber-800">{t.task_name}</h4><p className="text-sm text-slate-600 italic">{t.reason}</p><p className="text-[10px] text-amber-500/60 uppercase mt-2">Next: {t.new_due_date}</p></div>))}</div></Card>
          </div>
        ) : <div className="py-24 text-center bg-white rounded-3xl border border-slate-200 border-dashed"><p className="text-slate-500 font-bold text-lg">No plan submitted for this date.</p></div>}
    </div>
  );
}

// Fetches PMS subtasks for a given task and lets the user attach multiple subtasks to their plan entry.
// Scoped to `taskId` alone — deliberately NOT filtered by employee/department, since a
// task's subtasks (e.g. a PMS-synced team task like "system locking bypass–database
// changes") can be assigned to other team members and are still legitimately associated
// with the task; filtering by assignee here would hide subtasks that genuinely belong to
// the task. Switching tasks always reloads only that task's subtasks (query key includes
// taskId, and the query is disabled without one).
// Searchable multi-select for the Plan for the Day's "Tool Selection" field.
// A task can genuinely involve more than one tool in a session (e.g. VS Code +
// Postman, or a meeting tool alongside a dev tool), so this supports checking
// several at once rather than forcing a single pick. Mirrors SubtaskSelect's
// dropdown chrome (absolute panel, click-outside to close, checkbox rows, chip
// summary) for visual consistency, and keeps ToolSelect's search box since
// TOOLS_LIST is long. Selections are joined into a comma-separated "tool"
// string by the caller for backward compatibility with the auto-generated
// draft time entry's "Tools Used" field (see server route for POST
// /api/daily-plans) — whatever is picked here shows up pre-filled when the
// employee opens that entry to edit in the Tracker, letting TimeGuard
// validate against the same tools the plan recorded.
function ToolSelect({ values = [], onChange }: { values: string[]; onChange: (tools: string[]) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-tool-dropdown]')) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const filteredTools = TOOLS_LIST.filter((tool) =>
    tool.toLowerCase().includes(search.toLowerCase())
  );

  const toggleTool = (tool: string) => {
    const next = values.includes(tool)
      ? values.filter((t) => t !== tool)
      : [...values, tool];
    onChange(next);
  };

  const clearAll = () => onChange([]);

  const selectAllFiltered = () => {
    const merged = Array.from(new Set([...values, ...filteredTools]));
    onChange(merged);
  };

  const hasNonDevSelection = values.some((v) => isNonDevelopmentTool(v));

  const displayLabel = values.length === 0
    ? 'Select tools...'
    : values.length === 1
      ? values[0]
      : `${values.length} tools selected`;

  return (
    <div data-tool-dropdown className="relative">
      <div className="flex items-center justify-between">
        <label className="text-[10px] uppercase text-slate-500 font-bold">Tool Selection</label>
        {values.length > 0 && (
          <span className="text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 leading-4">
            {values.length}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full h-9 rounded-md border bg-white px-3 text-sm text-left flex items-center justify-between gap-2 outline-none transition-colors ${isOpen ? 'border-blue-500' : 'border-slate-200 hover:border-slate-300'} text-slate-700`}
      >
        <span className={`truncate ${values.length ? '' : 'text-slate-500'}`}>{displayLabel}</span>
        <div className="flex items-center gap-1 shrink-0">
          {values.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); clearAll(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clearAll(); } }}
              className="text-slate-500 hover:text-slate-600 text-xs px-1"
              aria-label="Clear all tools"
            >✕</span>
          )}
          <svg className={`w-3 h-3 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l4 4 4-4" /></svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-300 rounded-md shadow-xl flex flex-col">
          <div className="p-2 border-b border-slate-200 shrink-0 flex items-center gap-1.5">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools..."
              className="flex-1 h-8 rounded bg-white border border-slate-200 px-2 text-xs text-slate-700 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={selectAllFiltered}
              disabled={filteredTools.length === 0}
              className="shrink-0 h-8 px-2 rounded text-[10px] font-bold uppercase text-blue-600 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              Select all
            </button>
          </div>

          <div className="max-h-52 overflow-y-auto">
            {filteredTools.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500 italic">No tools found.</p>
            ) : (
              filteredTools.map((tool) => {
                const nonDev = isNonDevelopmentTool(tool);
                const isSelected = values.includes(tool);
                return (
                  <label
                    key={tool}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-100 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTool(tool)}
                      className="accent-blue-500 shrink-0"
                    />
                    <span className={`flex-1 truncate text-sm ${isSelected ? 'text-blue-600' : 'text-slate-700'}`}>{tool}</span>
                    {nonDev && (
                      <span className="text-[9px] uppercase text-blue-400/70 shrink-0 whitespace-nowrap">Non-dev</span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          {values.length > 0 && (
            <div className="p-2 border-t border-slate-200 shrink-0 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">{values.length} selected</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-[10px] font-bold uppercase text-slate-500 hover:text-slate-700 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {values.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {values.map((tool) => (
            <span key={tool} className="inline-flex items-center gap-1 text-[10px] bg-blue-50 border border-blue-200 text-blue-600 rounded px-1.5 py-0.5">
              <span className="truncate max-w-[140px]">{tool}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={() => toggleTool(tool)}
                onKeyDown={(e) => { if (e.key === 'Enter') toggleTool(tool); }}
                className="hover:text-slate-900 cursor-pointer"
                aria-label={`Remove ${tool}`}
              >✕</span>
            </span>
          ))}
        </div>
      )}

      {hasNonDevSelection && (
        <p className="mt-1 text-[10px] text-blue-300/70">
          Meetings, calls, discussions, reviews, and training skip automatic tool-usage validation.
        </p>
      )}
    </div>
  );
}

function SubtaskSelect({ taskId, values = [], onChange }: { taskId: string; values: string[]; onChange: (subtaskIds: string[], subtaskNames: string[]) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useState<HTMLDivElement | null>(null);

  const { data: subtasks = [], isLoading, isError } = useQuery({
    queryKey: ['/api/subtasks', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const res = await fetch(`/api/subtasks?taskId=${taskId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  // Whenever the selected task changes, clear stale subtask selections that no longer
  // belong to the current task's subtask list.
  useEffect(() => {
    if (isLoading || !taskId) return;
    const validIds = subtasks.map((s: any) => s.id);
    const staleIds = values.filter(v => !validIds.includes(v));
    if (staleIds.length > 0) {
      const remaining = values.filter(v => validIds.includes(v));
      const names = remaining.map(id => {
        const s = subtasks.find((s: any) => s.id === id);
        return s ? (s.title || s.subtask_name || s.name || '') : '';
      });
      onChange(remaining, names);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, isLoading, subtasks]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-subtask-dropdown]')) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleSubtask = (subtask: any) => {
    const id = subtask.id;
    const name = subtask.title || subtask.subtask_name || subtask.name || '';
    let newIds: string[];
    let newNames: string[];
    if (values.includes(id)) {
      newIds = values.filter(v => v !== id);
      newNames = newIds.map(nid => {
        const s = subtasks.find((s: any) => s.id === nid);
        return s ? (s.title || s.subtask_name || s.name || '') : '';
      });
    } else {
      newIds = [...values, id];
      newNames = newIds.map(nid => {
        const s = subtasks.find((s: any) => s.id === nid);
        return s ? (s.title || s.subtask_name || s.name || '') : '';
      });
    }
    onChange(newIds, newNames);
  };

  const clearAll = () => onChange([], []);

  const isDisabled = isLoading || subtasks.length === 0;

  const displayLabel = isLoading
    ? 'Loading subtasks...'
    : isError
      ? 'Could not load subtasks'
      : subtasks.length === 0
        ? 'No subtasks for this task'
        : values.length === 0
          ? 'Select subtasks...'
          : values.length === 1
            ? (() => { const s = subtasks.find((s: any) => s.id === values[0]); return s ? (s.title || s.subtask_name || s.name) : '1 selected'; })()
            : `${values.length} subtasks selected`;

  return (
    <div data-subtask-dropdown>
      <label className="text-[10px] uppercase text-slate-500 font-bold">Subtask</label>
      <div className="relative">
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => !isDisabled && setIsOpen(prev => !prev)}
          className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-left flex items-center justify-between gap-2 outline-none focus:border-blue-500 disabled:opacity-50 text-slate-700"
        >
          <span className="truncate">{displayLabel}</span>
          <div className="flex items-center gap-1 shrink-0">
            {values.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clearAll(); } }}
                className="text-slate-500 hover:text-slate-600 text-xs px-1"
                aria-label="Clear all"
              >✕</span>
            )}
            <svg className={`w-3 h-3 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l4 4 4-4" /></svg>
          </div>
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-slate-300 rounded-md shadow-xl max-h-52 overflow-y-auto">
            {subtasks.map((s: any) => {
              const checked = values.includes(s.id);
              const label = s.title || s.subtask_name || s.name;
              return (
                <label
                  key={s.id}
                  className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-slate-100 transition-colors ${checked ? 'bg-blue-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSubtask(s)}
                    className="mt-0.5 accent-blue-500 shrink-0"
                  />
                  <span className="text-sm text-slate-700 leading-snug">{label}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      {values.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {values.map(id => {
            const s = subtasks.find((s: any) => s.id === id);
            if (!s) return null;
            return (
              <span key={id} className="inline-flex items-center gap-1 text-[10px] bg-blue-50 border border-blue-200 text-blue-600 rounded px-1.5 py-0.5">
                {s.title || s.subtask_name || s.name}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSubtask(s)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleSubtask(s); }}
                  className="hover:text-slate-900 cursor-pointer"
                  aria-label={`Remove ${s.title || s.subtask_name || s.name}`}
                >✕</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}