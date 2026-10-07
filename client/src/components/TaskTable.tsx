import { Fragment, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { TOOLS_LIST } from '@shared/toolCategories';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Edit2, Trash2, Check, Clock, MoreHorizontal, RotateCcw, SendHorizontal, Zap, X, Loader2, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface Task {
  id: string;
  pmsId?: string;
  pmsSubtaskId?: string;
  project: string;
  title: string;
  subTask?: string;
  description: string;
  problemAndIssues: string;
  quantify: string;
  achievements: string;
  scopeOfImprovements: string;
  toolsUsed: string[];
  startTime: string;
  endTime: string;
  durationMinutes: number;
  percentageComplete: number;
  isComplete: boolean;
  serverStatus?: 'draft' | 'pending' | 'manager_approved' | 'approved' | 'rejected' | 'resubmitted';
  date?: string;
  rejectionReason?: string;
  keyStep?: string;
}

interface TaskTableProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onComplete: (taskId: string) => void;
  onReopen?: (task: Task) => void;
  onResubmit?: (task: Task) => void;
  // Quick Fill: save Quantify + Progress straight from the table row (no full form).
  onQuickSave?: (task: Task, values: { quantify: string; percentageComplete: number; startTime: string; endTime: string; toolsUsed: string[]; subTask?: string; pmsSubtaskId?: string }) => Promise<void>;
}

