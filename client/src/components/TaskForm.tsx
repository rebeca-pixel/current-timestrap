import { useState, useEffect, useMemo } from 'react';
import { playSound, popEmoji, speak } from '@/lib/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, Square, Save, Clock, X, Check, Plus, Search, ChevronDown } from 'lucide-react';
import gamification from '@/lib/gamification';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { validateWithRules } from '@shared/timesheetValidation';
import { useValidationRules } from '@/hooks/useValidationRules';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Target, ArrowRight } from "lucide-react";
import { TOOLS_LIST } from "@shared/toolCategories";

interface ActualWorkedToolEntry {
  activityType: string;
  appName: string;
  browserName: string | null;
  websiteUrl: string | null;
  windowTitle: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

interface Task {
  id?: string;
  pmsId?: string;
  pmsSubtaskId?: string;
  project: string;
  title: string;
  keyStep?: string;
  subTask?: string;
  description: string;
  problemAndIssues: string;
  quantify: string;
  achievements: string;
  scopeOfImprovements: string;
  toolsUsed: string[];
  actualWorkTool?: string;
  startTime: string;
  endTime: string;
  percentageComplete: number;
  isRecording?: boolean;
  // Present so this Task shape is compatible with the richer Task type
  // (client/src/components/TaskTable.tsx) that callers like TaskEntryPage
  // use for their onSave handler. Computed and filled in at submit time in
  // handleSubmit below — never left undefined — so downstream consumers
  // (e.g. formatDuration(taskData.durationMinutes)) get a real number
  // instead of NaN.
  durationMinutes: number;
  isComplete: boolean;
}

interface TaskFormProps {
  task?: Task;
  onSave: (task: Task) => void;
  onCancel: () => void;
  existingTasks?: Task[];
  user?: { role: string; employeeCode: string; department?: string };
  saveButtonText?: string;
  date?: string;
}

/* ✅ NEW – project type (does NOT remove anything) */
type Project = {
  project_code: string;
  project_name: string;
};

export default function TaskForm({ task, onSave, onCancel, user, saveButtonText, date }: TaskFormProps) {
  const { rules: validationRules } = useValidationRules();
  const { user: authUser } = useAuth();
  const [formData, setFormData] = useState<Task>({
    project: task?.project || '',
    keyStep: (task as any)?.keyStep || '',
    title: task?.title || '',
    subTask: task?.subTask || '',
    description: task?.description || '',
    problemAndIssues: task?.problemAndIssues || '',
    quantify: task?.quantify || '',
    achievements: task?.achievements || '',
    scopeOfImprovements: task?.scopeOfImprovements || '',
    toolsUsed: task?.toolsUsed || [],
    actualWorkTool: (task as any)?.actualWorkTool || '',
    startTime: task?.startTime || '',
    endTime: task?.endTime || '',
    percentageComplete: task?.percentageComplete || 0,
    pmsId: task?.pmsId,
    pmsSubtaskId: (task as any)?.pmsSubtaskId,
    durationMinutes: (task as any)?.durationMinutes || 0,
    isComplete: (task as any)?.isComplete || false,
  });

  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [toolSearch, setToolSearch] = useState('');
  const [postponements, setPostponements] = useState<Array<any>>([]);
  const [showPostponements, setShowPostponements] = useState(false);

  /* ✅ NEW – side-tab navigation for the Edit Task interface.
     "details" = the existing edit form, "activity" = the independent
     Activity Timeline tab (auto-fetched TimeGuard log, read-only). */
  const [activeTaskTab, setActiveTaskTab] = useState<'details' | 'activity'>('details');

  /* ✅ UPDATED – always an array */
  const [projects, setProjects] = useState<Project[]>([]);

  /* ✅ ADDED – tasks state */
  const [tasks, setTasks] = useState<{ id: string; task_name: string }[]>([]);

  /* ✅ ADDED – subtasks state */
  const [subtasks, setSubtasks] = useState<{ id: string; title: string }[]>([]);

  /* ✅ ADDED – key steps state (from PMS) */
  const [keySteps, setKeySteps] = useState<{ id: string; name: string }[]>([]);

  /* ✅ SAFE FILTER (NO CRASH EVER) */
  const { toast } = useToast();
  const [dailyPlan, setDailyPlan] = useState<any>(null);
  const [isLoadingPlan, setIsLoadingPlan] = useState(true);
  const [showDeviationDialog, setShowDeviationDialog] = useState(false);
  const [isSuggestingDescription, setIsSuggestingDescription] = useState(false);
  const [deviationReason, setDeviationReason] = useState('');
  const [selectedDeviationTask, setSelectedDeviationTask] = useState<any>(null);

  const filteredProjects = Array.isArray(projects)
    ? projects.filter(p =>
      p.project_name?.toLowerCase().includes(projectSearch.toLowerCase())
    )
    : [];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && recordingStartTime) {
      interval = setInterval(() => {
        setElapsedTime(
          Math.floor((Date.now() - recordingStartTime.getTime()) / 1000)
        );
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, recordingStartTime]);

  /* ✅ UPDATED – SAFE FETCH */
  useEffect(() => {
    async function fetchProjects() {
      try {
        const params = new URLSearchParams();
        if (user?.role) params.append('userRole', user.role);
        if (user?.employeeCode) params.append('userEmpCode', user.employeeCode);
        if (authUser?.department) params.append('userDepartment', authUser.department);
        const url = `/api/projects${params.toString() ? '?' + params.toString() : ''}`;
        const res = await fetch(url);
        const json = await res.json();

        if (Array.isArray(json)) {
          setProjects(json);
        } else if (Array.isArray(json?.data)) {
          setProjects(json.data);
        } else {
          setProjects([]);
        }
      } catch (err) {
        console.error('Failed to fetch projects:', err);
        setProjects([]);
      }
    }
    fetchProjects();
  }, [user]);

  // Fetch postponements for PMS-backed tasks (if pmsId provided)
  useEffect(() => {
    async function fetchPostponements() {
      try {
        // @ts-ignore accept extra prop
        const pmsId = (task as any)?.pmsId;
        if (!pmsId) {
          setPostponements([]);
          return;
        }
        const res = await fetch(`/api/tasks/${pmsId}/postponements`);
        if (!res.ok) {
          setPostponements([]);
          return;
        }
        const json = await res.json();
        setPostponements(Array.isArray(json) ? json : []);
      } catch (err) {
        console.error('Failed to fetch postponements', err);
        setPostponements([]);
      }
    }
    fetchPostponements();
  }, [task]);


  useEffect(() => {
    async function fetchDailyPlan() {
      setIsLoadingPlan(true);
      if (!authUser?.id) {
        setIsLoadingPlan(false);
        return;
      }
      try {
        // Use the provided date or fall back to today's date in YYYY-MM-DD format
        const targetDate = date || new Date().toISOString().split('T')[0];
        const res = await fetch(`/api/daily-plans/${targetDate}/${authUser.id}`);
        if (res.ok) {
          const json = await res.json();
          if (json.submitted) setDailyPlan(json);
          else setDailyPlan(null); // Reset if no plan for that date
        } else {
          setDailyPlan(null);
        }
      } catch (err) {
        console.error('Failed to fetch daily plan:', err);
        setDailyPlan(null);
      } finally {
        setIsLoadingPlan(false);
      }
    }
    fetchDailyPlan();
  }, [authUser, date]);

  const sortedTasks = [...(tasks || [])].sort((a, b) => {
    if (!dailyPlan) return 0;
    const aPlanned = dailyPlan.tasks.some((pt: any) => pt.taskId === a.id);
    const bPlanned = dailyPlan.tasks.some((pt: any) => pt.taskId === b.id);
    if (aPlanned && !bPlanned) return -1;
    if (!aPlanned && bPlanned) return 1;
    return 0;
  });

  const addDeviationMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest('POST', '/api/daily-plans/deviations', payload);
      return res.json();
    },
    onSuccess: (newTask) => {
      // Refresh plan tasks
      setDailyPlan((prev: any) => ({
        ...prev,
        tasks: [...(prev?.tasks || []), newTask]
      }));
      setShowDeviationDialog(false);
      setDeviationReason('');
      setSelectedDeviationTask(null);
      toast({ title: "Deviation Added", description: "This task is now available for timesheet entry." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to add deviation", variant: "destructive" });
    }
  });

