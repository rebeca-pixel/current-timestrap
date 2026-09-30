import React from 'react';
import { useLocation, useParams } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import TaskForm from '@/components/TaskForm';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/card';
import { Loader2, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Task } from '@/components/TaskTable';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

// TaskForm's onSave hands back a task that may not have an id yet (new,
// not-yet-created tasks don't get one until the server assigns it) — so
// handleSave below accepts that shape rather than TaskTable's Task, which
// requires id for tasks already known to exist.
type SavedTask = Omit<Task, 'id'> & { id?: string };

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
};

const formatTaskDescription = (task: any) => {
  let desc = task.title;
  if (task.subTask) desc += ' | ' + task.subTask;
  else desc += ' | ';
  if (task.description) desc += ' | ' + task.description;
  return desc;
};

// Pulls the server's JSON error message (e.g. a tool-validation failure)
// out of the Error thrown by apiRequest, falling back to a generic message.
const extractServerErrorMessage = (error: any, fallback: string): string => {
  try {
    const raw = error?.message || '';
    const jsonStr = raw.substring(raw.indexOf('{'));
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (parsed?.error) return typeof parsed.error === 'string' ? parsed.error : fallback;
    }
  } catch { }
  return fallback;
};

// Parse task description that may contain task and subtask
const parseTaskDescription = (taskDesc: string) => {
  const parts = taskDesc.split(' | ');
  if (parts.length >= 2) {
    return { title: parts[0], subTask: parts[1], description: parts.slice(2).join(' | ') };
  }
  const colonParts = taskDesc.split(':');
  return { title: colonParts[0] || taskDesc, subTask: '', description: colonParts[1]?.trim() || '' };
};

const parseDuration = (duration: string): number => {
  const match = duration.match(/(\d+)h\s*(\d+)m?/);
  if (match) {
    return parseInt(match[1]) * 60 + parseInt(match[2] || '0');
  }
  return 0;
};

export default function TaskEntryPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  // Get date from URL or use today
  const searchParams = new URLSearchParams(window.location.search);
  const dateParam = searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');

  // Fetch the employee's time entries to find the one we're editing
  const { data: timeEntries = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/time-entries/employee', user?.id],
    enabled: !!user?.id && !!id,
  });

  const rawTask = id ? timeEntries.find((t) => t.id === id || t.id.toString() === id) : undefined;

  let task: Task | undefined = undefined;
  if (rawTask) {
    const parsed = parseTaskDescription(rawTask.taskDescription);
    task = {
      id: rawTask.id,
      project: rawTask.projectName,
      title: parsed.title,
      subTask: parsed.subTask,
      description: parsed.description,
      problemAndIssues: rawTask.problemAndIssues || '',
      quantify: rawTask.quantify || '',
      achievements: rawTask.achievements || '',
      scopeOfImprovements: rawTask.scopeOfImprovements || '',
      toolsUsed: rawTask.toolsUsed || [],
      startTime: rawTask.startTime,
      endTime: rawTask.endTime,
      durationMinutes: parseDuration(rawTask.totalHours),
      percentageComplete: rawTask.percentageComplete ?? 0,
      pmsId: rawTask.pmsId || undefined,
      pmsSubtaskId: rawTask.pmsSubtaskId || undefined,
      keyStep: rawTask.keyStep || undefined,
    } as Task;
  }

  const updateMutation = useMutation({
    mutationFn: async (taskData: SavedTask) => {
      const response = await apiRequest('PUT', `/api/time-entries/${id}`, {
        projectName: taskData.project,
        taskDescription: formatTaskDescription(taskData),
        problemAndIssues: (taskData as any).problemAndIssues || '',
        quantify: (taskData as any).quantify || '',
        achievements: (taskData as any).achievements || '',
        scopeOfImprovements: (taskData as any).scopeOfImprovements || '',
        toolsUsed: taskData.toolsUsed || [],
        startTime: taskData.startTime,
        endTime: taskData.endTime,
        totalHours: formatDuration(taskData.durationMinutes),
        percentageComplete: taskData.percentageComplete,
        pmsId: (taskData as any).pmsId,
        pmsSubtaskId: (taskData as any).pmsSubtaskId,
        keyStep: (taskData as any).keyStep,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/employee', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      toast({ title: 'Task Updated', description: 'Your task has been updated successfully.' });
      setLocation(`/tracker?date=${dateParam}`);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: extractServerErrorMessage(error, 'Failed to update task. Only pending tasks can be edited.'),
        variant: 'destructive',
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (taskData: SavedTask) => {
      const response = await apiRequest('POST', '/api/time-entries', {
        employeeId: user?.id,
        employeeCode: (user as any)?.employeeCode,
        employeeName: (user as any)?.name,
        date: dateParam,
        projectName: taskData.project,
        taskDescription: formatTaskDescription(taskData),
        problemAndIssues: (taskData as any).problemAndIssues || '',
        quantify: (taskData as any).quantify || '',
        achievements: (taskData as any).achievements || '',
        scopeOfImprovements: (taskData as any).scopeOfImprovements || '',
        toolsUsed: taskData.toolsUsed || [],
        startTime: taskData.startTime,
        endTime: taskData.endTime,
        totalHours: formatDuration(taskData.durationMinutes),
        percentageComplete: taskData.percentageComplete,
        pmsId: (taskData as any).pmsId,
        pmsSubtaskId: (taskData as any).pmsSubtaskId,
        keyStep: (taskData as any).keyStep,
        // NOTE: intentionally 'draft', not 'pending'. A task only becomes
        // 'pending' when the employee does Final Submit for the day (which
        // creates the daily submission record and sends the summary email).
        // Saving directly as 'pending' here made freshly-added tasks look
        // already-submitted (locking editing) even though no submission had
        // actually happened.
        status: 'draft',
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/employee', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      toast({ title: 'Task Saved', description: 'Your task has been logged successfully.' });
      setLocation(`/tracker?date=${dateParam}`);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: extractServerErrorMessage(error, 'Failed to save task. Please try again.'),
        variant: 'destructive',
      });
    },
  });

  const handleSave = (taskData: SavedTask) => {
    if (id) {
      updateMutation.mutate(taskData);
    } else {
      createMutation.mutate(taskData);
    }
  };

  const handleCancel = () => {
    setLocation(`/tracker?date=${dateParam}`);
  };

  // If we have an ID but data is still loading
  if (id && isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center bg-[#0B1120]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white p-6 relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />

      <div className="max-w-4xl mx-auto relative z-10 pt-4">
        <Button
          variant="ghost"
          onClick={handleCancel}
          className="mb-6 text-slate-400 hover:text-white hover:bg-white/5 transition-all"
        >
          <ChevronLeft className="w-4 h-4 mr-2" />
          Back to Tracker
        </Button>

        <Card className="bg-slate-900/60 backdrop-blur-xl border-white/5 p-6 md:p-8 shadow-2xl rounded-2xl">
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
                {id ? 'Edit Timesheet Entry' : 'New Timesheet Entry'}
              </h1>
              <p className="text-slate-400 mt-1 text-sm">
                {id ? 'Update your previously logged task details.' : 'Log a new task for your timesheet.'}
              </p>
            </div>
            <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold rounded-full">
              {format(new Date(dateParam), 'EEEE, MMMM d, yyyy')}
            </div>
          </div>

          <TaskForm
            task={task as any}
            date={dateParam}
            user={user as any}
            onSave={handleSave}
            onCancel={handleCancel}
            saveButtonText={id ? "Update Entry" : "Save Entry"}
          />
        </Card>
      </div>
    </div>
  );
}