export default function TaskTable({ tasks, onEdit, onDelete, onComplete, onReopen, onResubmit, onQuickSave }: TaskTableProps) {
  // --- Quick Fill (inline edit) state ---
  const { user: authUser } = useAuth();
  const [quickSubtasks, setQuickSubtasks] = useState<{ id: string; title: string }[]>([]);
  const [quickSubTask, setQuickSubTask] = useState('');
  const [quickSubtaskId, setQuickSubtaskId] = useState<string | undefined>(undefined);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [quickQuantify, setQuickQuantify] = useState('');
  const [quickProgress, setQuickProgress] = useState(0);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickStart, setQuickStart] = useState('');
  const [quickEnd, setQuickEnd] = useState('');
  const [quickTools, setQuickTools] = useState<string[]>([]);
  const [quickToolSearch, setQuickToolSearch] = useState('');
  const toggleQuickTool = (tool: string) =>
    setQuickTools(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]);
  const quickSubtaskOk = quickSubtasks.length === 0 || !!quickSubTask;
  const quickTimeValid = !!quickStart && !!quickEnd && quickEnd > quickStart;

  const openQuickFill = (task: Task) => {
    setQuickId(task.id);
    setQuickQuantify(task.quantify || '');
    setQuickProgress(task.percentageComplete || 0);
    setQuickStart(task.startTime || '');
    setQuickEnd(task.endTime || '');
    setQuickTools(task.toolsUsed || []);
    setQuickToolSearch('');
    setQuickSubTask(task.subTask || '');
    setQuickSubtaskId(task.pmsSubtaskId);
  };
  useEffect(() => {
    const t = tasks.find(x => x.id === quickId);
    setQuickSubtasks([]);
    if (!t || !t.pmsId) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.append('taskId', t.pmsId as string);
        if (authUser?.department) params.append('userDepartment', authUser.department);
        if (authUser?.employeeCode) params.append('userEmpCode', authUser.employeeCode);
        const res = await fetch(`/api/subtasks?${params.toString()}`);
        const json = await res.json();
        if (!cancelled && Array.isArray(json)) setQuickSubtasks(json);
      } catch { /* no subtasks -> field stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [quickId]);
  const closeQuickFill = () => { setQuickId(null); setQuickSaving(false); };
  const saveQuickFill = async (task: Task) => {
    if (!onQuickSave) return;
    setQuickSaving(true);
    try {
      await onQuickSave(task, { quantify: quickQuantify.trim(), percentageComplete: quickProgress, startTime: quickStart, endTime: quickEnd, toolsUsed: quickTools, subTask: quickSubTask, pmsSubtaskId: quickSubtaskId });
      closeQuickFill();
    } catch {
      setQuickSaving(false); // parent shows the error toast; keep the row open
    }
  };
  const canQuickFill = (task: Task) =>
    !!onQuickSave && (task.serverStatus === 'draft' || task.serverStatus === 'rejected' || task.serverStatus === 'pending');
  const needsFill = (task: Task) => !(task.quantify || '').trim() || !(task.percentageComplete > 0);

  const formatDuration = (minutes: number) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  };

  if (tasks.length === 0) {
    return (
      <Card className="bg-slate-800/50 border-blue-500/20 p-8">
        <div className="text-center">
          <Clock className="w-12 h-12 text-blue-400/50 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No tasks yet</h3>
          <p className="text-blue-200/60 text-sm">
            Click "Add Task" to start tracking your work
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden border-none animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/5 hover:bg-transparent bg-white/5">
              <TableHead className="text-blue-200/50 font-bold uppercase tracking-wider text-[10px] py-4">Project</TableHead>
              <TableHead className="text-blue-200/50 font-bold uppercase tracking-wider text-[10px] py-4">Title</TableHead>
              <TableHead className="text-blue-200/50 font-bold uppercase tracking-wider text-[10px] py-4">Status</TableHead>
              <TableHead className="text-blue-200/50 font-bold uppercase tracking-wider text-[10px] py-4">Time</TableHead>
              <TableHead className="text-blue-200/50 font-bold uppercase tracking-wider text-[10px] py-4">Duration</TableHead>
              <TableHead className="text-blue-200/50 font-bold uppercase tracking-wider text-[10px] py-4 hidden md:table-cell">Progress</TableHead>
              <TableHead className="text-blue-200/50 font-bold uppercase tracking-wider text-[10px] py-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <Fragment key={task.id}>
                <TableRow
                  className="border-white/5 hover:bg-white/5 transition-all duration-300 group"
                  data-testid={`row-task-${task.id}`}
                >
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-bold text-white text-sm">{task.project}</p>
                      {task.date && (
                        <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-white/5 text-blue-200/40 font-mono">
                          {task.date}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-white font-medium">{task.title}</p>
                      {task.subTask && (
                        <p className="text-sm text-blue-300">{task.subTask}</p>
                      )}
                      {task.keyStep && (
                        <p className="text-[10px] text-indigo-400 font-bold uppercase mt-0.5">Key Step: {task.keyStep}</p>
                      )}
                      {task.description && (
                        <p className="text-xs text-blue-200/50 truncate max-w-[200px]">
                          {task.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {task.serverStatus === 'draft' && (
                      <Badge className="bg-slate-500/10 text-slate-300 border-slate-500/20 px-2 py-0 rounded-md text-[10px] font-bold uppercase">Draft</Badge>
                    )}
                    {task.serverStatus === 'pending' && (
                      <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20 px-2 py-0 rounded-md text-[10px] font-bold uppercase">Pending</Badge>
                    )}
                    {task.serverStatus === 'manager_approved' && (
                      <Badge className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20 px-2 py-0 rounded-md text-[10px] font-bold uppercase">Manager Approved</Badge>
                    )}
                    {task.serverStatus === 'approved' && (
                      <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 px-2 py-0 rounded-md text-[10px] font-bold uppercase">Approved</Badge>
                    )}
                    {task.serverStatus === 'rejected' && (
                      <div className="flex flex-col gap-1">
                        <Badge className="bg-rose-500/10 text-rose-300 border-rose-500/20 px-2 py-0 rounded-md text-[10px] font-bold uppercase w-fit">Rejected</Badge>
                        <span className="text-[9px] text-rose-400 font-bold uppercase tracking-tighter animate-pulse">Needs Rectification</span>
                        {task.rejectionReason && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" className="p-0 h-auto text-[10px] text-rose-400/80 hover:text-rose-400 underline decoration-rose-400/30 flex items-center justify-start h-5 px-1">
                                View Reason
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="bg-slate-900 border-rose-500/20 text-blue-100 p-3 w-64 shadow-2xl">
                              <h4 className="text-[10px] font-bold text-rose-400 uppercase mb-2">Rejection Reason</h4>
                              <p className="text-xs leading-relaxed">{task.rejectionReason}</p>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    )}
                    {task.serverStatus === 'resubmitted' && (
                      <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20 px-2 py-0 rounded-md text-[10px] font-bold uppercase">Resubmitted</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <span className="text-blue-200">{task.startTime}</span>
                      <span className="text-slate-500 mx-1">-</span>
                      <span className="text-blue-200">{task.endTime}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-slate-700 text-white">
                      {formatDuration(task.durationMinutes)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <Progress
                        value={task.percentageComplete}
                        className="h-1.5 bg-white/5"
                      />
                      <span className="text-[11px] font-mono text-blue-200/40 w-8">
                        {task.percentageComplete}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {(task.serverStatus === 'draft' || task.serverStatus === 'rejected' || task.serverStatus === 'pending') ? (
                      <div className="flex items-center justify-end gap-1">
                        {canQuickFill(task) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => (quickId === task.id ? closeQuickFill() : openQuickFill(task))}
                            className={`h-8 px-2 text-xs font-semibold ${needsFill(task) ? 'text-amber-300 hover:text-amber-200' : 'text-blue-300 hover:text-white'}`}
                            data-testid={`button-quickfill-${task.id}`}
                          >
                            <Zap className="w-3.5 h-3.5 mr-1" />
                            Quick Fill
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-slate-400 hover:text-white"
                              data-testid={`button-task-actions-${task.id}`}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-slate-800 border-blue-500/20">
                            <DropdownMenuItem
                              onClick={() => onEdit(task)}
                              className="text-blue-200 focus:bg-slate-700 focus:text-white"
                              data-testid={`button-edit-${task.id}`}
                            >
                              <Edit2 className="w-4 h-4 mr-2" />
                              {task.serverStatus === 'rejected' ? 'Reopen & Edit' : 'Edit'}
                            </DropdownMenuItem>

                            {task.serverStatus === 'rejected' && onResubmit && (
                              <DropdownMenuItem
                                onClick={() => onResubmit(task)}
                                className="text-emerald-400 focus:bg-slate-700 focus:text-emerald-300"
                              >
                                <SendHorizontal className="w-4 h-4 mr-2" />
                                Quick Resubmit
                              </DropdownMenuItem>
                            )}

                            {task.serverStatus === 'draft' && !task.isComplete && (
                              <DropdownMenuItem
                                onClick={() => onComplete(task.id)}
                                className="text-green-400 focus:bg-slate-700 focus:text-green-300"
                                data-testid={`button-complete-${task.id}`}
                              >
                                <Check className="w-4 h-4 mr-2" />
                                Mark Complete
                              </DropdownMenuItem>
                            )}
                            {(task.serverStatus === 'draft' || task.serverStatus === 'pending') && (
                              <DropdownMenuItem
                                onClick={() => onDelete(task.id)}
                                className="text-red-400 focus:bg-slate-700 focus:text-red-300"
                                data-testid={`button-delete-${task.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : (
                      <span className="text-slate-500 text-xs">-</span>
                    )}
                  </TableCell>
                </TableRow>
                {quickId === task.id && canQuickFill(task) && (
                  <TableRow className="border-white/5 bg-blue-500/5 hover:bg-blue-500/5" data-testid={`row-quickfill-${task.id}`}>
                    <TableCell colSpan={7}>
                      <div className="py-1">
                        <div className="flex flex-wrap items-end gap-3">
                          {quickSubtasks.length > 0 && (
                            <div className="space-y-1 w-56">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-blue-200/60">Sub Task *</label>
                              <Select
                                value={quickSubTask}
                                onValueChange={(v) => {
                                  setQuickSubTask(v);
                                  setQuickSubtaskId(quickSubtasks.find(x => x.title === v)?.id);
                                }}
                              >
                                <SelectTrigger className="h-9 bg-slate-900/60 border-blue-500/20 text-white [&>span]:truncate" data-testid={`select-quick-subtask-${task.id}`}>
                                  <SelectValue placeholder="Select a sub task" />
                                </SelectTrigger>
                                <SelectContent>
                                  {quickSubTask && !quickSubtasks.find(x => x.title === quickSubTask) && (
                                    <SelectItem value={quickSubTask}>{quickSubTask}</SelectItem>
                                  )}
                                  {quickSubtasks.map(st => (
                                    <SelectItem key={st.id} value={st.title}>{st.title}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <div className="space-y-1 w-32">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-blue-200/60">Start *</label>
                            <Input type="time" value={quickStart} onChange={(e) => setQuickStart(e.target.value)}
                              className="h-9 px-2 bg-slate-900/60 border-blue-500/20 text-white" data-testid={`input-quick-start-${task.id}`} />
                          </div>
                          <div className="space-y-1 w-32">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-blue-200/60">End *</label>
                            <Input type="time" value={quickEnd} onChange={(e) => setQuickEnd(e.target.value)}
                              className="h-9 px-2 bg-slate-900/60 border-blue-500/20 text-white" data-testid={`input-quick-end-${task.id}`} />
                          </div>
                          <div className="space-y-1 w-24">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-blue-200/60">Progress % *</label>
                            <Input
                              type="number" min={0} max={100} value={quickProgress}
                              onChange={(e) => setQuickProgress(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                              placeholder="0-100"
                              onKeyDown={(e) => { if (e.key === 'Enter') saveQuickFill(task); if (e.key === 'Escape') closeQuickFill(); }}
                              className="h-9 px-2 text-center bg-slate-900/60 border-blue-500/20 text-white"
                              data-testid={`input-quick-progress-${task.id}`}
                            />
                          </div>
                          <div className="space-y-1 w-64 xl:w-80">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-blue-200/60">Quantify Your Result *</label>
                            <Input
                              autoFocus
                              value={quickQuantify}
                              onChange={(e) => setQuickQuantify(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveQuickFill(task); if (e.key === 'Escape') closeQuickFill(); }}
                              placeholder="e.g., 5 reports, 10 calls"
                              className="h-9 bg-slate-900/60 border-blue-500/20 text-white"
                              data-testid={`input-quick-quantify-${task.id}`}
                            />
                          </div>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="outline" size="sm"
                                className="h-9 bg-slate-900/60 border-blue-500/20 text-blue-200 hover:text-white"
                                data-testid={`button-quick-tools-${task.id}`}>
                                Tools Used{quickTools.length > 0 ? ` (${quickTools.length})` : ''}
                                <ChevronDown className="w-4 h-4 ml-2" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72 p-0 bg-slate-900 border-blue-500/20">
                              {quickTools.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 p-2 border-b border-blue-500/10 max-h-24 overflow-y-auto">
                                  {quickTools.map(tool => (
                                    <Badge key={tool} variant="outline" onClick={() => toggleQuickTool(tool)}
                                      className="cursor-pointer bg-blue-500/20 text-blue-300 border-blue-500/50">
                                      {tool}<X className="w-3 h-3 ml-1" />
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              <Command className="bg-transparent">
                                <CommandInput placeholder="Search tools..." value={quickToolSearch} onValueChange={setQuickToolSearch}
                                  className="bg-transparent border-none text-white placeholder:text-slate-400" />
                                <CommandList className="max-h-48">
                                  <CommandEmpty className="text-slate-400 p-2">No tools found.</CommandEmpty>
                                  <CommandGroup>
                                    {TOOLS_LIST.filter(t => t.toLowerCase().includes(quickToolSearch.toLowerCase())).map(tool => (
                                      <CommandItem key={tool} onSelect={() => { toggleQuickTool(tool); setQuickToolSearch(''); }}
                                        className={`cursor-pointer py-1 text-xs ${quickTools.includes(tool) ? 'bg-blue-500/20 text-blue-300' : 'text-slate-300'}`}>
                                        <Check className={`w-4 h-4 mr-2 ${quickTools.includes(tool) ? 'opacity-100' : 'opacity-0'}`} />
                                        {tool}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <div className="flex items-center gap-2 ml-auto">
                            <Button
                              type="button"
                              size="sm"
                              disabled={quickSaving || !quickQuantify.trim() || !(quickProgress > 0) || !quickTimeValid || !quickSubtaskOk}
                              onClick={() => saveQuickFill(task)}
                              className="h-9 bg-blue-600 hover:bg-blue-500 text-white"
                              data-testid={`button-quick-save-${task.id}`}
                            >
                              {quickSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                              Save
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={closeQuickFill} className="h-9 text-slate-400 hover:text-white">
                              <X className="w-4 h-4 mr-1" />Cancel
                            </Button>
                          </div>
                        </div>
                        {!quickTimeValid && <p className="text-xs text-rose-400 mt-1">End time must be after start time</p>}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}