  const handleAddDeviation = () => {
    if (!selectedDeviationTask || !deviationReason) {
      toast({ title: "Selection Required", description: "Please select a task and provide a reason.", variant: "destructive" });
      return;
    }

    const projectCode = projects.find(p => p.project_name === formData.project)?.project_code;

    addDeviationMutation.mutate({
      employeeId: authUser?.id,
      taskId: selectedDeviationTask.id,
      taskName: selectedDeviationTask.task_name,
      projectName: formData.project,
      reason: deviationReason
    });
  };

  /* ✅ ADDED – fetch tasks when project or key step changes */
  useEffect(() => {
    async function fetchTasks() {
      if (!formData.project) {
        setTasks([]);
        return;
      }

      try {
        // Find the project_code from the selected project name
        const selectedProject = projects.find(p => p.project_name === formData.project);
        if (!selectedProject) {
          setTasks([]);
          return;
        }

        const params = new URLSearchParams();
        params.append('projectId', selectedProject.project_code);
        if (authUser?.department || user?.department) params.append('userDepartment', authUser?.department || user?.department || '');
        if (authUser?.employeeCode || user?.employeeCode) params.append('userEmpCode', authUser?.employeeCode || user?.employeeCode || '');
        if (authUser?.role || user?.role) params.append('userRole', authUser?.role || user?.role || '');

        const res = await fetch(`/api/tasks?${params.toString()}`);
        const json = await res.json();

        if (Array.isArray(json)) {
          // Show ALL tasks for the selected project so the user can pick any
          // task regardless of which key step is currently selected. The Key
          // Step field auto-syncs to whichever task gets picked (see the
          // effect below), so filtering tasks by key step here would trap
          // the dropdown down to a single task whenever a key step is
          // already set (e.g. when editing an existing entry).
          setTasks(json);
        } else {
          setTasks([]);
        }
      } catch (err) {
        console.error('Failed to fetch tasks:', err);
        setTasks([]);
      }
    }
    fetchTasks();
  }, [formData.project, projects]);

  // Update pmsId and auto-select keyStep when task changes
  useEffect(() => {
    if (formData.title) {
      const selectedTask = tasks.find(t => t.task_name === formData.title);
      if (selectedTask) {
        const updates: Partial<typeof formData> = {};
        if (selectedTask.id !== formData.pmsId) updates.pmsId = selectedTask.id;
        // Auto-select the key step that belongs to this task
        if ((selectedTask as any).key_step_id) {
          const matchedKeyStep = keySteps.find(k => k.id === (selectedTask as any).key_step_id);
          if (matchedKeyStep && matchedKeyStep.name !== formData.keyStep) {
            updates.keyStep = matchedKeyStep.name;
          }
        } else {
          // Task has no key_step_id — clear the key step selection, but ONLY if we aren't editing an existing entry that already had one
          if (formData.keyStep && !task?.keyStep) updates.keyStep = '';
        }
        if (Object.keys(updates).length > 0) setFormData(prev => ({ ...prev, ...updates }));
      }
    }
  }, [formData.title, tasks, keySteps, task?.keyStep]);

  /* ✅ fetch key steps for project from PMS, then filter by selected task */
  useEffect(() => {
    async function fetchKeySteps() {
      if (!formData.project) {
        setKeySteps([]);
        return;
      }
      try {
        const selectedProject = projects.find(p => p.project_name === formData.project);
        if (!selectedProject) {
          setKeySteps([]);
          return;
        }
        const params = new URLSearchParams();
        params.append('projectId', selectedProject.project_code);
        if (authUser?.department) params.append('userDepartment', authUser.department);
        const res = await fetch(`/api/key-steps?${params.toString()}`);
        const json = await res.json();
        if (Array.isArray(json)) {
          // accept both {id,name} or simple strings
          const allMapped = json.map((k: any) => (typeof k === 'string' ? { id: k, name: k } : { id: k.id || k.key || k.name, name: k.name || k.key || String(k) }));

          // If a task is selected and it has a key_step_id, only show that key step
          const selectedTask = formData.title ? tasks.find(t => t.task_name === formData.title) : null;
          const taskKeyStepId = (selectedTask as any)?.key_step_id;

          if (taskKeyStepId) {
            const filtered = allMapped.filter(k => k.id === taskKeyStepId);
            setKeySteps(filtered.length > 0 ? filtered : allMapped);
          } else {
            setKeySteps(allMapped);
          }
        } else {
          setKeySteps([]);
        }
      } catch (err) {
        console.error('Failed to fetch key steps:', err);
        setKeySteps([]);
      }
    }
    fetchKeySteps();
  }, [formData.project, formData.title, tasks, projects]);

  useEffect(() => {
    async function fetchSubtasks() {
      if (!formData.title) {
        setSubtasks([]);
        return;
      }

      try {
        // Find the task_id from the selected task name. Fall back to the
        // pmsId already stored on this entry — the currently-loaded task
        // list can be filtered by department/employee/role and may not
        // contain this task by name (e.g. when editing an existing or
        // postponed entry), even though we already know its real ID.
        const selectedTask = tasks.find(t => t.task_name === formData.title);
        const taskId = selectedTask?.id || formData.pmsId;
        if (!taskId) {
          setSubtasks([]);
          return;
        }

        const params = new URLSearchParams();
        params.append('taskId', taskId);
        if (authUser?.department || user?.department) params.append('userDepartment', authUser?.department || user?.department || '');
        if (authUser?.employeeCode || user?.employeeCode) params.append('userEmpCode', authUser?.employeeCode || user?.employeeCode || '');

        const res = await fetch(`/api/subtasks?${params.toString()}`);
        const json = await res.json();

        if (Array.isArray(json)) {
          setSubtasks(json);
        } else {
          setSubtasks([]);
        }
      } catch (err) {
        console.error('Failed to fetch subtasks:', err);
        setSubtasks([]);
      }
    }
    fetchSubtasks();
  }, [formData.title, tasks, formData.pmsId]);

  // Re-sync the displayed subtask once the list loads: if this entry already
  // has a pmsSubtaskId (assigned by ID) but formData.subTask doesn't match
  // any title in the freshly-fetched list, fill it in from the match.
  useEffect(() => {
    if (!formData.pmsSubtaskId || subtasks.length === 0) return;
    const matched = subtasks.find(s => s.id === formData.pmsSubtaskId);
    if (matched && matched.title !== formData.subTask) {
      setFormData(prev => ({ ...prev, subTask: matched.title }));
    }
  }, [subtasks, formData.pmsSubtaskId]);

  // Automatically select Project, Key Step, Task, and Subtask based on Plan of the Day selection on load/edit
  const [hasAutoSelectedPlan, setHasAutoSelectedPlan] = useState(false);

