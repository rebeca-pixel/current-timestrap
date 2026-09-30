import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import TaskForm from '@/components/TaskForm';
import {
  Search,
  Filter,
  RefreshCw,
  Clock,
  User as UserIcon,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Calendar as CalendarIcon,
  Loader2,
  AlertCircle,
  X,
  MoreVertical,
  RotateCcw,
  Edit,
  Trash2
} from 'lucide-react';
import { User } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TimeEntry, Employee } from '@shared/schema';
import { format } from 'date-fns';

interface RejectionsPageProps {
  user: User;
}

export default function RejectionsPage({ user }: RejectionsPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [specificDate, setSpecificDate] = useState<Date | undefined>(undefined);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  // Determine if user is an employee (can only see their own reports)
  const isEmployee = user.role === 'employee';

  // Use different endpoint based on role
  const { data: timeEntries = [], isLoading, refetch } = useQuery<TimeEntry[]>({
    queryKey: isEmployee ? ['/api/time-entries/employee', user.id] : ['/api/time-entries'],
    refetchInterval: 5000,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['/api/employees'],
  });

  const getApproverName = (approverId: string | null) => {
    if (!approverId) return 'N/A';
    const approver = employees.find(e => e.id === approverId);
    return approver ? approver.name : approverId;
  };

  const handleReopen = async (entryId: string) => {
    try {
      await apiRequest('PATCH', `/api/time-entries/${entryId}/reopen`);
      queryClient.invalidateQueries({ queryKey: isEmployee ? ['/api/time-entries/employee', user.id] : ['/api/time-entries'] });
      toast({
        title: "Entry Reopened",
        description: "Status reset to pending.",
      });
    } catch (error) {
      toast({ title: "Error", description: "Failed to reopen entry.", variant: "destructive" });
    }
  };

  const handleDelete = async (entryId: string) => {
    try {
      await apiRequest('DELETE', `/api/time-entries/${entryId}`);
      queryClient.invalidateQueries({ queryKey: isEmployee ? ['/api/time-entries/employee', user.id] : ['/api/time-entries'] });
      toast({
        title: "Entry Deleted",
        description: "Timesheet entry has been removed.",
      });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete entry.", variant: "destructive" });
    }
  };

  const filteredEntries = timeEntries.filter(entry => {
    // ONLY show rejected and resubmitted items
    if (entry.status !== 'rejected' && entry.status !== 'resubmitted') return false;

    const matchesSearch =
      entry.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.employeeCode.toLowerCase().includes(searchQuery.toLowerCase());

    // For status filter, 'all' on this page means 'rejected' + 'resubmitted'
    const matchesStatus = statusFilter === 'all' || entry.status === statusFilter;

    let matchesDate = true;

    // If specific date is selected, use it
    if (specificDate) {
      matchesDate = entry.date === format(specificDate, 'yyyy-MM-dd');
    } else if (dateFilter !== 'all') {
      const today = new Date();
      const entryDate = new Date(entry.date);

      if (dateFilter === 'today') {
        matchesDate = entry.date === format(today, 'yyyy-MM-dd');
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        matchesDate = entryDate >= weekAgo;
      } else if (dateFilter === 'month') {
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        matchesDate = entryDate >= monthAgo;
      }
    }

    return matchesSearch && matchesStatus && matchesDate;
  });

  const employeeGroups = filteredEntries.reduce((acc, entry) => {
    if (!acc[entry.employeeId]) {
      acc[entry.employeeId] = {
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        employeeCode: entry.employeeCode,
        entries: [],
      };
    }
    acc[entry.employeeId].entries.push(entry);
    return acc;
  }, {} as Record<string, { employeeId: string; employeeName: string; employeeCode: string; entries: TimeEntry[] }>);

  const employeeList = Object.values(employeeGroups).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>;
      case 'resubmitted':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 animate-pulse">Resubmitted</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const totalRejected = filteredEntries.filter(e => e.status === 'rejected').length;
  const totalResubmitted = filteredEntries.filter(e => e.status === 'resubmitted').length;

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="rejections-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            {isEmployee ? 'My Rejections' : 'Timesheet Rejections'}
          </h1>
          <p className="text-blue-200/60 text-sm">
            {isEmployee
              ? 'View your rejected timesheet entries and their feedback'
              : 'Review rejected entries and monitor resubmission status across the team'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="bg-slate-800 border-blue-500/20 text-white"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-800/50 border-blue-500/20 p-4 rejection-stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <AlertCircle className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Total Action Items</p>
              <p className="text-2xl font-bold text-blue-400">{filteredEntries.length}</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-red-500/20 p-4 rejection-stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20">
              <X className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Active Rejections</p>
              <p className="text-2xl font-bold text-red-400">{totalRejected}</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-orange-500/20 p-4 rejection-stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <Clock className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Resubmitted</p>
              <p className="text-2xl font-bold text-orange-400">{totalResubmitted}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="bg-slate-800/50 border-blue-500/20 p-4 rejection-filter-bar">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 w-full md:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
              <Input
                placeholder="Search by name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-700/50 border-blue-500/20 text-white"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40 bg-slate-700/50 border-blue-500/20 text-white">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Rejections</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="resubmitted">Resubmitted</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateFilter} onValueChange={(v) => { setDateFilter(v); if (v !== 'all') setSpecificDate(undefined); }}>
              <SelectTrigger className="w-full sm:w-40 bg-slate-700/50 border-blue-500/20 text-white">
                <CalendarIcon className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Date Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={`w-full sm:w-auto bg-slate-700/50 border-blue-500/20 text-white ${specificDate ? 'border-blue-400' : ''}`}
                >
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {specificDate ? format(specificDate, 'MMM d, yyyy') : 'Select Date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-slate-800 border-blue-500/20" align="end">
                <CalendarComponent
                  mode="single"
                  selected={specificDate}
                  onSelect={(date) => {
                    setSpecificDate(date);
                    if (date) setDateFilter('all');
                  }}
                  className="rounded-md"
                />
                {specificDate && (
                  <div className="p-2 border-t border-blue-500/20">
                    <Button size="sm" variant="ghost" className="w-full text-blue-300" onClick={() => setSpecificDate(undefined)}>
                      Clear Date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        </div>
      ) : employeeList.length === 0 ? (
        <Card className="bg-slate-800/50 border-blue-500/20 p-12 text-center">
          <FileSpreadsheet className="w-12 h-12 text-blue-400/40 mx-auto mb-4" />
          <p className="text-blue-200/60">No rejection records found.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {employeeList.map(group => {
            const isExpanded = expandedEmployee === group.employeeId;
            const rejectedCount = group.entries.filter(e => e.status === 'rejected').length;
            const resubmittedCount = group.entries.filter(e => e.status === 'resubmitted').length;

            return (
              <Card key={group.employeeId} className="bg-slate-800/50 border-blue-500/20 overflow-hidden rejection-employee-card">
                <div
                  className="p-4 cursor-pointer hover:bg-slate-700/30 transition-colors"
                  onClick={() => setExpandedEmployee(isExpanded ? null : group.employeeId)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                        <UserIcon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{group.employeeName}</p>
                        <p className="text-sm text-blue-200/60">{group.employeeCode}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex gap-2">
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                          {rejectedCount} Rejected
                        </Badge>
                        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                          {resubmittedCount} Resubmitted
                        </Badge>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-blue-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-blue-400" />
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-blue-500/20 p-4 space-y-3">
                    {group.entries.map(entry => (
                      <div key={entry.id} className="bg-slate-700/30 rounded-lg p-4 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              {getStatusBadge(entry.status || 'rejected')}
                              <span className="text-sm font-medium text-blue-200/80">{entry.date}</span>
                            </div>
                            <h3 className="text-base text-white font-bold tracking-tight mb-1">{entry.projectName}</h3>
                            <p className="text-sm text-blue-100 font-medium leading-relaxed">{entry.taskDescription}</p>
                          </div>

                          {/* Action Dropdown Menu */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-9 w-9 bg-slate-800/80 text-blue-400 hover:text-white hover:bg-blue-500/30 border border-blue-500/20 shadow-sm flex-shrink-0">
                                <MoreVertical className="w-5 h-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 bg-slate-800 border-blue-500/20 shadow-xl">
                              <DropdownMenuItem className="text-blue-100 focus:bg-blue-500/20 cursor-pointer py-2" onClick={() => setEditingEntry(entry)}>
                                <Edit className="w-4 h-4 mr-2 text-blue-400" />
                                Edit & Resubmit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-blue-100 focus:bg-blue-500/20 cursor-pointer py-2" onClick={() => handleReopen(entry.id.toString())}>
                                <RotateCcw className="w-4 h-4 mr-2 text-yellow-400" />
                                Reopen as Pending
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-red-400 focus:bg-red-500/20 focus:text-red-300 cursor-pointer py-2" onClick={() => handleDelete(entry.id.toString())}>
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete Action
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-blue-200/60 block">Start Time</span>
                            <span className="text-white">{entry.startTime}</span>
                          </div>
                          <div>
                            <span className="text-blue-200/60 block">End Time</span>
                            <span className="text-white">{entry.endTime}</span>
                          </div>
                          <div>
                            <span className="text-blue-200/60 block">Duration</span>
                            <span className="text-white">{entry.totalHours}</span>
                          </div>
                          <div>
                            <span className="text-blue-200/60 block">Completion</span>
                            <span className="text-white">{entry.percentageComplete ?? 0}%</span>
                          </div>
                        </div>

                        {entry.status === 'rejected' && (
                          <div className="bg-red-500/10 rounded p-3 space-y-2">
                            <p className="text-sm text-red-400 font-medium">Rejection Reason</p>
                            <p className="text-xs text-blue-200/80">
                              {entry.rejectionReason || 'No specific reason provided.'}
                            </p>
                            {entry.approvedBy && (
                              <p className="text-xs text-red-300/60 mt-1">
                                Rejected by: {getApproverName(entry.approvedBy)}
                                {entry.approvedAt && ` on ${format(new Date(entry.approvedAt), 'MMM d, yyyy HH:mm')}`}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="text-xs text-blue-200/40 pt-2 border-t border-slate-700/50">
                          Submitted: {entry.submittedAt ? format(new Date(entry.submittedAt), 'MMM d, yyyy HH:mm') : 'N/A'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit & Resubmit Dialog */}
      <Dialog open={!!editingEntry} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <DialogContent className="max-w-4xl bg-slate-900 border-blue-500/20 max-h-[90vh] overflow-y-auto p-6 md:p-8">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-2xl font-bold text-white tracking-tight">Edit & Resubmit Time Entry</DialogTitle>
            <DialogDescription className="text-blue-200/60 mt-1">
              Update the details of your requested timesheet entry to reflect the necessary changes.
            </DialogDescription>
          </DialogHeader>

          {editingEntry && (() => {
            const parts = editingEntry.taskDescription.split(' | ');
            let parsed = { title: '', subTask: '', description: '' };
            if (parts.length >= 2) {
              parsed = { title: parts[0], subTask: parts[1], description: parts.slice(2).join(' | ') };
            } else {
              const colonParts = editingEntry.taskDescription.split(':');
              parsed = { title: colonParts[0] || editingEntry.taskDescription, subTask: '', description: colonParts[1]?.trim() || '' };
            }

            const durationMatch = editingEntry.totalHours ? editingEntry.totalHours.match(/(\d+)h\s*(\d+)m?/) : null;
            const durationMinutes = durationMatch ? parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2] || '0') : 0;

            const taskToEdit = {
              id: editingEntry.id.toString(),
              project: editingEntry.projectName,
              title: parsed.title,
              subTask: parsed.subTask,
              keyStep: (editingEntry as any).keyStep || '',
              description: parsed.description,
              problemAndIssues: (editingEntry as any).problemAndIssues || '',
              quantify: (editingEntry as any).quantify || '',
              achievements: (editingEntry as any).achievements || '',
              scopeOfImprovements: (editingEntry as any).scopeOfImprovements || '',
              toolsUsed: (editingEntry as any).toolsUsed || [],
              startTime: editingEntry.startTime,
              endTime: editingEntry.endTime,
              percentageComplete: editingEntry.percentageComplete ?? 0,
              durationMinutes: durationMinutes,
              pmsId: editingEntry.pmsId || undefined,
              pmsSubtaskId: editingEntry.pmsSubtaskId || undefined,
            };

            return (
              <TaskForm
                task={taskToEdit}
                saveButtonText="Resubmit"
                onSave={async (taskData) => {
                  try {
                    const startParts = taskData.startTime.split(':').map(Number);
                    const endParts = taskData.endTime.split(':').map(Number);
                    const durationInMins = (endParts[0] * 60 + endParts[1]) - (startParts[0] * 60 + startParts[1]);

                    const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
                    const formatTaskDescription = (t: any) => {
                      let desc = t.title;
                      if (t.subTask) desc += ' | ' + t.subTask;
                      else desc += ' | ';
                      if (t.description) desc += ' | ' + t.description;
                      return desc;
                    };

                    await apiRequest('PATCH', `/api/time-entries/${editingEntry.id}/resubmit`, {
                      projectName: taskData.project,
                      taskDescription: formatTaskDescription(taskData),
                      problemAndIssues: taskData.problemAndIssues || '',
                      quantify: taskData.quantify || '',
                      achievements: taskData.achievements || '',
                      scopeOfImprovements: taskData.scopeOfImprovements || '',
                      toolsUsed: taskData.toolsUsed || [],
                      startTime: taskData.startTime,
                      endTime: taskData.endTime,
                      totalHours: formatDuration(durationInMins),
                      percentageComplete: taskData.percentageComplete || 0,
                    });

                    queryClient.invalidateQueries({ queryKey: isEmployee ? ['/api/time-entries/employee', user.id] : ['/api/time-entries'] });
                    toast({ title: "Resubmitted Successfully", description: "Your task has been updated and sent for manager approval." });
                    setEditingEntry(null);
                  } catch (e: any) {
                    let description = 'Failed to resubmit entry. Please try again.';
                    try {
                      const raw = e?.message || '';
                      const jsonStr = raw.substring(raw.indexOf('{'));
                      if (jsonStr) {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed?.error) description = parsed.error;
                      }
                    } catch { }
                    toast({ title: 'Error Resubmitting', description, variant: 'destructive' });
                  }
                }}
                onCancel={() => setEditingEntry(null)}
                user={{ role: user.role, employeeCode: user.employeeCode, department: (user as any).department }}
                date={editingEntry.date}
              />
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
