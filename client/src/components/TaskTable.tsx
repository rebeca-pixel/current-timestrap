import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Edit2, Trash2, Check, Clock, MoreHorizontal, RotateCcw, SendHorizontal } from 'lucide-react';
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
}

export default function TaskTable({ tasks, onEdit, onDelete, onComplete, onReopen, onResubmit }: TaskTableProps) {
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
              <TableRow
                key={task.id}
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
                  ) : (
                    <span className="text-slate-500 text-xs">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}