  useEffect(() => {
    async function autoSelectPlanTask() {
      if (hasAutoSelectedPlan || !dailyPlan?.tasks || projects.length === 0) return;

      const plannedId = task?.pmsId || task?.id;
      if (!plannedId) return;

      const pt = dailyPlan.tasks.find((t: any) => t.taskId === plannedId || t.id === plannedId || t.taskName === task?.title);
      if (!pt) return;

      setHasAutoSelectedPlan(true);

      try {
        const projectName = pt.projectName;
        const selectedProject = projects.find(p => p.project_name === projectName);
        if (!selectedProject) return;

        // Fetch Key Steps
        const paramsKs = new URLSearchParams();
        paramsKs.append('projectId', selectedProject.project_code);
        if (authUser?.department) paramsKs.append('userDepartment', authUser.department);
        const resKs = await fetch(`/api/key-steps?${paramsKs.toString()}`);
        const keyStepsData = await resKs.json();
        const mappedKeySteps = keyStepsData.map((k: any) =>
          typeof k === 'string' ? { id: k, name: k } : { id: k.id || k.key || k.name, name: k.name || k.key || String(k) }
        );
        setKeySteps(mappedKeySteps);

        // Fetch Tasks
        const paramsT = new URLSearchParams();
        paramsT.append('projectId', selectedProject.project_code);
        if (authUser?.department || user?.department) paramsT.append('userDepartment', authUser?.department || user?.department || '');
        if (authUser?.employeeCode || user?.employeeCode) paramsT.append('userEmpCode', authUser?.employeeCode || user?.employeeCode || '');
        if (authUser?.role || user?.role) paramsT.append('userRole', authUser?.role || user?.role || '');
        const resT = await fetch(`/api/tasks?${paramsT.toString()}`);
        const tasksData = await resT.json();

        const targetTask = tasksData.find((t: any) => t.id === pt.taskId || t.task_name === pt.taskName);
        if (!targetTask) return;

        let matchedKeyStepName = '';
        if (targetTask.key_step_id) {
          const ksObj = mappedKeySteps.find((k: any) => k.id === targetTask.key_step_id);
          if (ksObj) matchedKeyStepName = ksObj.name;
        }
        // Keep the full task list for the project so the dropdown shows
        // every available task, not just the ones sharing the planned
        // task's key step.
        setTasks(tasksData);

        // Fetch Subtasks
        const paramsS = new URLSearchParams();
        paramsS.append('taskId', targetTask.id);
        if (authUser?.department || user?.department) paramsS.append('userDepartment', authUser?.department || user?.department || '');
        if (authUser?.employeeCode || user?.employeeCode) paramsS.append('userEmpCode', authUser?.employeeCode || user?.employeeCode || '');
        const resS = await fetch(`/api/subtasks?${paramsS.toString()}`);
        const subtasksData = await resS.json();
        setSubtasks(subtasksData);

        const planSched = typeof pt.scheduleData === 'string' ? JSON.parse(pt.scheduleData) : (pt.scheduleData || {});
        const plannedSubtaskId = planSched.subtaskId || planSched.subtaskIds?.[0] || '';
        const plannedSubtaskName = planSched.subtaskName || planSched.subtaskNames?.[0] || '';

        let matchedSubtaskTitle = '';
        if (plannedSubtaskId) {
          const subObj = subtasksData.find((s: any) => s.id === plannedSubtaskId);
          if (subObj) matchedSubtaskTitle = subObj.title;
        }
        if (!matchedSubtaskTitle && plannedSubtaskName) {
          const subObj = subtasksData.find((s: any) => s.title === plannedSubtaskName);
          if (subObj) matchedSubtaskTitle = subObj.title;
        }

        setFormData(prev => ({
          ...prev,
          project: projectName,
          keyStep: matchedKeyStepName,
          title: targetTask.task_name,
          subTask: matchedSubtaskTitle,
          pmsId: targetTask.id,
          pmsSubtaskId: plannedSubtaskId || undefined,
        }));

      } catch (err) {
        console.error('Error auto-selecting planned task on load:', err);
      }
    }

    autoSelectPlanTask();
  }, [dailyPlan, projects, task, authUser, user, hasAutoSelectedPlan]);

