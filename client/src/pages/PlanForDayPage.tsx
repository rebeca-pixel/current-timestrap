import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { CheckCircle2, Circle, ArrowRight, ArrowLeft, Send, AlertTriangle, Clock, Calendar as CalendarIcon, ClipboardList, Target, Power, PowerOff, Lock, ArrowUp, ArrowDown, Search as PlannedTaskSearchIcon, ChevronUp, ChevronDown, Minus, ShieldCheck, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, addDays } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TOOLS_LIST, isNonDevelopmentTool } from '@shared/toolCategories';

export default function PlanForDayPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedTasks, setSelectedTasks] = useState<any[]>([]);
  const [commonReason, setCommonReason] = useState('');
  const [commonNewDueDate, setCommonNewDueDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [showUnselectedForm, setShowUnselectedForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'plan' | 'history'>('plan');
  const [historyDate, setHistoryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [assignedTaskSearch, setAssignedTaskSearch] = useState('');
  const [plannedTaskSearch, setPlannedTaskSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectDropdownSearch, setProjectDropdownSearch] = useState('');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [adminViewType, setAdminViewType] = useState<'admin' | 'department' | 'my-tasks'>('admin');
  const [isCalendarPreviewOpen, setIsCalendarPreviewOpen] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDismissedWarning, setIsDismissedWarning] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');
  const isController = user?.role === 'admin' || user?.role === 'manager' || user?.employeeCode === 'E0046';

  const toMinutes = (time: string) => {
    if (!time) return 0;
    const [hours, minutes] = time.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };

  const toTime = (minutes: number) => {
    const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  // Friendly 12-hour display, e.g. 1020 -> "5:00 PM"
  const toDisplayTime = (minutes: number) => {
    const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
    const h24 = Math.floor(safe / 60);
    const mins = safe % 60;
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(mins).padStart(2, '0')} ${period}`;
  };

  // Reasonable bounds for a single work day, used to catch AM/PM entry mistakes
  const WORK_DAY_START_MIN = 6 * 60; // 6:00 AM
  const WORK_DAY_NOON_MIN = 12 * 60; // 12:00 PM
  const WORK_DAY_END_MIN = 23 * 60; // 11:00 PM

  // Validate the timings of a set of planned tasks and return a list of
  // human-readable error messages. An empty array means the plan is valid.
  const getTimingErrors = (tasks: any[]): string[] => {
    const errors: string[] = [];
    if (tasks.length === 0) return errors;

    const startTimes = tasks
      .map(t => toMinutes(t.startTime))
      .filter(m => Number.isFinite(m) && m > 0);
    if (startTimes.length === 0) return errors;

    const dayStart = Math.min(...startTimes);

    // The work day should begin in the morning.
    if (dayStart >= WORK_DAY_NOON_MIN) {
      errors.push(`Your day is set to start at ${toDisplayTime(dayStart)}. Work usually starts in the morning — please check for an AM/PM mistake on your start time.`);
    }

    tasks.forEach(task => {
      const startMin = toMinutes(task.startTime);
      const endMin = toMinutes(task.endTime);
      const label = task.task_name || 'This task';

      if (endMin <= startMin) {
        errors.push(`"${label}" ends (${toDisplayTime(endMin)}) before it starts (${toDisplayTime(startMin)}). Please check the AM/PM on these times.`);
        return;
      }
      if (startMin < WORK_DAY_START_MIN || startMin > WORK_DAY_END_MIN) {
        errors.push(`"${label}" starts at ${toDisplayTime(startMin)}, which is outside normal working hours (6:00 AM – 11:00 PM). Please double check AM/PM.`);
      }
      if (startMin < dayStart - 60) {
        errors.push(`"${label}" starts at ${toDisplayTime(startMin)}, which is before your day begins at ${toDisplayTime(dayStart)}. Please check for an AM/PM mistake.`);
      }
    });

    // Check for overlapping time slots
    const sorted = [...tasks].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      const currEnd = toMinutes(curr.endTime);
      const nextStart = toMinutes(next.startTime);
      if (currEnd > nextStart) {
        errors.push(`"${curr.task_name}" (ends ${toDisplayTime(currEnd)}) overlaps with "${next.task_name}" (starts ${toDisplayTime(nextStart)}). Please fix the timings.`);
      }
    }

    return errors;
  };

  // Get maximum duration allowed for a task based on whether it's a break
  const getMaxDuration = (taskId: string): number => {
    if (taskId === 'break-morning' || taskId === 'break-evening') return 15; // 15 minutes max
    if (taskId === 'break-lunch') return 30; // 30 minutes max
    return 60; // 60 minutes (1h) max for regular tasks
  };

  const durationForRange = (start: string, end: string, taskId?: string) => {
    const calculatedDuration = toMinutes(end) - toMinutes(start);
    const minDuration = 15;
    const maxDuration = taskId ? getMaxDuration(taskId) : 8 * 60;
    return Math.max(minDuration, Math.min(maxDuration, calculatedDuration));
  };

  // Default anchor = 15 minutes before current time (clamped to work hours)
  const getPlanningAnchorMinutes = () => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    // Start 15 minutes before now so newly added tasks have a sensible default
    const anchoredMinutes = currentMinutes - 15;
    const earliestAllowed = 6 * 60;
    const latestAllowed = 23 * 60;
    return Math.min(Math.max(anchoredMinutes, earliestAllowed), latestAllowed);
  };

  const getDefaultPlanDuration = () => 30;

  const buildScheduledTasks = (tasks: any[]) => {
    const anchorMinutes = getPlanningAnchorMinutes();
    const endOfDay = 23 * 60;

    // Sort: breaks go to their configured slots (by their explicit time), regular tasks follow
    const orderedTasks = [...tasks].sort((a, b) => {
      const aStart = toMinutes(a.scheduleData?.startTime || a.startTime || '23:59');
      const bStart = toMinutes(b.scheduleData?.startTime || b.startTime || '23:59');
      return aStart - bStart;
    });

    let cursor = anchorMinutes;

    return orderedTasks.map((task, index) => {
      const scheduleData = typeof task.scheduleData === 'object' && task.scheduleData ? task.scheduleData : {};
      const baseDuration = scheduleData.durationMinutes ?? task.durationMinutes ?? getDefaultPlanDuration();
      const isBreak = !!task.isBreak || !!task.id?.startsWith?.('break-');

      // ALWAYS preserve explicit start times:
      // - Breaks always keep their configured startTime
      // - Any task where the user has set a startTime (stored in scheduleData or task.startTime) keeps it
      const explicitStart = scheduleData.startTime || task.startTime;
      const explicitStartMinutes = explicitStart ? toMinutes(explicitStart) : null;

      // Keep explicit start if: it's a break (always), or it's within valid range
      const shouldKeepExplicitStart =
        explicitStartMinutes !== null &&
        explicitStartMinutes >= WORK_DAY_START_MIN &&
        explicitStartMinutes <= endOfDay &&
        (isBreak || task._userEditedTime || explicitStartMinutes >= anchorMinutes - 120);

      const startTime = shouldKeepExplicitStart ? explicitStart : toTime(Math.max(cursor, anchorMinutes));
      const startMin = toMinutes(startTime);

      // Use explicit end time if user set it; otherwise derive from duration
      const explicitEnd = scheduleData.endTime || task.endTime;
      let endTime = explicitEnd || toTime(startMin + baseDuration);
      const durationMinutes = durationForRange(startTime, endTime, task.id);
      const finalEndMinutes = startMin + durationMinutes;
      endTime = toTime(finalEndMinutes);

      // Advance cursor only for non-break tasks (breaks don't push other tasks)
      if (!isBreak) {
        cursor = Math.max(cursor, finalEndMinutes);
      }

      if (cursor > endOfDay) {
        cursor = endOfDay;
      }

      return {
        ...task,
        instanceId: task.instanceId || `${task.id}-${Date.now()}-${index}`,
        order: index + 1,
        startTime,
        endTime,
        durationMinutes,
        isAutoSelected: !!task.isAutoSelected || !!task.isLocked || task.source === 'PMS',
        scheduleData: {
          ...scheduleData,
          startTime,
          endTime,
          durationMinutes,
          order: index + 1,
          extensionReason: scheduleData.extensionReason || task.extensionReason || '',
        },
      };
    });
  };

  const persistPlanSchedule = (planTasks: any[]) => {
    if (!user?.id) return;

    localStorage.setItem(`plan_schedule_${user.id}_${today}`, JSON.stringify(planTasks));

    const pendingKey = `pendingTasks_${user.id}_${today}`;
    try {
      const storedDrafts = JSON.parse(localStorage.getItem(pendingKey) || '[]');
      if (Array.isArray(storedDrafts)) {
        const manualDrafts = storedDrafts.filter((task: any) => {
          return task?.source !== 'plan'
            && task?.isPlanTask !== true
            && task?.description !== 'Scheduled via Plan for Day'
            && task?.problemAndIssues !== 'Auto-filled from daily plan';
        });
        localStorage.setItem(pendingKey, JSON.stringify(manualDrafts));
      }
    } catch {
      localStorage.removeItem(pendingKey);
    }
  };

  const updateTaskSchedule = (instanceId: string, field: 'startTime' | 'endTime' | 'extensionReason', value: string) => {
    // Directly update the task's time without triggering buildScheduledTasks re-ordering,
    // so user-entered times are always preserved exactly as typed.
    setSelectedTasks(prev => prev.map(task => {
      if (task.instanceId !== instanceId) return task;
      const nextSchedule = { ...(task.scheduleData || {}), [field]: value };
      const maxDuration = getMaxDuration(task.id);

      if (field === 'startTime' && nextSchedule.endTime) {
        const calculatedDuration = toMinutes(nextSchedule.endTime) - toMinutes(value);
        if (calculatedDuration > maxDuration) {
          // Clamp the end time to respect the maximum duration
          const maxEndTime = toTime(toMinutes(value) + maxDuration);
          nextSchedule.endTime = maxEndTime;
          toast({
            title: 'Duration Capped',
            description: `End time adjusted to ${maxEndTime} to respect ${maxDuration}-minute limit.`,
            variant: 'destructive',
          });
        }
        nextSchedule.durationMinutes = durationForRange(nextSchedule.startTime, nextSchedule.endTime, task.id);
      }
      if (field === 'endTime' && nextSchedule.startTime) {
        const calculatedDuration = toMinutes(value) - toMinutes(nextSchedule.startTime);
        if (calculatedDuration > maxDuration) {
          // Clamp the end time to the maximum allowed duration
          const maxEndTime = toTime(toMinutes(nextSchedule.startTime) + maxDuration);
          nextSchedule.endTime = maxEndTime;
          toast({
            title: 'Duration Limit Enforced',
            description: `${task.task_name} cannot exceed ${maxDuration} minutes. End time capped at ${maxEndTime}.`,
            variant: 'destructive',
          });
        } else {
          nextSchedule.endTime = value;
        }
        nextSchedule.durationMinutes = durationForRange(nextSchedule.startTime, nextSchedule.endTime, task.id);
      }

      return {
        ...task,
        // Flag as user-edited so buildScheduledTasks never overrides these times
        _userEditedTime: true,
        scheduleData: nextSchedule,
        ...(field === 'startTime' ? { startTime: value } : {}),
        ...(field === 'endTime' ? { endTime: nextSchedule.endTime } : {}),
      };
    }));
  };

  const updateTaskSubtask = (instanceId: string, subtaskIds: string[], subtaskNames: string[]) => {
    setSelectedTasks(prev => prev.map(task => {
      if (task.instanceId !== instanceId) return task;
      return {
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
      };
    }));
  };

  const updateTaskTools = (instanceId: string, tools: string[]) => {
    setSelectedTasks(prev => prev.map(task => {
      if (task.instanceId !== instanceId) return task;
      const joined = tools.length > 0 ? tools.join(', ') : undefined;
      return {
        ...task,
        tool: joined,
        tools: tools.length > 0 ? tools : undefined,
        scheduleData: {
          ...(task.scheduleData || {}),
          tool: joined || null,
          tools: tools.length > 0 ? tools : null,
        },
      };
    }));
  };

  const setTaskDuration = (instanceId: string, durationMin: number) => {
    setSelectedTasks(prev => buildScheduledTasks(prev.map(task => {
      if (task.instanceId !== instanceId) return task;
      const updatedEnd = toMinutes(task.startTime) + durationMin;
      const nextSchedule = {
        ...(task.scheduleData || {}),
        endTime: toTime(updatedEnd),
        durationMinutes: durationMin,
      };

      return {
        ...task,
        endTime: nextSchedule.endTime,
        durationMinutes: nextSchedule.durationMinutes,
        scheduleData: nextSchedule,
      };
    })));
  };

  const reorderTask = (instanceId: string, direction: 'up' | 'down') => {
    setSelectedTasks(prev => {
      const index = prev.findIndex(task => task.instanceId === instanceId);
      if (index < 0) return prev;

      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= prev.length) return prev;

      const next = [...prev];
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return buildScheduledTasks(next);
    });
  };

  const { data: windowData } = useQuery({
    queryKey: ['/api/plan-window', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const res = await fetch(`/api/plan-window?employeeId=${user?.id}`);
      return res.json();
    },
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

  // Fetch all projects user has access to (including created ones)
  const { data: allAccessibleProjects = [] } = useQuery({
    queryKey: ['/api/projects', user?.employeeCode, user?.role, user?.department],
    enabled: !!user?.id,
    queryFn: async () => {
      const params = new URLSearchParams({
        userRole: user?.role || "",
        userEmpCode: user?.employeeCode || "",
        userDepartment: user?.department || "",
      });
      const res = await fetch(`/api/projects?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
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
      const serverDate = new Date(windowData.serverTime);
      const localDate = new Date();
      setServerTimeOffset(serverDate.getTime() - localDate.getTime());
    }
  }, [windowData?.serverTime]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'plan') {
      setShowUnselectedForm(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setShowUnselectedForm(false);
    setAssignedTaskSearch('');
    setPlannedTaskSearch('');
    setProjectSearch('');
  }, []);

  // Close project dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (isProjectDropdownOpen && !target.closest('[data-project-dropdown]')) {
        setIsProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProjectDropdownOpen]);

  // Position project dropdown below button
  useEffect(() => {
    if (isProjectDropdownOpen) {
      const button = document.querySelector('[data-project-dropdown] button');
      if (button) {
        const rect = button.getBoundingClientRect();
        const style = document.documentElement.style;
        style.setProperty('--dropdown-top', `${rect.bottom + 8}px`);
        style.setProperty('--dropdown-left', `${rect.left}px`);
      }
    }
  }, [isProjectDropdownOpen]);

  useEffect(() => {
    if (availableTasks.length === 0) return;

    if (planStatus?.submitted && planStatus.tasks && selectedTasks.length === 0) {
      const existingTasks = planStatus.tasks.map((task: any) => ({
        id: task.taskId,
        task_name: task.taskName,
        projectName: task.projectName,
        projectDescription: task.projectName,
        source: task.source || 'Manual',
        isLocked: !!task.isLocked || task.source === 'PMS',
        tool: task.tool || undefined,
        tools: Array.isArray(task.tools)
          ? task.tools
          : (task.tool ? task.tool.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined),
        scheduleData: typeof task.scheduleData === 'string' ? JSON.parse(task.scheduleData) : (task.scheduleData || {}),
      }));
      setSelectedTasks(buildScheduledTasks(existingTasks));
      return;
    }

    if (!planStatus?.submitted && selectedTasks.length === 0) {
      const autoTasks = availableTasks.filter((task: any) => task.isAutoSelected);
      // Use current time to filter which breaks should be included
      const now = new Date();
      const realNowMinutes = now.getHours() * 60 + now.getMinutes();

      // Break definitions with their configured start/end times
      const BREAK_DEFINITIONS = [
        {
          id: 'break-morning',
          task_name: 'Morning Break',
          projectName: 'Break',
          isBreak: true,
          durationMinutes: 15,
          startTime: '11:00',
          endTime: '11:15',
          startMinutes: 11 * 60,
        },
        {
          id: 'break-lunch',
          task_name: 'Lunch',
          projectName: 'Break',
          isBreak: true,
          durationMinutes: 30,
          startTime: '14:00',
          endTime: '14:30',
          startMinutes: 14 * 60,
        },
        {
          id: 'break-evening',
          task_name: 'Evening Break',
          projectName: 'Break',
          isBreak: true,
          durationMinutes: 15,
          startTime: '17:00',
          endTime: '17:15',
          startMinutes: 17 * 60,
        },
      ];

      const breaks = BREAK_DEFINITIONS.filter((breakItem) => {
        // Only include breaks whose start time hasn't fully passed yet
        // (show a break once its start time is reached or is upcoming)
        const endMin = toMinutes(breakItem.endTime);
        return endMin > realNowMinutes;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      }).map(({ startMinutes: _sm, ...rest }) => rest);

      if (autoTasks.length > 0 || breaks.length > 0) {
        setSelectedTasks(buildScheduledTasks([...autoTasks, ...breaks]));
      }
    }
  }, [availableTasks, planStatus, selectedTasks.length]);

  const { data: settings = {} } = useQuery({
    queryKey: ['/api/settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      return res.json();
    },
  });

  const toggleWindowMutation = useMutation({
    mutationFn: async (open: boolean) => {
      const res = await apiRequest('PATCH', '/api/plan-window', { employeeId: user?.id, open });
      return res.json();
    },
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
        body: JSON.stringify({ employeeId: user?.id, enabled })
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
          : 'The normal daily-plan cutoff is back in force.'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Update Failed',
        description: error?.message || 'Could not update the late plan override.',
        variant: 'destructive'
      });
    }
  });

  const sendReminderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/daily-plans/reminder', { employeeId: user?.id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: '✅ Alert Emails Sent', description: `Sent ${data.count} alerts.` });
    },
  });

  const sendEODReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/check-missing-submissions', { actorId: user?.id });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: '📊 EOD Report Sent', description: 'Report sent to admins.' });
    },
  });

  const submitPlanMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest('POST', '/api/daily-plans', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-plans/today', user?.id] });
      // Show instant success overlay, then navigate after a brief moment
      setIsSubmitted(true);
      setTimeout(() => setLocation('/tracker'), 1800);
    },
    onError: (err: any) => {
      toast({ title: 'Submission Failed', description: err.message || 'Failed to submit plan.', variant: 'destructive' });
    },
  });

  const filteredAvailableTasks = availableTasks.filter((task: any) => {
    const matchesSearch = task.task_name.toLowerCase().includes(assignedTaskSearch.toLowerCase()) ||
      task.projectName.toLowerCase().includes(assignedTaskSearch.toLowerCase());
    const matchesProject = projectSearch === '' || task.projectName === projectSearch;

    // Filter for "My Tasks" - only show tasks assigned to current user or containing user's name
    let matchesViewType = true;
    if (adminViewType === 'my-tasks') {
      const userCode = user?.employeeCode || '';
      const userName = user?.name || '';
      const taskAssignedTo = task.assignedTo || '';
      const taskName = task.task_name?.toLowerCase() || '';

      matchesViewType = taskAssignedTo === userCode ||
        taskName.includes(userName.toLowerCase()) ||
        task.isAssignedToEmployee === true;
    }

    return matchesSearch && matchesProject && matchesViewType && !task.isAutoSelected;
  });

  const uniqueProjects = Array.from(new Set([
    ...availableTasks.map((t: any) => t.projectName).filter(Boolean),
    ...allAccessibleProjects.map((p: any) => p.project_name).filter(Boolean)
  ])).sort();

  const filteredSelectedTasks = selectedTasks.filter((task: any) =>
    task.task_name.toLowerCase().includes(plannedTaskSearch.toLowerCase()) ||
    task.projectName.toLowerCase().includes(plannedTaskSearch.toLowerCase())
  );

  const totalWorkingMinutes = selectedTasks.reduce((sum, task) => {
    return sum + (task.scheduleData?.durationMinutes || task.durationMinutes || 30);
  }, 0);
  const timingErrors = getTimingErrors(selectedTasks);

  // Break timing gate: breaks are auto-added to the plan panel only when their
  // scheduled start time has not yet fully passed (end time > now). This ensures
  // Morning Break (11:00), Lunch (14:00) and Evening Break (17:00) appear only
  // at the appropriate time of day. Regular tasks are always selectable.
  const currentMinutesOfDay = currentTime.getHours() * 60 + currentTime.getMinutes();
  // Helper to check if a given break's start time has been reached
  const isBreakSelectable = (breakStartMinutes: number) => currentMinutesOfDay >= breakStartMinutes;


  // Standard workday used for the 9-hour requirement: 9:00 AM - 6:00 PM (540 min).
  const STANDARD_DAY_MINUTES = 540;
  const STANDARD_DAY_START_MIN = 9 * 60;
  const STANDARD_DAY_END_MIN = 18 * 60;

  // When the employee has an approved OD, the portion of the standard workday
  // covered by the OD is exempted from the required planning hours. A full-day
  // OD exempts the whole 9 hours; a partial OD reduces the requirement by the
  // amount of overlap between the OD window and the standard workday.
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
  const isValidPlan = totalWorkingMinutes >= requiredMinutes && timingErrors.length === 0;
  const isOnLeaveToday = !!leaveStatusData?.hasLeave;

  // Reset the dismissed-warning state whenever a new set of timing errors appears
  // so that fresh errors are never silently hidden.
  useEffect(() => {
    if (timingErrors.length > 0) {
      setIsDismissedWarning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timingErrors.length]);


  if (isLoadingPlan || isLoadingTasks) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-slate-950 text-white gap-4">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-400 font-medium">Checking your schedule...</p>
      </div>
    );
  }

  const addTask = (task: any) => {
    const count = selectedTasks.filter(t => t.id === task.id).length;
    if (count >= 10) {
      toast({
        title: 'Limit Reached',
        description: 'You cannot select the same task more than 10 times.',
      });
      return;
    }

    setSelectedTasks(prev => {
      // Always add as a new instance
      const newTaskInstance = { ...task, instanceId: `${task.id}-${Date.now()}-${prev.length}` };
      return buildScheduledTasks([...prev, newTaskInstance]);
    });
  };

  const removeTask = (instanceId: string) => {
    setSelectedTasks(prev => {
      const task = prev.find(t => t.instanceId === instanceId);
      if (task?.isLocked) {
        toast({
          title: 'Task Locked',
          description: 'This is a PMS scheduled task and cannot be removed.',
        });
        return prev;
      }
      return buildScheduledTasks(prev.filter(current => current.instanceId !== instanceId));
    });
  };

  // Remove a single instance of a task by taskId (used by the "-" button on the
  // Available Tasks card in the left panel). Removes the last matching,
  // non-locked instance so repeated clicks decrement the selection count.
  const removeOneInstance = (taskId: string) => {
    setSelectedTasks(prev => {
      let lastIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].id === taskId && !prev[i].isLocked) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx === -1) {
        toast({
          title: 'Task Locked',
          description: 'This is a PMS scheduled task and cannot be removed.',
        });
        return prev;
      }
      return buildScheduledTasks(prev.filter((_, i) => i !== lastIdx));
    });
  };

  const handleNext = () => {
    if (selectedTasks.length === 0) {
      toast({ title: 'Selection Required', description: 'Please select at least one task for your plan.', variant: 'destructive' });
      return;
    }

    // Validate timing errors on the CURRENT tasks (without re-ordering which would override user times)
    const validationErrors = getTimingErrors(selectedTasks);
    if (validationErrors.length > 0) {
      toast({
        title: 'Fix Timing Errors',
        description: validationErrors[0],
        variant: 'destructive',
      });
      return;
    }

    const unselected = availableTasks.filter((task: any) => !selectedTasks.find((selected: any) => selected.id === task.id));
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

    // Validate timing using the tasks exactly as entered by the user (don't rebuild)
    const validationErrors = getTimingErrors(selectedTasks);
    if (validationErrors.length > 0) {
      toast({ title: 'Invalid Timings', description: validationErrors[0], variant: 'destructive' });
      return;
    }

    // Normalize selected tasks: sort by startTime and assign clean order numbers
    const normalized = [...selectedTasks]
      .sort((a, b) => toMinutes(a.startTime || a.scheduleData?.startTime || '23:59') - toMinutes(b.startTime || b.scheduleData?.startTime || '23:59'))
      .map((task, idx) => ({
        ...task,
        order: idx + 1,
        scheduleData: {
          ...(task.scheduleData || {}),
          order: idx + 1,
          startTime: task.startTime || task.scheduleData?.startTime,
          endTime: task.endTime || task.scheduleData?.endTime,
          durationMinutes: task.durationMinutes || task.scheduleData?.durationMinutes,
        },
      }));

    const unselected = availableTasks.filter((task: any) => !selectedTasks.find((selected: any) => selected.id === task.id))
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

    submitPlanMutation.mutate({
      employeeId: user?.id,
      date: today,
      selectedTasks: normalized,
      unselectedTasks: unselected,
    });
  };

  // Grace period added on top of an OD's end time before the plan window cuts
  // off, so an employee returning from OD isn't caught out immediately.
  const OD_CUTOFF_GRACE_MINUTES = 60;

  const getMinutesUntilCutoff = () => {
    const serverNow = new Date(currentTime.getTime() + serverTimeOffset);
    const utcTime = serverNow.getTime() + (serverNow.getTimezoneOffset() * 60000);
    const istNow = new Date(utcTime + (5.5 * 60 * 60 * 1000));
    const istCutoff = new Date(istNow);

    // Base cutoff is 12:30 PM. If the employee is on an approved OD that ends
    // after the base cutoff, push the effective cutoff to OD-end + grace so
    // they get a fair window to submit once they're back.
    let cutoffHour = 12;
    let cutoffMinute = 30;
    if (isOnApprovedOD && !odIsFullDay && odWindow?.to) {
      const odEndMin = toMinutes(odWindow.to) + OD_CUTOFF_GRACE_MINUTES;
      const baseCutoffMin = 12 * 60 + 30;
      if (odEndMin > baseCutoffMin) {
        cutoffHour = Math.floor(odEndMin / 60);
        cutoffMinute = odEndMin % 60;
      }
    }
    istCutoff.setUTCHours(cutoffHour, cutoffMinute, 0, 0);
    const diff = istCutoff.getTime() - istNow.getTime();
    return Math.floor(diff / 60000);
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

  // Instant success overlay — shown as soon as the API responds 201.
  // Keeps the user informed without any blank/loading gap.
  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20 }}
          className="flex flex-col items-center gap-6 text-center"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
            <div className="w-28 h-28 rounded-full bg-green-500/20 border-2 border-green-500/50 flex items-center justify-center relative">
              <CheckCircle2 className="w-14 h-14 text-green-400" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-white">Plan Submitted!</h2>
            <p className="text-slate-400 font-medium">Your day is locked in. Redirecting to Tracker…</p>
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

  return (
    <div className="min-h-screen bg-[#020617] text-white p-4 md:p-8 page-bg-fix">
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-blue-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/20">
            <ClipboardList className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>PLAN FOR TODAY</h1>
            <p className="text-slate-400 font-bold uppercase text-xs tracking-widest mt-1 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-blue-500" /> {format(new Date(), 'EEEE, MMMM do')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-slate-900/50 p-2 rounded-2xl border border-slate-800">
          <Button variant="ghost" onClick={() => setActiveTab('plan')} className={`rounded-xl font-black text-xs px-6 py-5 ${activeTab === 'plan' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>DAILY PLAN</Button>
          <Button variant="ghost" onClick={() => setActiveTab('history')} className={`rounded-xl font-black text-xs px-6 py-5 ${activeTab === 'history' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>PLAN HISTORY</Button>

          {isController && (
            <div className="flex gap-2 ml-4 pl-4 border-l border-slate-800">
              <Button onClick={() => sendReminderMutation.mutate()} size="sm" variant="outline" className="rounded-xl border-amber-500/20 text-amber-500 hover:bg-amber-500/10">Remind All</Button>
              <Button onClick={() => sendEODReportMutation.mutate()} size="sm" variant="outline" className="rounded-xl border-green-500/20 text-green-500 hover:bg-green-500/10">EOD Report</Button>
            </div>
          )}

          {isController && (
            <>
              <Button onClick={() => toggleLatePlanOverrideMutation.mutate(!Boolean(settings?.allowLatePlanSubmission))} size="sm" className={`rounded-xl font-black text-xs px-4 py-5 ${settings?.allowLatePlanSubmission ? 'bg-amber-600' : 'bg-slate-700'}`}>
                {settings?.allowLatePlanSubmission ? 'LATE PLAN ON' : 'LATE PLAN OFF'}
              </Button>
              <Button onClick={() => toggleWindowMutation.mutate(!isWindowOpen)} size="sm" className={`rounded-xl font-black text-xs px-4 py-5 ${isWindowOpen ? 'bg-red-600/80' : 'bg-green-600'}`}>
                {isWindowOpen ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
              </Button>
            </>
          )}
        </div>
      </header>

      {activeTab === 'history' ? (
        <HistorySection historyDate={historyDate} setHistoryDate={setHistoryDate} isLoadingHistory={isLoadingHistory} historyData={historyData} today={today} />
      ) : isAlreadySubmittedAndBlocked ? (
        <div className="flex flex-col h-[calc(100vh-250px)] items-center justify-center p-8 text-center">
          <div className="bg-slate-900/50 p-12 rounded-3xl border border-blue-500/20 max-w-lg w-full">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-8" />
            <h1 className="text-3xl font-extrabold mb-4">Today's Plan Ready!</h1>
            <p className="text-slate-400 mb-8">You've already locked in your tasks for today.</p>
            <div className="flex gap-4 justify-center">
              <Button onClick={() => setLocation('/tracker')} className="px-8 bg-blue-600">Go to Tracker</Button>
              <Button onClick={() => setActiveTab('history')} variant="outline" className="px-8">View Plan</Button>
            </div>
          </div>
        </div>
      ) : isOnLeaveToday ? (
        <div className="flex flex-col h-[calc(100vh-250px)] items-center justify-center p-8 text-center">
          <div className="bg-slate-900/50 p-12 rounded-3xl border border-amber-500/30 max-w-lg w-full">
            <CalendarIcon className="w-12 h-12 text-amber-400 mx-auto mb-8" />
            <h1 className="text-3xl font-extrabold mb-4">Leave Applied for Today</h1>
            <p className="text-slate-300 mb-8">
              {leaveStatusData?.status === 'Pending'
                ? 'You have a pending leave request for today, so the plan for this day is blocked.'
                : 'You are on leave today, so the plan for this day is blocked.'}
            </p>
            <Button onClick={() => setLocation('/tracker')} className="px-8 bg-slate-700">Go to Tracker</Button>
          </div>
        </div>
      ) : isWindowClosedNotSubmitted ? (
        <div className="flex flex-col h-[calc(100vh-250px)] items-center justify-center p-8 text-center">
          <div className="bg-slate-900/50 p-12 rounded-3xl border border-red-500/20 max-w-lg w-full">
            <PowerOff className="w-12 h-12 text-red-500 mx-auto mb-8" />
            <h1 className="text-3xl font-extrabold mb-4">Plan Window Closed</h1>
            <p className="text-slate-400 mb-8">{isOverrideToday ? 'Currently closed by administrator.' : (isPastCutoff ? 'Closed (12:30 PM cutoff)' : 'Currently closed by administrator.')}</p>
            <Button onClick={() => setLocation('/tracker')} className="px-8 bg-slate-700">Go to Tracker</Button>
          </div>
        </div>
      ) : !showUnselectedForm ? (
        <div className="space-y-6">
          {isOnApprovedOD && (
            <div className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-4 flex items-center gap-4 text-violet-300">
              <ShieldCheck className="w-6 h-6" />
              <div>
                <p className="font-black text-sm uppercase">On Approved On-Duty (OD)</p>
                <p className="text-xs opacity-80">
                  {odIsFullDay
                    ? "You're on OD for the whole day — the Plan for the Day isn't required today."
                    : odWindow
                      ? `You're on OD from ${formatODTime(odWindow.from)} to ${formatODTime(odWindow.to)} — that time is exempt from planning. Your required hours for today are reduced to ${Math.floor(requiredMinutes / 60)}h ${requiredMinutes % 60}m instead of the usual 9h.`
                      : "You're on approved OD right now — the Plan for the Day is optional during this time."}
                </p>
              </div>
            </div>
          )}

          {isNearCutoff && !isOnApprovedOD && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-4 text-amber-400">
              <Clock className="w-6 h-6 animate-pulse" />
              <div>
                <p className="font-black text-sm uppercase">Plan Window Closing Soon!</p>
                <p className="text-xs opacity-80">{minutesUntilCutoff} minutes remaining.</p>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-250px)] min-h-[500px]">
            <Card className="bg-slate-900/60 border-slate-800 flex flex-col h-full overflow-hidden shadow-xl">
              <CardHeader className="border-b border-slate-800/50 p-4 space-y-4">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                  <CardTitle className="text-xl flex items-center gap-3 text-slate-200">
                    <Target className="w-5 h-5 text-slate-400" /> Available Tasks
                  </CardTitle>
                  {isController && (
                    <div className="flex gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 w-full xl:w-auto">
                      <Button variant="ghost" size="sm" onClick={() => setAdminViewType('admin')} className={`flex-1 xl:flex-none h-8 text-[10px] uppercase font-bold rounded-lg ${adminViewType === 'admin' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>All Tasks</Button>
                      <Button variant="ghost" size="sm" onClick={() => setAdminViewType('department')} className={`flex-1 xl:flex-none h-8 text-[10px] uppercase font-bold rounded-lg ${adminViewType === 'department' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Department</Button>
                      <Button variant="ghost" size="sm" onClick={() => setAdminViewType('my-tasks')} className={`flex-1 xl:flex-none h-8 text-[10px] uppercase font-bold rounded-lg ${adminViewType === 'my-tasks' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>My Tasks</Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <PlannedTaskSearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input placeholder="Search tasks..." value={assignedTaskSearch} onChange={(e) => setAssignedTaskSearch(e.target.value)} className="bg-slate-950/50 border-slate-800 pl-10 h-10" />
                  </div>
                  <div className="relative flex-1 z-30" data-project-dropdown>
                    <button
                      onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                      className="w-full h-10 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 outline-none cursor-pointer focus:border-blue-500 focus:ring-1 focus:ring-blue-500 flex items-center justify-between hover:border-slate-700 transition-colors"
                    >
                      <span>{projectSearch ? projectSearch : 'All Projects'}</span>
                      <ArrowDown className={`w-3 h-3 text-slate-500 transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isProjectDropdownOpen && (
                      <div className="fixed bg-slate-900 border border-slate-700 rounded-md shadow-xl z-50 w-80" style={{
                        top: 'var(--dropdown-top)',
                        left: 'var(--dropdown-left)',
                      }}>
                        <div className="p-3 border-b border-slate-700">
                          <Input
                            placeholder="Search projects..."
                            value={projectDropdownSearch}
                            onChange={(e) => setProjectDropdownSearch(e.target.value)}
                            className="bg-slate-950 border-slate-700 h-9 text-sm placeholder-slate-500"
                          />
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          <div className="p-2 space-y-1">
                            <button
                              onClick={() => {
                                setProjectSearch('');
                                setIsProjectDropdownOpen(false);
                                setProjectDropdownSearch('');
                              }}
                              className="w-full text-left px-3 py-2 rounded text-sm text-slate-300 hover:bg-slate-800 transition-colors"
                            >
                              All Projects
                            </button>
                            {uniqueProjects
                              .filter(p => p.toLowerCase().includes(projectDropdownSearch.toLowerCase()))
                              .map((p: any) => (
                                <button
                                  key={p as string}
                                  onClick={() => {
                                    setProjectSearch(p as string);
                                    setIsProjectDropdownOpen(false);
                                    setProjectDropdownSearch('');
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${projectSearch === p
                                    ? 'bg-blue-600/40 text-blue-200 font-semibold'
                                    : 'text-slate-300 hover:bg-slate-800'
                                    }`}
                                >
                                  {p as string}
                                </button>
                              ))}
                            {uniqueProjects.filter(p => p.toLowerCase().includes(projectDropdownSearch.toLowerCase())).length === 0 && (
                              <div className="px-3 py-2 text-xs text-slate-500 text-center">No projects found</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                  {filteredAvailableTasks.length === 0 && !isLoadingTasks && (
                    <div className="py-20 text-center space-y-4">
                      <PlannedTaskSearchIcon className="w-12 h-12 text-slate-800 mx-auto" />
                      <p className="text-slate-500 font-medium">No manual tasks available.</p>
                    </div>
                  )}

                  {filteredAvailableTasks.map((task: any) => {
                    const selectionCount = selectedTasks.filter(current => current.id === task.id).length;
                    const isSelected = selectionCount > 0;
                    const isLimitReached = selectionCount >= 10;
                    return (
                      <motion.div
                        key={task.id}
                        className={`p-5 rounded-2xl border flex items-center gap-4 transition-all ${isLimitReached
                          ? 'bg-slate-900/50 border-slate-800/30 opacity-50 cursor-not-allowed'
                          : isSelected
                            ? 'bg-blue-600/20 border-blue-500/50 cursor-pointer hover:bg-blue-600/30'
                            : 'bg-slate-800/40 border-slate-700/50 cursor-pointer hover:bg-slate-800/60'
                          }`}
                        onClick={() => !isLimitReached && addTask(task)}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${isLimitReached
                          ? 'bg-slate-800 border-slate-700 text-slate-600'
                          : isSelected
                            ? 'bg-blue-500 border-blue-400 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-700'
                          }`}>
                          {isLimitReached ? <AlertTriangle className="w-5 h-5" /> : (isSelected ? <span className="font-black text-sm">{selectionCount}</span> : <Circle className="w-6 h-6" />)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-slate-100 truncate flex items-center gap-2">
                            {task.task_name}
                            {isSelected && !isLimitReached && (
                              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full whitespace-nowrap">
                                {selectionCount} / 10
                              </span>
                            )}
                          </h3>
                          <p className="text-xs text-slate-500 font-bold uppercase truncate">{task.projectName}</p>
                        </div>
                        {isSelected && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-red-400 hover:bg-red-400/10 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeOneInstance(task.id);
                            }}
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>

            <Card className="bg-slate-900/60 border-blue-500/10 flex flex-col h-full overflow-hidden shadow-xl">
              <CardHeader className="bg-blue-500/5 border-b border-blue-500/10 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl flex items-center gap-3 text-blue-400 font-black">YOUR PLAN</CardTitle>
                  <div className="bg-blue-500/20 px-3 py-1 rounded-full border border-blue-500/30">
                    <span className="text-xs font-black text-blue-400">{selectedTasks.length} SELECTED</span>
                  </div>
                </div>
                <div className="mt-3 relative">
                  <PlannedTaskSearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500/50" />
                  <Input placeholder="Search your plan..." value={plannedTaskSearch} onChange={(e) => setPlannedTaskSearch(e.target.value)} className="bg-slate-950/50 border-blue-500/20 pl-10" />
                </div>
              </CardHeader>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {selectedTasks.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-slate-500 text-sm">
                      Choose a task from the left to build your day schedule.
                    </div>
                  )}

                  {[...filteredSelectedTasks]
                    .sort((a, b) => toMinutes(a.startTime || a.scheduleData?.startTime || '23:59') - toMinutes(b.startTime || b.scheduleData?.startTime || '23:59'))
                    .map((task: any, index: number) => (
                    <div key={task.instanceId} className="rounded-2xl border border-blue-500/20 bg-slate-950/60 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase text-blue-400 font-black">#{index + 1} • {task.isAutoSelected ? 'PMS Sync' : 'Manual'}</p>
                          <h4 className="font-black text-white mt-1">{task.task_name}</h4>
                          <p className="text-xs text-slate-400 uppercase">{task.projectName}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-800" onClick={() => reorderTask(task.instanceId, 'up')} disabled={index === 0}><ArrowUp className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-800" onClick={() => reorderTask(task.instanceId, 'down')} disabled={index === selectedTasks.length - 1}><ArrowDown className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => removeTask(task.instanceId)} className="text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl">Cancel</Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] uppercase text-slate-400 font-bold">Start</label>
                          <Input type="time" value={task.startTime} onChange={(e) => updateTaskSchedule(task.instanceId, 'startTime', e.target.value)} className="bg-slate-950 border-slate-800" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-slate-400 font-bold">End</label>
                          <Input type="time" value={task.endTime} onChange={(e) => updateTaskSchedule(task.instanceId, 'endTime', e.target.value)} className="bg-slate-950 border-slate-800" />
                        </div>
                      </div>

                      {!task.isBreak && (
                        <SubtaskSelect
                          taskId={task.id}
                          values={task.subtaskIds || task.scheduleData?.subtaskIds || (task.subtaskId ? [task.subtaskId] : [])}
                          onChange={(subtaskIds, subtaskNames) => updateTaskSubtask(task.instanceId, subtaskIds, subtaskNames)}
                        />
                      )}

                      {!task.isBreak && (
                        <ToolSelect
                          values={
                            task.tools
                            || task.scheduleData?.tools
                            || (() => {
                              const legacy = task.tool || task.scheduleData?.tool || '';
                              return legacy ? legacy.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                            })()
                          }
                          onChange={(tools) => updateTaskTools(task.instanceId, tools)}
                        />
                      )}

                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase text-slate-500 font-bold">Duration</p>
                          <p className="text-sm font-black text-blue-300">{Math.max(15, task.durationMinutes || 30)} minutes</p>
                        </div>
                        {!task.isBreak && (
                          <div className="flex gap-1">
                            <Button type="button" size="sm" variant="outline" className={`rounded-xl border-blue-500/30 text-xs px-2 h-7 ${task.durationMinutes === 30 ? 'bg-blue-600 text-white' : 'text-blue-300 hover:bg-blue-500/20'}`} onClick={() => setTaskDuration(task.instanceId, 30)}>30m</Button>
                            <Button type="button" size="sm" variant="outline" className={`rounded-xl border-blue-500/30 text-xs px-2 h-7 ${task.durationMinutes === 45 ? 'bg-blue-600 text-white' : 'text-blue-300 hover:bg-blue-500/20'}`} onClick={() => setTaskDuration(task.instanceId, 45)}>45m</Button>
                            <Button type="button" size="sm" variant="outline" className={`rounded-xl border-blue-500/30 text-xs px-2 h-7 ${task.durationMinutes === 60 ? 'bg-blue-600 text-white' : 'text-blue-300 hover:bg-blue-500/20'}`} onClick={() => setTaskDuration(task.instanceId, 60)}>1h</Button>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] uppercase text-slate-400 font-bold">Extension Reason</label>
                        <Input placeholder="Optional reason for extension" value={task.scheduleData?.extensionReason || ''} onChange={(e) => updateTaskSchedule(task.instanceId, 'extensionReason', e.target.value)} className="bg-slate-950 border-slate-800" />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-4 bg-slate-900/50 border-t border-slate-800 flex flex-col gap-4 shrink-0">
                <div className="space-y-2">
                  <div
                    className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 -mx-1 rounded transition-colors"
                    onClick={() => setIsCalendarPreviewOpen(!isCalendarPreviewOpen)}
                  >
                    <h3 className="text-xs font-bold text-slate-400 uppercase">Calendar Preview</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 uppercase">Auto-syncs to tracker</span>
                      {isCalendarPreviewOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>
                  {isCalendarPreviewOpen && (
                    <div className="overflow-y-auto max-h-48 pr-2 space-y-2">
                      {selectedTasks.length === 0 ? (
                        <p className="text-sm text-slate-500">No tasks selected yet.</p>
                      ) : (
                        [...selectedTasks]
                          .sort((a, b) => toMinutes(a.startTime || a.scheduleData?.startTime || '23:59') - toMinutes(b.startTime || b.scheduleData?.startTime || '23:59'))
                          .map((task: any, index: number) => {
                            const isBreak = !!task.isBreak;
                            const breakStartMin = isBreak ? toMinutes(task.startTime || task.scheduleData?.startTime || '23:59') : 0;
                            const isUpcoming = isBreak && !isBreakSelectable(breakStartMin);
                            return (
                              <div key={`${task.id}-${index}`} className={`rounded-xl border p-3 ${isBreak ? 'border-slate-700/40 bg-slate-800/30' : 'border-blue-500/20 bg-blue-500/5'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-xs font-mono px-2 py-0.5 rounded ${isBreak ? 'text-slate-400 bg-slate-700/40' : 'text-blue-400 bg-blue-500/10'}`}>
                                    {task.scheduleData?.startTime || task.startTime || '9:00'} - {task.scheduleData?.endTime || task.endTime || '10:00'}
                                  </span>
                                  {isBreak && (
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${isUpcoming ? 'text-amber-400/70 bg-amber-500/10' : 'text-slate-500 bg-slate-800'}`}>
                                      {isUpcoming ? 'Upcoming' : 'Break'}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-slate-400 uppercase ml-auto text-right">{task.projectName}</span>
                                </div>
                                <p className={`text-sm font-medium line-clamp-1 ${isBreak ? 'text-slate-400' : 'text-slate-200'}`}>{task.task_name}</p>
                              </div>
                            );
                          })
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800/50">
                  {timingErrors.length > 0 && !isDismissedWarning && (
                    <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 space-y-1.5 relative">
                      <button
                        type="button"
                        onClick={() => setIsDismissedWarning(true)}
                        className="absolute top-2 right-2 text-red-400/60 hover:text-red-300 transition-colors rounded p-0.5 hover:bg-red-500/10"
                        aria-label="Dismiss warning"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      {timingErrors.map((err, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-red-400 pr-5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-amber-500 mb-3">
                    <AlertTriangle className="w-4 h-4" />
                    <span>
                      TASKS MUST BE COMPLETED TODAY. (Total: {Math.floor(totalWorkingMinutes / 60)}h {totalWorkingMinutes % 60}m
                      {odOverlapMinutes > 0 ? ` · Required reduced to ${Math.floor(requiredMinutes / 60)}h ${requiredMinutes % 60}m for OD` : ''})
                    </span>
                  </div>
                  <Button
                    className={`w-full h-12 text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 ${isValidPlan && !submitPlanMutation.isPending ? 'bg-blue-600 hover:bg-blue-500 hover:scale-[1.02] text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                    disabled={!isValidPlan || !isWindowOpen || submitPlanMutation.isPending}
                    onClick={handleNext}
                  >
                    {submitPlanMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />SUBMITTING YOUR PLAN...</>
                    ) : isValidPlan
                      ? <><span>LOCK IN MY PLAN</span><ArrowRight className="w-4 h-4 ml-2" /></>
                      : timingErrors.length > 0
                        ? "FIX TIMING ERRORS TO CONTINUE"
                        : `NEED ${(requiredMinutes / 60).toFixed(requiredMinutes % 60 === 0 ? 0 : 1)} HOURS TOTAL (CURRENT: ${Math.floor(totalWorkingMinutes / 60)}h ${totalWorkingMinutes % 60}m)`}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="max-w-4xl mx-auto">
          <Card className="bg-slate-900/80 border-amber-500/20 backdrop-blur-xl">
            <CardHeader className="bg-amber-500/5 border-b border-amber-500/10 p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-500/20 rounded-2xl flex items-center justify-center border border-amber-500/30"><AlertTriangle className="w-6 h-6 text-amber-500" /></div>
                <div><CardTitle className="text-2xl font-black text-white">Controlled Deviation Required</CardTitle><p className="text-amber-500/80 font-bold text-sm uppercase">Unselected tasks require justification</p></div>
              </div>
            </CardHeader>
            <CardContent className="p-8 space-y-8">
              <div className="p-8 rounded-3xl bg-slate-800/30 border border-slate-700/50 space-y-8">
                <div>
                  <Label className="text-slate-400 font-bold text-xs uppercase mb-4 block">Pending Tasks Being Postponed</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableTasks.filter((task: any) => !selectedTasks.find((selected: any) => selected.id === task.id)).map((task: any) => (
                      <div key={task.id} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-sm font-bold flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500/50" /> {task.task_name}</div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <Label className="text-slate-400 font-bold text-xs uppercase">Reason for Deviation *</Label>
                    <Textarea placeholder="Justification..." value={commonReason} onChange={(e) => setCommonReason(e.target.value)} className="bg-slate-900 border-slate-700 text-white min-h-[120px]" />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-slate-400 font-bold text-xs uppercase">New Target Due Date *</Label>
                    <Input type="date" value={commonNewDueDate} min={today} onChange={(e) => setCommonNewDueDate(e.target.value)} className="bg-slate-950 border-slate-800 h-16 text-lg" />
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
      )}
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
        <div className="bg-slate-900 p-2 rounded-2xl border border-slate-800 flex items-center">
          <CalendarIcon className="w-4 h-4 text-green-500 mx-3" />
          <Input type="date" value={historyDate} max={today} onChange={(e) => setHistoryDate(e.target.value)} className="bg-slate-950 border-none h-10 w-48 text-sm" />
        </div>
      </div>
      {isLoadingHistory ? <div className="py-20 text-center"><div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" /><p className="text-slate-500 font-bold uppercase text-xs">Loading...</p></div> :
        historyData?.submitted ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="bg-slate-900 border-slate-800 p-6">
              <h4 className="text-green-400 font-black mb-4 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> SELECTED</h4>
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
                    <div key={t.id} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-bold text-slate-100">{t.taskName}</h4>
                          <p className="text-xs text-slate-400 uppercase font-bold">{t.projectName}</p>
                          {subtaskName && <p className="text-[11px] text-blue-300/80 mt-1">↳ {subtaskName}</p>}
                          {toolNames.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              {toolNames.map((tn) => (
                                <span key={tn} className="inline-flex items-center gap-1 text-[10px] bg-slate-700/40 border border-slate-600/40 text-slate-300 rounded px-1.5 py-0.5">
                                  🛠 {tn}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {(start && end) && (
                          <span className="text-[10px] font-mono text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded-lg whitespace-nowrap shrink-0">
                            {start} – {end}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="bg-slate-900 border-slate-800 p-6"><h4 className="text-amber-400 font-black mb-4 flex items-center gap-2"><Clock className="w-5 h-5" /> NOT SELECTED</h4><div className="space-y-3">{historyData.postponedTasks.length === 0 ? <p className="text-slate-500 italic">None</p> : historyData.postponedTasks.map((t: any, idx: number) => (<div key={idx} className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10"><h4 className="font-bold text-amber-100">{t.task_name}</h4><p className="text-sm text-slate-300 italic">{t.reason}</p><p className="text-[10px] text-amber-500/60 uppercase mt-2">Next: {t.new_due_date}</p></div>))}</div></Card>
          </div>
        ) : <div className="py-24 text-center bg-slate-900/50 rounded-3xl border border-slate-800 border-dashed"><p className="text-slate-500 font-bold text-lg">No plan submitted for this date.</p></div>}
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
        <label className="text-[10px] uppercase text-slate-400 font-bold">Tool Selection</label>
        {values.length > 0 && (
          <span className="text-[9px] font-bold text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-full px-1.5 leading-4">
            {values.length}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full h-9 rounded-md border bg-slate-950 px-3 text-sm text-left flex items-center justify-between gap-2 outline-none transition-colors ${isOpen ? 'border-blue-500' : 'border-slate-800 hover:border-slate-700'} text-slate-200`}
      >
        <span className={`truncate ${values.length ? '' : 'text-slate-500'}`}>{displayLabel}</span>
        <div className="flex items-center gap-1 shrink-0">
          {values.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); clearAll(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clearAll(); } }}
              className="text-slate-500 hover:text-slate-300 text-xs px-1"
              aria-label="Clear all tools"
            >✕</span>
          )}
          <svg className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l4 4 4-4" /></svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-slate-900 border border-slate-700 rounded-md shadow-xl flex flex-col">
          <div className="p-2 border-b border-slate-800 shrink-0 flex items-center gap-1.5">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools..."
              className="flex-1 h-8 rounded bg-slate-950 border border-slate-800 px-2 text-xs text-slate-200 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={selectAllFiltered}
              disabled={filteredTools.length === 0}
              className="shrink-0 h-8 px-2 rounded text-[10px] font-bold uppercase text-blue-300 hover:bg-blue-500/10 border border-slate-800 hover:border-blue-500/30 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
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
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800 transition-colors ${isSelected ? 'bg-blue-900/20' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTool(tool)}
                      className="accent-blue-500 shrink-0"
                    />
                    <span className={`flex-1 truncate text-sm ${isSelected ? 'text-blue-300' : 'text-slate-200'}`}>{tool}</span>
                    {nonDev && (
                      <span className="text-[9px] uppercase text-blue-400/70 shrink-0 whitespace-nowrap">Non-dev</span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          {values.length > 0 && (
            <div className="p-2 border-t border-slate-800 shrink-0 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">{values.length} selected</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-[10px] font-bold uppercase text-slate-400 hover:text-slate-200 transition-colors"
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
            <span key={tool} className="inline-flex items-center gap-1 text-[10px] bg-blue-500/15 border border-blue-500/30 text-blue-300 rounded px-1.5 py-0.5">
              <span className="truncate max-w-[140px]">{tool}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={() => toggleTool(tool)}
                onKeyDown={(e) => { if (e.key === 'Enter') toggleTool(tool); }}
                className="hover:text-white cursor-pointer"
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
      <label className="text-[10px] uppercase text-slate-400 font-bold">Subtask</label>
      <div className="relative">
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => !isDisabled && setIsOpen(prev => !prev)}
          className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-left flex items-center justify-between gap-2 outline-none focus:border-blue-500 disabled:opacity-50 text-slate-200"
        >
          <span className="truncate">{displayLabel}</span>
          <div className="flex items-center gap-1 shrink-0">
            {values.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clearAll(); } }}
                className="text-slate-500 hover:text-slate-300 text-xs px-1"
                aria-label="Clear all"
              >✕</span>
            )}
            <svg className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l4 4 4-4" /></svg>
          </div>
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full bg-slate-900 border border-slate-700 rounded-md shadow-xl max-h-52 overflow-y-auto">
            {subtasks.map((s: any) => {
              const checked = values.includes(s.id);
              const label = s.title || s.subtask_name || s.name;
              return (
                <label
                  key={s.id}
                  className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800 transition-colors ${checked ? 'bg-blue-900/20' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSubtask(s)}
                    className="mt-0.5 accent-blue-500 shrink-0"
                  />
                  <span className="text-sm text-slate-200 leading-snug">{label}</span>
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
              <span key={id} className="inline-flex items-center gap-1 text-[10px] bg-blue-500/15 border border-blue-500/30 text-blue-300 rounded px-1.5 py-0.5">
                {s.title || s.subtask_name || s.name}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSubtask(s)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleSubtask(s); }}
                  className="hover:text-white cursor-pointer"
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