  const getCurrentISTTime = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    return new Date(now.getTime() + istOffset).toISOString().slice(11, 16);
  };

  const formatElapsedTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = () => {
    setIsRecording(true);
    setRecordingStartTime(new Date());
    setFormData({ ...formData, startTime: getCurrentISTTime() });
  };

  const stopRecording = () => {
    setIsRecording(false);
    setFormData({ ...formData, endTime: getCurrentISTTime() });
  };

  const toggleTool = (tool: string) => {
    setFormData({
      ...formData,
      toolsUsed: formData.toolsUsed.includes(tool)
        ? formData.toolsUsed.filter(t => t !== tool)
        : [...formData.toolsUsed, tool],
    });
  };

  const { data: timeguardSuggestionsSetting } = useQuery<{ timeguardSuggestionsEnabled: boolean }>({
    queryKey: ['/api/settings/timeguard-suggestions'],
  });
  const timeguardSuggestionsEnabled = timeguardSuggestionsSetting?.timeguardSuggestionsEnabled !== false;

  // Actual Worked Tools — read-only, auto-fetched from TimeGuard's
  // activity_tool log for this Timestrap session's start/end window.
  const employeeCodeForActivity = (authUser as any)?.employeeCode || (user as any)?.employeeCode;
  const actualWorkedToolsEnabled = !!employeeCodeForActivity && !!date && !!formData.startTime && !!formData.endTime;
  const { data: actualWorkedToolsData, isFetching: isFetchingActualWorkedTools } = useQuery<{ entries: ActualWorkedToolEntry[] }>({
    queryKey: ['/api/timeguard/actual-worked-tools', employeeCodeForActivity, date, formData.startTime, formData.endTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        employeeCode: employeeCodeForActivity,
        date: date || '',
        startTime: formData.startTime,
        endTime: formData.endTime,
      });
      const res = await fetch(`/api/timeguard/actual-worked-tools?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: actualWorkedToolsEnabled,
  });
  const actualWorkedTools = actualWorkedToolsData?.entries || [];

  const extractDomain = (url: string | null) => {
    if (!url) return null;
    try {
      const withProto = url.match(/^[a-zA-Z]+:\/\//) ? url : `https://${url}`;
      return new URL(withProto).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  // Combine every minute-by-minute session into one row per application
  // (or per browser+website for website activity), summing total time
  // and tracking the earliest start / latest end across all its sessions.
  const aggregatedWorkedTools = useMemo(() => {
    const groups = new Map<string, {
      appName: string;
      browserName: string | null;
      websiteUrl: string | null;
      titles: Set<string>;
      totalDurationSeconds: number;
      earliestStart: string;
      latestEnd: string;
      sessionCount: number;
    }>();

    for (const entry of actualWorkedTools) {
      // Trust the API's browserName/websiteUrl directly rather than only
      // activityType === 'website' — the backend now also flags known
      // browser apps (e.g. Chrome logged as a plain 'app' row when it
      // couldn't resolve a specific site) so Browser still shows up even
      // without a captured URL.
      const domain = entry.websiteUrl ? extractDomain(entry.websiteUrl) : null;
      const isBrowserRow = !!(entry.browserName || domain);
      const key = isBrowserRow
        ? `web::${(entry.browserName || entry.appName || '').toLowerCase()}::${(domain || '').toLowerCase()}`
        : `app::${(entry.appName || '').toLowerCase()}`;

      const existing = groups.get(key);
      if (existing) {
        existing.totalDurationSeconds += entry.durationSeconds;
        existing.sessionCount += 1;
        if (entry.windowTitle) existing.titles.add(entry.windowTitle);
        if (new Date(entry.startTime) < new Date(existing.earliestStart)) existing.earliestStart = entry.startTime;
        if (new Date(entry.endTime) > new Date(existing.latestEnd)) existing.latestEnd = entry.endTime;
      } else {
        groups.set(key, {
          appName: isBrowserRow ? '' : entry.appName,
          browserName: isBrowserRow ? (entry.browserName || entry.appName) : null,
          websiteUrl: domain || entry.websiteUrl,
          titles: new Set(entry.windowTitle ? [entry.windowTitle] : []),
          totalDurationSeconds: entry.durationSeconds,
          earliestStart: entry.startTime,
          latestEnd: entry.endTime,
          sessionCount: 1,
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds);
  }, [actualWorkedTools]);

  // Chronological timeline for the "Activity Timeline" side tab — mirrors a
  // handwritten day-log: contiguous stretches of work are collapsed into one
  // block listing every tool/site touched during that stretch (e.g.
  // "10:00–11:00 → Chrome — claude, supabase, etc"), and any gap between
  // stretches of tracked activity becomes its own "idle" block
  // (e.g. "11:00–11:15 → 15m idle"). This is distinct from
  // aggregatedWorkedTools above (which totals time per-app across the whole
  // window) — the timeline instead preserves the order/flow of the day.
  const IDLE_GAP_SECONDS = 120; // gaps of 2+ minutes with no tracked activity are shown as idle

  // STEP 5 — Rule-Based Task Matching: a block is "Matched" if the tools it
  // contains overlap with what the employee planned for this task
  // (formData.toolsUsed), "Partial Match" if only some overlap, and
  // "Unclassified" if none do (or nothing was planned to compare against).
  // Comparison is case-insensitive/trimmed, mirroring the existing pattern
  // used server-side in toolUsageValidation.ts.
  const computeMatchStatus = (
    blockTools: string[],
    plannedTools: string[]
  ): { status: 'Matched' | 'Partial Match' | 'Unclassified'; ratio: number } => {
    if (blockTools.length === 0 || plannedTools.length === 0) {
      return { status: 'Unclassified', ratio: 0 };
    }
    const plannedNormalized = new Set(plannedTools.map((t) => t.trim().toLowerCase()));
    const matchedCount = blockTools.filter((t) => plannedNormalized.has(t.trim().toLowerCase())).length;
    const ratio = matchedCount / blockTools.length;
    const status = ratio >= 0.6 ? 'Matched' : ratio >= 0.25 ? 'Partial Match' : 'Unclassified';
    return { status, ratio };
  };

  const activityTimeline = useMemo(() => {
    type TimelineBlock = {
      type: 'activity' | 'idle';
      startTime: string;
      endTime: string;
      durationSeconds: number;
      tools: string[]; // distinct app/site labels touched during this block, in order
      matchStatus?: 'Matched' | 'Partial Match' | 'Unclassified';
      matchRatio?: number;
    };

    if (!actualWorkedTools.length) return [] as TimelineBlock[];

    const sorted = [...actualWorkedTools].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    const labelFor = (entry: ActualWorkedToolEntry) => {
      const domain = entry.websiteUrl ? extractDomain(entry.websiteUrl) : null;
      if (domain) return domain;
      if (entry.browserName) return entry.browserName;
      return entry.appName || 'App';
    };

    const blocks: TimelineBlock[] = [];
    let current: TimelineBlock | null = null;

    const closeCurrent = () => {
      if (!current) return;
      if (current.type === 'activity') {
        const { status, ratio } = computeMatchStatus(current.tools, formData.toolsUsed || []);
        current.matchStatus = status;
        current.matchRatio = ratio;
      }
      blocks.push(current);
    };

    for (const entry of sorted) {
      const isIdleEntry = entry.activityType === 'idle';
      const start = entry.startTime;
      const end = entry.endTime;
      const label = isIdleEntry ? null : labelFor(entry);
      const gapSeconds = current
        ? Math.round((new Date(start).getTime() - new Date(current.endTime).getTime()) / 1000)
        : 0;

      if (isIdleEntry) {
        closeCurrent();
        current = null;
        blocks.push({ type: 'idle', startTime: start, endTime: end, durationSeconds: entry.durationSeconds, tools: [] });
        continue;
      }

      // A block continues only if it's the SAME tool/app AND within the idle
      // gap threshold — a tool change always starts a new block, even with
      // no time gap at all (this is what fixes multi-tool blocks being
      // merged into one long, unreadable, unmatchable entry).
      const sameTool = current && current.type === 'activity' && current.tools.length === 1 && current.tools[0] === label;

      if (current && current.type === 'activity' && sameTool && gapSeconds < IDLE_GAP_SECONDS) {
        current.endTime = end;
        current.durationSeconds += entry.durationSeconds;
        continue;
      }

      // Not the same tool, or not contiguous — close the current block first.
      if (current) {
        closeCurrent();
        if (current.type === 'activity' && gapSeconds >= IDLE_GAP_SECONDS) {
          blocks.push({
            type: 'idle',
            startTime: current.endTime,
            endTime: start,
            durationSeconds: gapSeconds,
            tools: [],
          });
        }
      }

      current = {
        type: 'activity',
        startTime: start,
        endTime: end,
        durationSeconds: entry.durationSeconds,
        tools: [label as string],
      };
    }
    closeCurrent();

    return blocks;
  }, [actualWorkedTools, formData.toolsUsed]);

  // Keep formData.actualWorkTool (persisted with the task) in sync with the
  // auto-fetched TimeGuard data — read-only from the employee's perspective,
  // never manually typed.
  useEffect(() => {
    if (!actualWorkedToolsEnabled) return;
    const summary = aggregatedWorkedTools
      .map((g) => {
        const parts = [
          g.websiteUrl ? (g.browserName || 'Browser') : g.appName,
          g.websiteUrl ? `Site: ${g.websiteUrl}` : null,
          `${new Date(g.earliestStart).toLocaleTimeString()}–${new Date(g.latestEnd).toLocaleTimeString()}`,
          `${Math.round(g.totalDurationSeconds / 60)}m total`,
        ].filter(Boolean);
        return `- ${parts.join(' | ')}`;
      })
      .join('\n');
    setFormData((prev) => (prev.actualWorkTool === summary ? prev : { ...prev, actualWorkTool: summary }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregatedWorkedTools, actualWorkedToolsEnabled]);

  const handleSuggestWorkSummary = async () => {
    const employeeCode = (authUser as any)?.employeeCode || (user as any)?.employeeCode;
    if (!employeeCode || !formData.startTime || !formData.endTime || !date) {
      toast({
        title: 'Missing info',
        description: 'Start time and end time are required before suggesting a summary.',
        variant: 'destructive',
      });
      return;
    }
    setIsSuggestingDescription(true);
    try {
      const params = new URLSearchParams({
        employeeCode,
        date,
        startTime: formData.startTime,
        endTime: formData.endTime,
        project: formData.project || '',
        taskTitle: formData.title || '',
        subTask: formData.subTask || '',
      });
      const res = await fetch(`/api/timeguard/suggest-work-summary?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.noData) {
        toast({
          title: 'Nothing to suggest',
          description: 'TimeGuard has no tracked activity for this employee during that window.',
        });
        return;
      }
      setFormData((prev) => ({
        ...prev,
        description: data.description || prev.description,
        achievements: data.achievements || prev.achievements,
        quantify: data.quantifyResult || prev.quantify,
        actualWorkTool: data.actualWorkTool || prev.actualWorkTool,
      }));
      if (!data.description && !data.achievements && !data.quantifyResult && !data.actualWorkTool) {
        toast({
          title: 'Nothing to suggest',
          description: "TimeGuard's activity for this window wasn't specific enough to draft a summary — please fill these in manually.",
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Could not fetch a suggestion from TimeGuard right now.',
        variant: 'destructive',
      });
    } finally {
      setIsSuggestingDescription(false);
    }
  };

  const validateForm = () => {
    const errs: string[] = [];
    if (!formData.project) errs.push('Project is required');
    if (!formData.title) errs.push('Task is required');
    // If subtasks exist, one must be selected
    if (subtasks.length > 0 && !formData.subTask) {
      errs.push('Sub Task selection is mandatory for this task');
    }
    if (!formData.startTime) errs.push('Start time is required');
    if (!formData.endTime) errs.push('End time is required');
    // Mandatory-field rules configured by the Admin (same ones the server enforces)
    errs.push(...validateWithRules(formData, validationRules, 'submit'));
    setErrors(errs);
    return errs.length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validateForm()) return;
    setIsSubmitting(true);
    // include original id when saving so drafts are updated
    const payload: any = { ...formData };
    if (task?.id) payload.id = task.id;
    // Recompute from the live start/end time so a just-edited time range is
    // reflected, rather than trusting whatever durationMinutes formData was
    // initialized with (which could be stale or 0 for a brand-new task).
    if (formData.startTime && formData.endTime) {
      const [sh, sm] = formData.startTime.split(':').map(Number);
      const [eh, em] = formData.endTime.split(':').map(Number);
      const diff = (eh * 60 + em) - (sh * 60 + sm);
      payload.durationMinutes = diff > 0 ? diff : 0;
    }
    payload.isComplete = (task as any)?.isComplete || false;
    // include pmsId if present
    // include pmsId if present
    // @ts-ignore
    if (formData.pmsId) payload.pmsId = formData.pmsId;
    if (formData.pmsSubtaskId) (payload as any).pmsSubtaskId = formData.pmsSubtaskId;
    try { playSound('confirm'); popEmoji(document.querySelector('[data-testid="button-save-task"]') as HTMLElement, '💾'); } catch { };
    onSave(payload);
    // onSave hands off to the caller's own async save (which may fail, e.g. a
    // tool-validation error) and does not stay mounted-and-locked waiting for
    // it. Reset here so a failed save can be retried immediately instead of
    // silently no-op'ing on the next click (isSubmitting would otherwise never
    // clear once set).
    setIsSubmitting(false);
    try {
      playSound('hurray');
    } catch { }
    try {
      // Award points only when task marked complete (100%) — per-project
      try {
        if (formData.percentageComplete === 100 && formData.project) {
          const projectId = formData.project;
          // Determine if the task is overdue by comparing its due date to today
          // formData.date is the date the work is logged; PMS due date may be
          // available via pms_due_date or endDate (rare on this form). Fall back
          // to the form date itself.
          let dueDateIso: string | null = null;
          try {
            const candidate: any = (formData as any).pms_due_date
              || (formData as any).endDate
              || (formData as any).dueDate
              || (formData as any).end_date
              || (formData as any).date;
            if (candidate) {
              const d = new Date(candidate);
              if (!isNaN(d.getTime())) {
                // Only consider "due date" overdue if it's a strictly earlier
                // calendar day than today.
                const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                const today = new Date();
                const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                if (due.getTime() < t.getTime()) dueDateIso = due.toISOString();
              }
            }
          } catch { }
          const taskName = (formData as any).title || 'Task';
          const isOverdue = !!dueDateIso;
          // If overdue, deduct points (negative) — using the new gamification
          // API that also records the entry for the daily summary dialog.
          // Otherwise add 10 points and record the earned entry.
          try {
            const gam = require('@/lib/gamification');
            if (isOverdue) {
              const res = (gam as any).subtractPointsForProject(
                projectId,
                5,
                'task-overdue',
                { taskName, overdue: true }
              );
              try { const { toast } = require('@/hooks/use-toast'); if (res.pointsRemoved) toast({ title: `Overdue: -${res.pointsRemoved} pts`, description: `Task "${taskName}" completed after its due date.`, variant: 'destructive' }); } catch { }
            } else {
              const res = (gam as any).addPointsForProject(
                projectId,
                10,
                'task-complete',
                { taskName, onTime: true }
              );
              try { const { toast } = require('@/hooks/use-toast'); if (res.pointsAdded) toast({ title: `+${res.pointsAdded} pts`, description: `Great! You earned points for completing this task.` }); } catch { }
            }
          } catch (e) {
            // Fallback to legacy call (no metadata) so the existing flow
            // still works even if our new arg shape is unsupported.
            try {
              const res = (require('@/lib/gamification') as any).addPointsForProject(projectId, isOverdue ? -5 : 10, 'task-complete');
              try { const { toast } = require('@/hooks/use-toast'); if (res && res.pointsAdded) toast({ title: `+${res.pointsAdded} pts`, description: `Great! You earned points for completing this task.` }); } catch { }
            } catch { }
          }
        }
      } catch (e) { }
    } catch { }
  };

  return (
    <Card className="bg-slate-800/50 border-blue-500/20 tracker-task-form-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg text-white flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <span>{task?.id ? 'Edit Task' : 'Add New Task'}</span>
            {postponements.length > 0 && (
              <Badge variant="outline" className="bg-green-600/10 text-green-300">
                {postponements.length === 1 ? 'Postponed once' : `Postponed ${postponements.length} times`}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isRecording ? (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 rounded-md border border-red-500/30">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-400 font-mono text-sm">{formatElapsedTime(elapsedTime)}</span>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={stopRecording}
                  data-testid="button-stop-recording"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={startRecording}
                className="bg-green-600 hover:bg-green-500 tracker-btn-start-recording"
                data-testid="button-start-recording"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Recording
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* ✅ Independent top tab bar for the Edit Task interface.
            "Activity Timeline" is its own tab, not embedded in the form. */}
        <div className="flex items-center gap-1 border-b border-blue-500/15 mb-6" data-testid="tabs-edit-task">
          <button
            type="button"
            onClick={() => setActiveTaskTab('details')}
            className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${activeTaskTab === 'details'
              ? 'text-blue-200'
              : 'text-slate-400 hover:text-blue-200'
              }`}
            data-testid="tab-task-details"
          >
            Task Details
            {activeTaskTab === 'details' && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTaskTab('activity')}
            className={`relative px-4 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2 ${activeTaskTab === 'activity'
              ? 'text-blue-200'
              : 'text-slate-400 hover:text-blue-200'
              }`}
            data-testid="tab-activity-timeline"
          >
            <Clock className="w-3.5 h-3.5" />
            Activity Timeline
            {isFetchingActualWorkedTools && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            )}
            {activeTaskTab === 'activity' && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500" />
            )}
          </button>
        </div>

        {/* Panel content */}
        <div>
          {activeTaskTab === 'activity' ? (
            <ActivityTimelinePanel
              enabled={actualWorkedToolsEnabled}
              isFetching={isFetchingActualWorkedTools}
              timeline={activityTimeline}
              aggregated={aggregatedWorkedTools}
            />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {errors.length > 0 && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20">
                  {errors.map((error, i) => (
                    <p key={i} className="text-sm text-red-400">{error}</p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="project" className="text-blue-100 tracker-form-label">Project *</Label>
                  <Select
                    value={formData.project}
                    onValueChange={(v) => {
                      setFormData({ ...formData, project: v, title: '', subTask: '' });
                      try {
                        // choose variant based on index so different projects produce slightly varied tones
                        const idx = filteredProjects.findIndex(p => p.project_name === v);
                        const variant = idx >= 0 ? (idx % 5) + 1 : undefined;
                        playSound('select', variant);
                        popEmoji(document.querySelector('[data-testid="select-project"]') as HTMLElement);
                      } catch { }
                    }}
                  >
                    <SelectTrigger className="tracker-form-input" data-testid="select-project" data-radix-select-trigger>
                      <SelectValue placeholder="Select a project" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] tracker-select-content">
                      <div className="flex items-center px-3 pb-2 pt-1 border-b border-blue-500/10">
                        <Search className="w-3.5 h-3.5 text-blue-400/50 mr-2" />
                        <input
                          className="flex-1 bg-transparent border-none outline-none text-xs text-white placeholder:text-blue-400/30"
                          placeholder="Search projects..."
                          value={projectSearch}
                          onChange={(e) => setProjectSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      {/* Ensure prefilled project is visible even if not in fetched list */}
                      {/* Ensure prefilled project is visible even if not in fetched list */}
                      {formData.project && !projects.find(p => p.project_name === formData.project) && (
                        <SelectItem value={formData.project}>{formData.project}</SelectItem>
                      )}
                      {filteredProjects.length > 0 ? (
                        filteredProjects.map(p => (
                          <SelectItem key={p.project_code} value={p.project_name}>{p.project_name}</SelectItem>
                        ))
                      ) : (
                        <div className="py-2 px-8 text-xs text-blue-400/40 italic">No projects found</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keyStep" className="text-blue-100 tracker-form-label">Key Step</Label>
                  <Select
                    value={(formData as any).keyStep || ''}
                    onValueChange={(v) => {
                      setFormData({ ...formData, keyStep: v });
                      try {
                        const idx = keySteps.findIndex(k => k.name === v);
                        const variant = idx >= 0 ? (idx % 5) + 1 : undefined;
                        playSound('select', variant);
                        popEmoji(document.querySelector('[data-testid="select-keystep"]') as HTMLElement, '🔑');
                      } catch { }
                    }}
                  >
                    <SelectTrigger className="tracker-form-input" data-testid="select-keystep" data-radix-select-trigger>
                      <SelectValue placeholder="Select key step" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] tracker-select-content">
                      {/* Ensure prefilled key step is visible even if not in fetched list */}
                      {formData.keyStep && !keySteps.find(k => k.name === formData.keyStep) && (
                        <SelectItem value={formData.keyStep}>{formData.keyStep}</SelectItem>
                      )}
                      {keySteps.length === 0 && !formData.keyStep && (
                        <div className="py-2 px-8 text-xs text-blue-400/40 italic">No key steps found for this project</div>
                      )}
                      {keySteps.map(k => (
                        <SelectItem key={k.id} value={k.name}>{k.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <hr className="tracker-form-divider" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="title" className="text-blue-100 tracker-form-label">Task *</Label>
                    <button
                      type="button"
                      onClick={() => setShowDeviationDialog(true)}
                      className="text-[10px] text-amber-500 hover:text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1 tracker-add-deviation-btn"
                    >
                      <Plus className="w-3 h-3" />
                      Add Deviation
                    </button>
                  </div>
                  <Select
                    value={formData.title}
                    onValueChange={(v) => {
                      setFormData({ ...formData, title: v, subTask: '' });
                      try {
                        const idx = tasks.findIndex(t => t.task_name === v);
                        const variant = idx >= 0 ? (idx % 5) + 1 : undefined;
                        playSound('select', variant);
                        popEmoji(document.querySelector('[data-testid="select-task"]') as HTMLElement, '🧩');
                      } catch { }
                    }}
                  >
                    <SelectTrigger className="tracker-form-input" data-testid="select-task">
                      <SelectValue placeholder="Select a task" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[200px] tracker-select-content">
                      {/* Ensure prefilled task is visible even if not in fetched list */}
                      {sortedTasks.length > 0 ? (
                        sortedTasks.map(task => {
                          const isPlanned = dailyPlan?.tasks?.some((pt: any) => pt.taskId === task.id);
                          return (
                            <SelectItem key={task.id} value={task.task_name} className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-2">
                                {task.task_name}
                                {isPlanned && (
                                  <Badge variant="outline" className="bg-blue-600/20 text-blue-300 border-blue-500/30 text-[9px] py-0 h-4">
                                    PLANNED
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })
                      ) : (
                        <div className="py-2 px-8 text-xs text-blue-400/40 italic">
                          {formData.project ? 'No tasks found for this project' : 'Select a project first'}
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subTask" className="text-blue-100 tracker-form-label">
                    Sub Task {subtasks.length > 0 && <span className="text-red-400">*</span>}
                  </Label>
                  <Select
                    value={formData.subTask}
                    onValueChange={(value) => {
                      const selected = subtasks.find(s => s.title === value);
                      setFormData({
                        ...formData,
                        subTask: value,
                        pmsSubtaskId: selected?.id
                      });
                      try {
                        const idx = subtasks.findIndex(s => s.title === value);
                        const variant = idx >= 0 ? (idx % 5) + 1 : undefined;
                        playSound('select', variant);
                        popEmoji(document.querySelector('[data-testid="select-subtask"]') as HTMLElement, '📎');
                      } catch { }
                    }}
                    data-testid="select-subtask"
                  >
                    <SelectTrigger className="tracker-form-input">
                      <SelectValue placeholder="Select a sub task" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-blue-500/20 tracker-select-content">
                      {/* Ensure prefilled subtask is visible even if not in fetched list */}
                      {formData.subTask && !subtasks.find(s => s.title === formData.subTask) && (
                        <SelectItem value={formData.subTask}>{formData.subTask}</SelectItem>
                      )}
                      {subtasks.length > 0 ? (
                        subtasks.map((subtask) => (
                          <SelectItem key={subtask.id} value={subtask.title}>{subtask.title}</SelectItem>
                        ))
                      ) : (
                        <div className="py-2 px-8 text-xs text-blue-400/40 italic">
                          {formData.title ? 'No subtasks available for this task' : 'Select a task first'}
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <hr className="tracker-form-divider" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="quantify" className="text-blue-100 tracker-form-label">Quantify Your Result *</Label>
                  <Input
                    id="quantify"
                    placeholder="Enter quantify (e.g., 5 reports, 10 calls) - max 10 words"
                    value={formData.quantify}
                    onChange={(e) => setFormData({ ...formData, quantify: e.target.value })}
                    onFocus={(e) => { try { playSound('confirm'); if (Math.random() < 0.5) { speak('Tell me the numbers — how many?'); const el = (e.target || e.currentTarget) as HTMLElement | null; if (el) { const r = el.getBoundingClientRect(); window.dispatchEvent(new CustomEvent('mascot:showNear', { detail: { text: 'Tell me the numbers — how many?', rect: { left: r.left, top: r.top, width: r.width, height: r.height } } })); } } } catch { } }}
                    onBlur={() => {
                      try {
                        if (formData.quantify && formData.quantify.trim().length > 0) {
                          playSound('confirm', 2);
                          // window.dispatchEvent(new CustomEvent('mascot:doll', { detail: { text: "Nice numbers!", x: 70, y: 60 } }));
                          speak('Haha! Nice numbers.');
                          const el = document.querySelector('[data-testid="input-quantify"]') as HTMLElement | null;
                          if (el) {
                            const rect = el.getBoundingClientRect();
                            const detail = { text: `Haha! Nice — ${formData.quantify}`, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
                            console.debug('[TaskForm] dispatching mascot:showNear (blur quantify)', detail);
                            window.dispatchEvent(new CustomEvent('mascot:showNear', { detail }));
                          }
                        }
                      } catch { }
                    }}
                    className="tracker-form-input"
                    data-testid="input-quantify"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="achievements" className="text-blue-100 tracker-form-label">Achievements</Label>
                  <Input
                    id="achievements"
                    placeholder="What did you accomplish? (max 10 words; or fill Problems & Issues)"
                    value={formData.achievements}
                    onChange={(e) => setFormData({ ...formData, achievements: e.target.value })}
                    onFocus={(e) => {
                      try {
                        playSound('confirm');
                        speak('Hey! Tell me what you achieved today.');
                        const el = (e.target || e.currentTarget) as HTMLElement | null;
                        const rect = el ? el.getBoundingClientRect() : null;
                        if (rect && Math.random() < 0.5) {
                          // pass a plain object with the rect numbers to avoid cross-origin serialization issues
                          const detail = { text: 'Tell me, what did you achieve?', rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
                          console.debug('[TaskForm] dispatching mascot:showNear', detail);
                          window.dispatchEvent(new CustomEvent('mascot:showNear', { detail }));
                        }
                      } catch { }
                    }}
                    onBlur={() => { try { if (formData.achievements && formData.achievements.trim().length > 0) { playSound('wow'); speak('Wow, really great! Keep it up.'); popEmoji(document.querySelector('[data-testid="input-achievements"]') as HTMLElement, '🎉'); } } catch { } }}
                    className="tracker-form-input"
                    data-testid="input-achievements"
                  />
                </div>

              </div>

              <hr className="tracker-form-divider" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="problemAndIssues" className="text-blue-100 tracker-form-label">Problems & Issues</Label>
                  <Input
                    id="problemAndIssues"
                    placeholder="Enter any problems or issues faced"
                    value={formData.problemAndIssues}
                    onChange={(e) => setFormData({ ...formData, problemAndIssues: e.target.value })}
                    onFocus={(e) => { try { playSound('select', 2); if (Math.random() < 0.4) { speak('Any blockers? Tell me the problem.'); const el = (e.target || e.currentTarget) as HTMLElement | null; if (el) { const r = el.getBoundingClientRect(); window.dispatchEvent(new CustomEvent('mascot:showNear', { detail: { text: 'Any blockers? Tell me the problem.', rect: { left: r.left, top: r.top, width: r.width, height: r.height } } })); } } } catch { } }}
                    onBlur={() => { try { if (formData.problemAndIssues && formData.problemAndIssues.trim().length > 0) { playSound('confirm'); speak('Thanks for noting that — you are thorough.'); } } catch { } }}
                    className="tracker-form-input"
                    data-testid="input-problem-issues"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scopeOfImprovements" className="text-blue-100 tracker-form-label">Scope of Improvements</Label>
                  <Input
                    id="scopeOfImprovements"
                    placeholder="Areas for improvement"
                    value={formData.scopeOfImprovements}
                    onChange={(e) => setFormData({ ...formData, scopeOfImprovements: e.target.value })}
                    onFocus={(e) => { try { playSound('select', 3); if (Math.random() < 0.4) { speak('How can this get even better?'); const el = (e.target || e.currentTarget) as HTMLElement | null; if (el) { const r = el.getBoundingClientRect(); window.dispatchEvent(new CustomEvent('mascot:showNear', { detail: { text: 'How can this get even better?', rect: { left: r.left, top: r.top, width: r.width, height: r.height } } })); } } } catch { } }}
                    onBlur={() => { try { if (formData.scopeOfImprovements && formData.scopeOfImprovements.trim().length > 0) { playSound('confirm'); speak('Great improvement idea — small steps make a difference.'); } } catch { } }}
                    className="tracker-form-input"
                    data-testid="input-scope-improvements"
                  />
                </div>
              </div>

              <hr className="tracker-form-divider" />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description" className="text-blue-100 tracker-form-label">
                    Description <span className="text-blue-400/60 text-xs">(optional, max 10 words)</span>
                  </Label>
                  {timeguardSuggestionsEnabled && (
                    <button
                      type="button"
                      onClick={handleSuggestWorkSummary}
                      disabled={isSuggestingDescription}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      data-testid="button-suggest-description"
                      title="Fills Description, Achievements, and Quantify Your Result from TimeGuard's tracked activity"
                    >
                      {isSuggestingDescription ? 'Analyzing TimeGuard activity…' : '✨ Suggest from TimeGuard'}
                    </button>
                  )}
                </div>
                <Textarea
                  id="description"
                  placeholder="Describe the task (optional, max 10 words)..."
                  value={formData.description}
                  onChange={(e) => {
                    const words = e.target.value.trim().split(/\s+/).filter(w => w.length > 0);
                    if (words.length <= 10) {
                      setFormData({ ...formData, description: e.target.value });
                      if (words.length === 10) {
                        playSound('wow');
                        // window.dispatchEvent(new CustomEvent('mascot:doll', { detail: { text: "Love the detail!", x: 80, y: 70 } }));
                      }
                    }
                  }}
                  className="tracker-form-input resize-none"
                  rows={3}
                  data-testid="input-description"
                />
                <p className="text-xs text-blue-400/60">
                  {formData.description.trim().split(/\s+/).filter(w => w.length > 0).length}/10 words
                </p>
              </div>

              <hr className="tracker-form-divider" />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startTime" className="text-blue-100 tracker-form-label">Start Time (IST) *</Label>
                  <div className="relative time-input-wrapper">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 task-form-time-icon" />
                    <Input
                      id="startTime"
                      type="time"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                      className="pl-10 tracker-form-input"
                      data-testid="input-start-time"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endTime" className="text-blue-100 tracker-form-label">End Time (IST) *</Label>
                  <div className="relative time-input-wrapper">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 task-form-time-icon" />
                    <Input
                      id="endTime"
                      type="time"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      className="pl-10 tracker-form-input"
                      data-testid="input-end-time"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="percentage" className="text-blue-100 tracker-form-label">Completion % *</Label>
                  <div className="flex items-center space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFormData({ ...formData, percentageComplete: Math.max(0, formData.percentageComplete - 10) })}
                      className="bg-slate-700/50 border-blue-500/20 text-white hover:bg-slate-600/50 tracker-form-input"
                      data-testid="btn-decrease-percentage"
                    >
                      -
                    </Button>
                    <Input
                      id="percentage"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.percentageComplete}
                      onChange={(e) => {
                        const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                        setFormData({ ...formData, percentageComplete: val });
                        if (val === 100) {
                          playSound('hurray');
                          // window.dispatchEvent(new CustomEvent('mascot:doll', { detail: { text: "Hurray! 100%!", x: 50, y: 20 } }));
                        }
                      }}
                      className="text-center tracker-form-input"
                      data-testid="input-percentage"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFormData({ ...formData, percentageComplete: Math.min(100, formData.percentageComplete + 10) })}
                      className="bg-slate-700/50 border-blue-500/20 text-white hover:bg-slate-600/50 tracker-form-input"
                      data-testid="btn-increase-percentage"
                    >
                      +
                    </Button>
                  </div>
                </div>
              </div>

              <hr className="tracker-form-divider" />

              <div className="space-y-2">
                <Label className="text-blue-100 tracker-form-label">Tools Used</Label>
                <Command className="bg-slate-700/30 border border-blue-500/10 rounded-md tracker-tools-command">
                  <CommandInput
                    placeholder="Search tools..."
                    value={toolSearch}
                    onValueChange={setToolSearch}
                    className="bg-transparent border-none text-white placeholder:text-slate-400"
                    data-testid="input-tool-search"
                  />
                  <CommandList className="max-h-40">
                    <CommandEmpty className="text-slate-400 p-2">No tools found.</CommandEmpty>
                    <CommandGroup>
                      {TOOLS_LIST.filter(tool =>
                        tool.toLowerCase().includes(toolSearch.toLowerCase())
                      ).map(tool => (
                        <CommandItem
                          key={tool}
                          onSelect={() => { toggleTool(tool); setToolSearch(''); }}
                          className={`cursor-pointer ${formData.toolsUsed.includes(tool)
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'text-slate-300 hover:bg-slate-600/50'
                            }`}
                          data-testid={`command-tool-${tool.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          <Check className={`w-4 h-4 mr-2 ${formData.toolsUsed.includes(tool) ? 'opacity-100' : 'opacity-0'}`} />
                          {tool}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
                {formData.toolsUsed.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.toolsUsed.map(tool => (
                      <Badge
                        key={tool}
                        variant="outline"
                        className="bg-blue-500/20 text-blue-300 border-blue-500/50"
                        onClick={() => toggleTool(tool)}
                        data-testid={`badge-selected-tool-${tool.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {tool}
                        <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <hr className="tracker-form-divider" />

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  className="border-slate-600 text-slate-300 tracker-btn-cancel"
                  data-testid="button-cancel"
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-blue-600 to-cyan-600 tracker-btn-save"
                  data-testid="button-save-task"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveButtonText || 'Save Task'}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Deviation Dialog */}
        <Dialog open={showDeviationDialog} onOpenChange={setShowDeviationDialog}>
          <DialogContent className="sm:max-w-[500px] bg-slate-900 border-slate-800 text-white p-6 shadow-2xl rounded-3xl">
            <DialogHeader className="mb-6">
              <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20 mb-4">
                <AlertCircle className="w-6 h-6 text-amber-500" />
              </div>
              <DialogTitle className="text-2xl font-black">Add Task Deviation</DialogTitle>
              <DialogDescription className="text-slate-400 font-medium pt-1">
                This task isn't in your initial plan. Adding it counts as a daily deviation.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-2">
              <div className="space-y-3">
                <Label className="text-slate-400 font-bold text-xs uppercase tracking-widest">Select Task from PMS *</Label>
                <Select
                  onValueChange={(v) => setSelectedDeviationTask(tasks.find(t => t.id === v))}
                >
                  <SelectTrigger className="bg-slate-950 border-slate-800 h-14 rounded-2xl focus:ring-amber-500/30">
                    <SelectValue placeholder="Search tasks for deviation..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[250px] bg-slate-900 border-slate-800 text-white">
                    {tasks.filter(t => !dailyPlan?.tasks.some((pt: any) => pt.taskId === t.id)).length > 0 ? (
                      tasks.filter(t => !dailyPlan?.tasks.some((pt: any) => pt.taskId === t.id)).map(task => (
                        <SelectItem key={task.id} value={task.id} className="hover:bg-slate-800 focus:bg-slate-800">{task.task_name}</SelectItem>
                      ))
                    ) : (
                      <div className="p-4 text-center text-xs text-slate-500 italic">All available tasks are already in your plan</div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label className="text-slate-400 font-bold text-xs uppercase tracking-widest">Reason for Deviation *</Label>
                <Textarea
                  placeholder="Why are you adding this task today? (Mandatory)"
                  value={deviationReason}
                  onChange={(e) => setDeviationReason(e.target.value)}
                  className="bg-slate-950 border-slate-800 min-h-[120px] rounded-2xl focus:ring-amber-500/30 text-white placeholder:text-slate-600"
                />
              </div>
            </div>

            <DialogFooter className="mt-8 flex gap-3">
              <Button variant="ghost" className="rounded-xl flex-1 h-12" onClick={() => setShowDeviationDialog(false)}>Cancel</Button>
              <Button
                disabled={addDeviationMutation.isPending || !selectedDeviationTask || !deviationReason}
                onClick={handleAddDeviation}
                className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-black rounded-xl flex-[2] h-12 shadow-lg shadow-amber-900/20"
              >
                {addDeviationMutation.isPending ? 'ADDING...' : 'ADD TO PLAN'}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/* ✅ NEW – Activity Timeline side-tab panel.
   Renders TimeGuard's tracked activity as a chronological day-log — one row
   per continuous working stretch (listing every tool/site touched) or per
   idle gap — the same shape as a handwritten time-block log:
     10:00 – 11:00  →  Chrome — claude, supabase, etc
     11:00 – 11:15  →  15m idle
   Read-only; entirely independent from the Task Details form. */
function ActivityTimelinePanel({
  enabled,
  isFetching,
  timeline,
  aggregated,
}: {
  enabled: boolean;
  isFetching: boolean;
  timeline: Array<{
    type: 'activity' | 'idle';
    startTime: string;
    endTime: string;
    durationSeconds: number;
    tools: string[];
    matchStatus?: 'Matched' | 'Partial Match' | 'Unclassified';
    matchRatio?: number;
  }>;
  aggregated: Array<{
    appName: string;
    browserName: string | null;
    websiteUrl: string | null;
    totalDurationSeconds: number;
    sessionCount: number;
  }>;
}) {
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const formatDuration = (seconds: number) =>
    seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;

  const [showTotals, setShowTotals] = useState(true);

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-blue-100 tracker-form-label">
          Activity Timeline <span className="text-blue-400/60 text-xs">(auto-fetched from TimeGuard, read-only)</span>
        </Label>

        {!enabled ? (
          <p className="text-xs text-blue-300/60 italic mt-2" data-testid="text-actual-worked-tools-hint">
            Set the Timestrap start and end time to load TimeGuard's tracked activity for this session.
          </p>
        ) : isFetching ? (
          <p className="text-xs text-blue-300/60 mt-2" data-testid="text-actual-worked-tools-loading">
            Loading TimeGuard activity…
          </p>
        ) : timeline.length === 0 ? (
          <p className="text-xs text-blue-300/60 italic mt-2" data-testid="text-actual-worked-tools-empty">
            No TimeGuard activity recorded for this time period.
          </p>
        ) : (
          <div className="mt-3 space-y-2" data-testid="timeline-actual-worked-tools">
            {timeline.map((block, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 rounded-md border px-3 py-2 ${block.type === 'idle'
                  ? 'border-dashed border-slate-600/40 bg-slate-800/20'
                  : 'border-blue-500/20 bg-slate-700/30'
                  }`}
                data-testid={`timeline-block-${idx}`}
              >
                <div className="text-xs font-mono text-blue-300 whitespace-nowrap pt-0.5 min-w-[110px]">
                  {formatTime(block.startTime)} – {formatTime(block.endTime)}
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-blue-400/50 shrink-0 mt-0.5" />
                {block.type === 'idle' ? (
                  <div className="text-xs text-slate-400 italic">
                    {formatDuration(block.durationSeconds)} idle
                  </div>
                ) : (
                  <div className="text-xs text-blue-100 flex items-center gap-2 flex-wrap">
                    <span className="text-blue-200 font-medium">{block.tools.join(', ')}</span>
                    <span className="text-blue-400/60">({formatDuration(block.durationSeconds)})</span>
                    {block.matchStatus && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${block.matchStatus === 'Matched'
                          ? 'bg-green-500/15 text-green-400'
                          : block.matchStatus === 'Partial Match'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-slate-500/15 text-slate-400'
                          }`}
                        data-testid={`badge-match-status-${block.matchStatus.replace(' ', '-').toLowerCase()}`}
                      >
                        {block.matchStatus}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {aggregated.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTotals((v) => !v)}
            className="flex items-center gap-1.5 text-blue-100 tracker-form-label hover:text-blue-300 transition-colors"
            data-testid="toggle-totals-by-app-site"
          >
            <ChevronDown className={`w-4 h-4 text-blue-400/70 transition-transform ${showTotals ? '' : '-rotate-90'}`} />
            Totals by App / Site
          </button>
          {showTotals && (
            <div className="overflow-x-auto border border-blue-500/20 rounded-md mt-2" data-testid="table-actual-worked-tools">
              <Table>
                <TableHeader>
                  <TableRow className="border-blue-500/20 hover:bg-transparent">
                    <TableHead className="text-blue-300">Application/Tool</TableHead>
                    <TableHead className="text-blue-300">Browser</TableHead>
                    <TableHead className="text-blue-300">Website URL</TableHead>
                    <TableHead className="text-blue-300">Sessions</TableHead>
                    <TableHead className="text-blue-300">Total Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregated.map((group, idx) => (
                    <TableRow key={idx} className="border-blue-500/10">
                      <TableCell className="text-blue-100 text-xs">{group.browserName ? '-' : group.appName}</TableCell>
                      <TableCell className="text-blue-100 text-xs">{group.browserName || '-'}</TableCell>
                      <TableCell className="text-blue-100 text-xs max-w-[200px] truncate" title={group.websiteUrl || ''}>{group.websiteUrl || '-'}</TableCell>
                      <TableCell className="text-blue-100 text-xs whitespace-nowrap">{group.sessionCount}</TableCell>
                      <TableCell className="text-blue-100 text-xs whitespace-nowrap">{formatDuration(group.totalDurationSeconds)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}