import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Check, X, Search, Filter, RefreshCw, Clock, Loader2, Wrench, Target, Trophy, TrendingUp, AlertCircle, ChevronDown, ChevronUp, FileText, Calendar as CalendarIcon, CheckCircle2, ListFilter, PauseCircle, MessageSquare, Zap, HardHat, MapPin, Package, Users, Eye, ShieldCheck, Play, Download } from 'lucide-react';
import { User } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { TimeEntry, SiteReport } from '@shared/schema';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, parseISO, startOfDay, endOfDay, isWithinInterval, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import ActivityTimelinePanel from '@/components/ActivityTimelinePanel';
import { DEFAULT_VALIDATION_RULES, TIMESHEET_MIN_CHARS, type ValidationRules } from '@shared/timesheetValidation';
import { useValidationRules, VALIDATION_RULES_QUERY_KEY } from '@/hooks/useValidationRules';

interface ExtendedTimeEntry extends TimeEntry {
  lmsData?: {
    leaveHours: number;
    permissionHours: number;
    totalLMSHours: number;
  };
}

// Parse a plan task's scheduleData, which the API may return as a JSON string or an object
const parsePlanScheduleData = (t: any): any => {
  if (!t) return {};
  const raw = t.scheduleData;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
};

// Format a 24h "HH:mm" string as a friendly 12h time, e.g. "17:00" -> "5:00 PM"
const formatPlanTime12h = (time?: string | null): string | null => {
  if (!time) return null;
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

const parseTaskDescription = (taskDesc: string, entry?: ExtendedTimeEntry) => {
  const parts = taskDesc.split(' | ');
  let task = '';
  let subTask = '';
  let description = '';

  if (parts.length >= 3) {
    task = parts[0];
    subTask = parts[1];
    description = parts.slice(2).join(' | ');
  } else if (parts.length === 2) {
    task = parts[0];
    subTask = parts[1];
    description = '';
  } else if (parts.length === 1) {
    task = parts[0];
    subTask = '';
    description = '';
  } else {
    const colonParts = taskDesc.split(':');
    if (colonParts.length >= 2) {
      task = colonParts[0];
      subTask = '';
      description = colonParts.slice(1).join(':').trim();
    } else {
      task = taskDesc;
      subTask = '';
      description = '';
    }
  }

  return {
    task: task.trim(),
    subTask: subTask.trim(),
    description: description.trim(),
    achievements: entry?.achievements,
    quantify: entry?.quantify || "",
    problemAndIssues: entry?.problemAndIssues,
    scopeOfImprovements: entry?.scopeOfImprovements,
    toolsUsed: entry?.toolsUsed
  };
};

const TaskDetailRow = ({ label, value, icon: Icon, colorClass }: { label: string; value: string | null | undefined; icon: any; colorClass: string }) => (
  <div className={`p-3 rounded-lg border ${colorClass} bg-opacity-5`}>
    <span className={`font-bold uppercase text-[9px] block mb-2 flex items-center gap-1 ${colorClass.split(' ')[0].replace('border-', 'text-')}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
    <p className="text-blue-100/70 text-xs leading-relaxed whitespace-pre-wrap">{value || `No ${label.toLowerCase()} provided.`}</p>
  </div>
);

export default function ApprovalPage({ user }: { user: User }) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [bulkRejectDialogOpen, setBulkRejectDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ExtendedTimeEntry | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [onHoldReason, setOnHoldReason] = useState('');
  const [onHoldDialogOpen, setOnHoldDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [currentTab, setCurrentTab] = useState('timesheets');
  const [siteReportDetailOpen, setSiteReportDetailOpen] = useState(false);
  const [siteReportDetail, setSiteReportDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  // Helper to check if entry should be shown in approvals (exclude draft entries)
  const isApprovalEntry = (entry: ExtendedTimeEntry): boolean => {
    return entry.status !== 'draft';
  };

  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [showAllTime, setShowAllTime] = useState(false);
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const monthStart = useMemo(() => format(startOfMonth(viewMonth), 'yyyy-MM-dd'), [viewMonth]);
  const monthEnd = useMemo(() => format(endOfMonth(viewMonth), 'yyyy-MM-dd'), [viewMonth]);

  const { data: rawTimeEntriesData, isLoading, refetch } = useQuery<ExtendedTimeEntry[]>({
    queryKey: ['/api/time-entries/approvals', showAllTime ? 'all' : monthStart, showAllTime ? 'all' : monthEnd],
    queryFn: async () => {
      const params = showAllTime ? '' : `?startDate=${monthStart}&endDate=${monthEnd}`;
      const res = await apiRequest('GET', `/api/time-entries/approvals${params}`);
      return res.json();
    },
    enabled: currentTab === 'timesheets',
  });
  const rawTimeEntries = useMemo(() => rawTimeEntriesData || [], [rawTimeEntriesData]);

  const { data: rawSiteReports = [], isLoading: isSiteReportsLoading, refetch: refetchSiteReports } = useQuery<SiteReport[]>({
    queryKey: ['/api/site-reports'],
  });

  const siteReportsCount = useMemo(() => rawSiteReports.filter(r => r.status === 'pending').length, [rawSiteReports]);

  const { data: rawDailyPlans = [], isLoading: isPlansLoading, refetch: refetchPlans } = useQuery<any[]>({
    queryKey: ['/api/daily-plans/all'],
  });

  const pendingPlansCount = useMemo(() =>
    rawDailyPlans.filter(p => p.tasks.some((t: any) => t.isDeviation && t.status === 'pending')).length
    , [rawDailyPlans]);

  const approveSiteReportMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('PATCH', `/api/site-reports/${id}/status`, { status: 'approved' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/site-reports'] });
      toast({ title: "Site Report Approved" });
    },
  });

  const rejectSiteReportMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('PATCH', `/api/site-reports/${id}/status`, { status: 'rejected' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/site-reports'] });
      toast({ title: "Site Report Rejected", variant: "destructive" });
    },
  });

  const uniqueTimeEntries = useMemo(() => {
    const seen = new Set<string>();
    return rawTimeEntries
      .filter(e => isApprovalEntry(e)) // Exclude draft entries
      .filter(e => {
        const key = e.id.toString();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [rawTimeEntries]);

  // Status Summary Counts
  const stats = useMemo(() => {
    return uniqueTimeEntries.reduce((acc, entry) => {
      acc.total++;
      if (entry.status === 'pending' || entry.status === 'resubmitted') acc.pending++;
      else if (entry.status === 'manager_approved') acc.manager_approved++;
      else if (entry.status === 'approved') acc.approved++;
      else if (entry.status === 'rejected') acc.rejected++;
      else if (entry.status === 'on_hold') acc.on_hold++;
      return acc;
    }, { total: 0, pending: 0, manager_approved: 0, approved: 0, rejected: 0, on_hold: 0 });
  }, [uniqueTimeEntries]);

  const siteStats = useMemo(() => {
    return rawSiteReports.reduce((acc, report) => {
      acc.total++;
      if (report.status === 'pending') acc.pending++;
      else if (report.status === 'approved') acc.approved++;
      else if (report.status === 'rejected') acc.rejected++;
      return acc;
    }, { total: 0, pending: 0, approved: 0, rejected: 0 });
  }, [rawSiteReports]);

  const APPROVALS_KEY = '/api/time-entries/approvals';
  const invalidateAllTimeEntries = () =>
    queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/time-entries') });

  // Patch entries inside the cached approvals list so the screen updates instantly,
  // without downloading and re-enriching the whole list again.
  const patchApprovalEntries = (ids: string[], patch: Partial<ExtendedTimeEntry>) => {
    const idSet = new Set(ids);
    queryClient.setQueriesData<ExtendedTimeEntry[]>({ queryKey: [APPROVALS_KEY] }, (old) =>
      old ? old.map(e => (idSet.has(e.id.toString()) ? { ...e, ...patch } : e)) : old
    );
  };
  const snapshotApprovals = () => queryClient.getQueriesData<ExtendedTimeEntry[]>({ queryKey: [APPROVALS_KEY] });
  const restoreApprovals = (snapshot?: ReturnType<typeof snapshotApprovals>) =>
    snapshot?.forEach(([key, data]) => queryClient.setQueryData<ExtendedTimeEntry[]>(key, data));
  const startOptimistic = async (ids: string[], patch: Partial<ExtendedTimeEntry>) => {
    await queryClient.cancelQueries({ queryKey: [APPROVALS_KEY] });
    const snapshot = snapshotApprovals();
    patchApprovalEntries(ids, patch);
    return { snapshot };
  };

  useWebSocket({
    // New submissions: reload the list.
    time_entry_created: () => invalidateAllTimeEntries(),
    // Status changes: merge the changed entry into the list instead of reloading everything.
    time_entry_updated: (entry: any) => {
      if (!entry?.id) { invalidateAllTimeEntries(); return; }
      let found = false;
      queryClient.setQueriesData<ExtendedTimeEntry[]>({ queryKey: [APPROVALS_KEY] }, (old) => {
        if (!old) return old;
        return old.map(e => {
          if (e.id.toString() !== entry.id.toString()) return e;
          found = true;
          return { ...e, ...entry, keyStep: entry.keyStep || e.keyStep };
        });
      });
      // An entry we do not have yet (e.g. just submitted) needs a real reload.
      if (!found && entry.status && entry.status !== 'draft') {
        queryClient.invalidateQueries({ queryKey: [APPROVALS_KEY] });
      }
      queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string'
          && (q.queryKey[0] as string).startsWith('/api/time-entries')
          && q.queryKey[0] !== APPROVALS_KEY,
      });
    },
    site_report_created: () => queryClient.invalidateQueries({ queryKey: ['/api/site-reports'] }),
    site_report_updated: () => queryClient.invalidateQueries({ queryKey: ['/api/site-reports'] }),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('PATCH', `/api/time-entries/${id}/approve`, { approvedBy: user.id }),
    onMutate: (id: string) => startOptimistic([id], { status: 'approved' }),
    onError: (_err, _id, ctx) => {
      restoreApprovals(ctx?.snapshot);
      toast({ title: 'Approve failed', variant: 'destructive' });
    },
    onSuccess: () => toast({ title: "Approved" }),
  });

  const managerApproveMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('PATCH', `/api/time-entries/${id}/manager-approve`, { approvedBy: user.id }),
    onMutate: (id: string) => startOptimistic([id], { status: 'manager_approved' }),
    onError: (_err, _id, ctx) => {
      restoreApprovals(ctx?.snapshot);
      toast({ title: 'Manager approve failed', variant: 'destructive' });
    },
    onSuccess: () => toast({ title: "Manager Approved" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      apiRequest('PATCH', `/api/time-entries/${id}/reject`, { approvedBy: user.id, reason }),
    onMutate: ({ id, reason }: { id: string; reason: string }) =>
      startOptimistic([id], { status: 'rejected', rejectionReason: reason }),
    onError: (_err, _vars, ctx) => {
      restoreApprovals(ctx?.snapshot);
      toast({ title: 'Reject failed', variant: 'destructive' });
    },
    onSuccess: () => toast({ title: "Rejected", variant: "destructive" }),
  });

  const onHoldMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      apiRequest('PATCH', `/api/time-entries/${id}/on-hold`, { managerId: user.id, reason }),
    onMutate: ({ id, reason }: { id: string; reason: string }) =>
      startOptimistic([id], { status: 'on_hold', onHoldReason: reason }),
    onError: (_err, _vars, ctx) => {
      restoreApprovals(ctx?.snapshot);
      toast({ title: 'Could not put on hold', variant: 'destructive' });
    },
    onSuccess: () => toast({ title: "Put On Hold", variant: "default" }),
  });

  const updatePlanTaskMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: 'approved' | 'rejected' }) =>
      apiRequest('PATCH', `/api/daily-plans/tasks/${taskId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-plans/all'] });
      toast({ title: "Plan Task Updated" });
    },
  });

  const bulkApproveMutation = useMutation({
    // One request for the whole selection (the server sends one email per employee and day).
    mutationFn: async (ids: string[]) => {
      await apiRequest('POST', '/api/time-entries/bulk-approve', {
        ids,
        approvedBy: user.id,
        stage: user.role === 'admin' ? 'admin' : 'manager',
      });
    },
    onMutate: (ids: string[]) =>
      startOptimistic(ids, { status: user.role === 'admin' ? 'approved' : 'manager_approved' }),
    onError: (_err, _ids, ctx) => {
      restoreApprovals(ctx?.snapshot);
      toast({ title: 'Bulk approve failed', variant: 'destructive' });
    },
    onSuccess: (_data, ids) => {
      toast({ title: `Approved ${ids.length} entries` });
      setSelectedIds(new Set());
      setSelectAll(false);
    },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
      await apiRequest('POST', '/api/time-entries/bulk-reject', { ids, approvedBy: user.id, reason });
    },
    onMutate: ({ ids, reason }: { ids: string[]; reason: string }) =>
      startOptimistic(ids, { status: 'rejected', rejectionReason: reason }),
    onError: (_err, _vars, ctx) => {
      restoreApprovals(ctx?.snapshot);
      toast({ title: 'Bulk reject failed', variant: 'destructive' });
    },
    onSuccess: (_data, { ids }) => {
      toast({ title: `Rejected ${ids.length} entries`, variant: "destructive" });
      setSelectedIds(new Set());
      setSelectAll(false);
      setBulkRejectDialogOpen(false);
      setRejectionReason('');
    },
  });

  const filteredSubmissions = useMemo(() => {
    const filtered = uniqueTimeEntries.filter(s => {
      const matchesSearch = s.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.employeeCode.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      const matchesDate = !selectedDate || s.date === format(selectedDate, 'yyyy-MM-dd');
      return matchesSearch && matchesStatus && matchesDate;
    });

    // Sort by Date (latest first), then Employee (alphabetical), then Time (chronological)
    return filtered.sort((a, b) => {
      // 1. Date (most recent first)
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;

      // 2. Employee Name (A-Z)
      const nameCompare = a.employeeName.localeCompare(b.employeeName);
      if (nameCompare !== 0) return nameCompare;

      // 3. Start Time (chronological: 9:00 AM before 10:00 AM)
      // Note: Assumes HH:mm 24h format for string comparison stability
      return a.startTime.localeCompare(b.startTime);
    });
  }, [uniqueTimeEntries, searchQuery, statusFilter, selectedDate]);

  // Only render a page of cards at a time: hundreds of cards (each with its own LMS lookup) made the page crawl.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [searchQuery, statusFilter, selectedDate, monthStart, showAllTime]);
  const visibleSubmissions = useMemo(() => filteredSubmissions.slice(0, visibleCount), [filteredSubmissions, visibleCount]);
  const hiddenCount = Math.max(0, filteredSubmissions.length - visibleCount);

  const confirmReject = () => {
    if (selectedEntry && rejectionReason.trim()) {
      rejectMutation.mutate({ id: selectedEntry.id.toString(), reason: rejectionReason });
      setRejectDialogOpen(false);
      setRejectionReason('');
    }
  };

  const confirmOnHold = () => {
    if (selectedEntry && onHoldReason.trim()) {
      onHoldMutation.mutate({ id: selectedEntry.id.toString(), reason: onHoldReason });
      setOnHoldDialogOpen(false);
      setOnHoldReason('');
    }
  };

  const confirmBulkReject = () => {
    if (rejectionReason.trim() && selectedIds.size > 0) {
      bulkRejectMutation.mutate({ ids: Array.from(selectedIds), reason: rejectionReason });
    }
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedIds(new Set());
      setSelectAll(false);
    } else {
      const applicableIds = new Set(
        filteredSubmissions
          .filter(e => e.status !== 'approved' && e.status !== 'rejected')
          .map(e => e.id.toString())
      );
      setSelectedIds(applicableIds);
      setSelectAll(true);
    }
  };

  const toggleSelectEntry = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
      setSelectAll(false);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Approvals</h1>
          <p className="text-blue-200/60 text-sm">Review and manage timesheet submissions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch();
              refetchSiteReports();
            }}
            className="bg-slate-800 border-blue-500/20 text-blue-300"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading || isSiteReportsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Summary Card */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="bg-slate-800/40 border-blue-500/10 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-blue-400 font-bold uppercase mb-1">Total Timesheets</span>
            <span className="text-xl font-bold text-white">{stats.total}</span>
          </Card>
          <Card className="bg-yellow-500/5 border-yellow-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-yellow-400 font-bold uppercase mb-1">Pending</span>
            <span className="text-xl font-bold text-yellow-400">{stats.pending}</span>
          </Card>
          <Card className="bg-blue-500/5 border-blue-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-blue-400 font-bold uppercase mb-1">Mgr Appr</span>
            <span className="text-xl font-bold text-blue-400">{stats.manager_approved}</span>
          </Card>
          <Card className="bg-green-500/5 border-green-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-green-400 font-bold uppercase mb-1">Approved</span>
            <span className="text-xl font-bold text-green-400">{stats.approved}</span>
          </Card>
          <Card className="bg-orange-500/5 border-orange-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-orange-400 font-bold uppercase mb-1">On Hold</span>
            <span className="text-xl font-bold text-orange-400">{stats.on_hold}</span>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-cyan-500/5 border-cyan-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-cyan-400 font-bold uppercase mb-1">Total Site Reports</span>
            <span className="text-xl font-bold text-cyan-400">{siteStats.total}</span>
          </Card>
          <Card className="bg-yellow-500/5 border-yellow-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-yellow-400 font-bold uppercase mb-1">Site Pending</span>
            <span className="text-xl font-bold text-yellow-400">{siteStats.pending}</span>
          </Card>
          <Card className="bg-green-500/5 border-green-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-green-400 font-bold uppercase mb-1">Site Approved</span>
            <span className="text-xl font-bold text-green-400">{siteStats.approved}</span>
          </Card>
          <Card className="bg-red-500/5 border-red-500/20 p-3 flex flex-col items-center justify-center text-center approvals-kpi-card">
            <span className="text-[10px] text-red-400 font-bold uppercase mb-1">Site Rejected</span>
            <span className="text-xl font-bold text-red-400">{siteStats.rejected}</span>
          </Card>
        </div>
      </div>

      {currentTab !== 'adminApproval' && (<>
        {/* Month Navigator */}
        <Card className="bg-slate-800/60 border-blue-500/20 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMonth(prev => subMonths(prev, 1))}
              disabled={showAllTime}
              className="bg-slate-900/50 border-blue-500/20 text-blue-300 hover:text-white"
            >
              ◀
            </Button>
            <span className="text-sm font-bold text-white min-w-[120px] text-center">
              {showAllTime ? 'All Time' : format(viewMonth, 'MMMM yyyy')}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMonth(next => addMonths(next, 1))}
              disabled={showAllTime}
              className="bg-slate-900/50 border-blue-500/20 text-blue-300 hover:text-white"
            >
              ▶
            </Button>
            {!showAllTime && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMonth(startOfMonth(new Date()))}
                className="text-xs text-blue-400 hover:text-white px-2"
              >
                This Month
              </Button>
            )}
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAllTime(!showAllTime)}
              className={`text-xs h-9 px-4 border-blue-500/25 ${showAllTime ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900/50 text-blue-300 hover:text-white'}`}
            >
              {showAllTime ? 'Show Current Month' : 'Search All Time'}
            </Button>
          </div>
        </Card>

        {/* Filter Section */}
        <Card className="bg-slate-800/60 border-blue-500/20 p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400/60" />
              <Input
                placeholder="Search employee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-900/50 border-blue-500/20 text-white h-9"
              />
            </div>

            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-slate-900/50 border-blue-500/20 text-white h-9">
                  <ListFilter className="w-4 h-4 mr-2 text-blue-400" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-blue-500/20">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resubmitted">Resubmitted</SelectItem>
                  <SelectItem value="manager_approved">Manager Approved</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal bg-slate-900/50 border-blue-500/20 text-white h-9">
                    <CalendarIcon className="mr-2 h-4 w-4 text-blue-400" />
                    {selectedDate ? format(selectedDate, "PPP") : <span>Filter by date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-slate-900 border-blue-500/20">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      if (date && !showAllTime) setViewMonth(startOfMonth(date));
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={selectAll}
                onCheckedChange={toggleSelectAll}
                className="border-blue-500/30"
              />
              <span className="text-xs text-blue-400">Select All</span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setSelectedDate(undefined);
                setSelectedIds(new Set());
                setSelectAll(false);
              }}
              className="text-blue-400 hover:text-white h-9"
            >
              Clear Filters
            </Button>
          </div>
        </Card>

        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <Card className="bg-blue-500/10 border-blue-500/30 p-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <span className="text-sm text-blue-200">{selectedIds.size} entries selected</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-500"
                onClick={() => setBulkRejectDialogOpen(true)}
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Reject Selected
              </Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-500"
                onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
                disabled={bulkApproveMutation.isPending}
              >
                {bulkApproveMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                <Check className="w-3.5 h-3.5 mr-1.5" />
                Approve Selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectAll(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}

      </>)}

      <Tabs defaultValue="timesheets" onValueChange={setCurrentTab} className="w-full">
        <TabsList className={`bg-slate-900 border border-blue-500/10 p-1 mb-4 h-11 w-full ${user.role === 'admin' ? 'max-w-2xl' : 'max-w-md'}`}>
          <TabsTrigger value="timesheets" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white flex-1 text-xs gap-2">
            <Clock className="w-4 h-4" />
            Timesheets ({filteredSubmissions.length})
          </TabsTrigger>
          <TabsTrigger value="siteReports" className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white flex-1 text-xs gap-2">
            <HardHat className="w-4 h-4" />
            Site Reports ({rawSiteReports.filter(r => r.status === 'pending').length})
          </TabsTrigger>
          <TabsTrigger value="dailyPlans" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white flex-1 text-xs gap-2">
            <Target className="w-4 h-4" />
            Daily Plans ({pendingPlansCount})
          </TabsTrigger>
          {user.role === 'admin' && (
            <TabsTrigger value="adminApproval" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white flex-1 text-xs gap-2">
              <ShieldCheck className="w-4 h-4" />
              Admin Approval
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="timesheets">
          <div className="space-y-3">
            {filteredSubmissions.length === 0 ? (
              <div className="text-center py-12 bg-slate-800/20 rounded-lg border border-dashed border-blue-500/20">
                <AlertCircle className="w-8 h-8 text-blue-500/40 mx-auto mb-2" />
                <p className="text-blue-200/40">No matching submissions found.</p>
              </div>
            ) : (
              <>
                {visibleSubmissions.map((entry) => {
                  const parsed = parseTaskDescription(entry.taskDescription, entry);
                  const isExpanded = expandedId === entry.id.toString();

                  return (
                    <Card key={entry.id} className={`bg-slate-800/40 border-blue-500/10 p-4 transition-all hover:bg-slate-800/60 ${selectedIds.has(entry.id.toString()) ? 'border-blue-500/50 bg-blue-500/5' : ''}`}>
                      {/* Header: Checkbox, Name, Status and TIME + COMPLETION */}
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex gap-3">
                          {((entry.status || '').toString().toLowerCase() !== 'approved') && ((entry.status || '').toString().toLowerCase() !== 'rejected') && (
                            <Checkbox
                              checked={selectedIds.has(entry.id.toString())}
                              onCheckedChange={() => toggleSelectEntry(entry.id.toString())}
                              className="mt-2 border-blue-500/30"
                            />
                          )}
                          <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center text-sm text-blue-400 font-bold border border-blue-500/20">
                            {entry.employeeName.charAt(0)}
                          </div>
                          <div>
                            <h3 className="text-base text-white font-semibold leading-none">{entry.employeeName}</h3>
                            <p className="text-[10px] text-blue-400/60 mt-1 uppercase font-bold">{entry.employeeCode}</p>
                            <div className="flex gap-2 mt-2 flex-wrap">
                              <span className="flex items-center text-xs text-green-400 font-bold bg-green-500/15 px-2 py-1 rounded-md border border-green-500/20">
                                <CalendarIcon className="w-3 h-3 mr-1.5" /> {format(parseISO(entry.date?.toString() || new Date().toISOString()), 'MMM dd, yyyy')}
                              </span>
                              <span className="flex items-center text-xs text-blue-400 font-bold bg-blue-500/15 px-2 py-1 rounded-md border border-blue-500/20">
                                <Clock className="w-3 h-3 mr-1.5" /> {entry.startTime} - {entry.endTime}
                              </span>
                              <span className="flex items-center text-xs text-purple-400 font-bold bg-purple-500/15 px-2 py-1 rounded-md border border-purple-500/20">
                                <Target className="w-3 h-3 mr-1.5" /> {entry.percentageComplete}% Complete
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <Badge className={`uppercase text-[10px] px-2 py-0.5 ${entry.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                            entry.status === 'resubmitted' ? 'bg-orange-500/20 text-orange-400 border-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.4)] animate-pulse' :
                              entry.status === 'approved' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                                entry.status === 'manager_approved' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                                  entry.status === 'on_hold' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                                    'bg-red-500/20 text-red-400 border-red-500/30'
                            } border`}>
                            {entry.status ? entry.status.replace('_', ' ') : 'pending'}
                          </Badge>
                          {entry.pmsId ? (
                            <Badge variant="outline" className="text-[9px] bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                              <Target className="w-2.5 h-2.5 mr-1" /> PLANNED
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20">
                              <Zap className="w-2.5 h-2.5 mr-1" /> MANUAL
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* LMS Hours Summary (if any) */}
                      <LMSHoursDisplay employeeCode={entry.employeeCode} date={entry.date} />

                      {/* Projects & Task Brief */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs mb-3">
                        <div className="bg-slate-900/60 p-2 rounded-lg border border-blue-500/10">
                          <span className="text-cyan-400 font-bold text-[9px] uppercase block mb-1">Project</span>
                          <span className="text-white font-medium">{entry.projectName}</span>
                        </div>
                        <div className="bg-slate-900/60 p-2 rounded-lg border border-indigo-500/10">
                          <span className="text-indigo-400 font-bold text-[9px] uppercase block mb-1">Key Step</span>
                          <span className="text-white font-medium">{entry.keyStep || "N/A"}</span>
                        </div>
                        <div className="bg-slate-900/60 p-2 rounded-lg border border-purple-500/10">
                          <span className="text-purple-400 font-bold text-[9px] uppercase block mb-1">Task</span>
                          <span className="text-white font-medium">{parsed.task}</span>
                        </div>
                        <div className="bg-slate-900/60 p-2 rounded-lg border border-pink-500/10">
                          <span className="text-pink-400 font-bold text-[9px] uppercase block mb-1">Subtask</span>
                          <span className="text-white font-medium">{entry.taskDescription.split(' | ')[1] || "N/A"}</span>
                        </div>
                      </div>

                      {/* Expanded Section: Task Details tab + Activity Timeline tab */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-blue-500/10">
                          <Tabs defaultValue="details">
                            <TabsList className="bg-slate-900 border border-blue-500/10 p-1 mb-4 h-10">
                              <TabsTrigger value="details" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs gap-1.5">
                                <FileText className="w-3.5 h-3.5" />
                                Task Details
                              </TabsTrigger>
                              <TabsTrigger value="activity" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                Activity Timeline
                              </TabsTrigger>
                            </TabsList>

                            <TabsContent value="details" className="space-y-4 mt-0">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <TaskDetailRow label="Quantify Result" value={entry.quantify} icon={Target} colorClass="border-orange-500/10 bg-orange-500/5" />
                                <TaskDetailRow label="Achievements" value={entry.achievements} icon={Trophy} colorClass="border-green-500/10 bg-green-500/5" />
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <TaskDetailRow label="Problems & Issues" value={entry.problemAndIssues} icon={AlertCircle} colorClass="border-red-500/10 bg-red-500/5" />
                                <TaskDetailRow label="Scope of Improvements" value={entry.scopeOfImprovements} icon={TrendingUp} colorClass="border-yellow-500/10 bg-yellow-500/5" />
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-cyan-500/5 p-3 rounded-lg border border-cyan-500/10">
                                  <span className="text-cyan-400 font-bold uppercase text-[9px] block mb-2 flex items-center gap-1">
                                    <Wrench className="w-3 h-3" /> Tools Used
                                  </span>
                                  <div className="flex flex-wrap gap-2 mt-1">
                                    {entry.toolsUsed && entry.toolsUsed.length > 0 ? (
                                      entry.toolsUsed.map(t => (
                                        <Badge key={t} variant="outline" className="text-[10px] bg-blue-500/10 border-blue-500/30 text-blue-300 px-2.5 py-0.5">
                                          {t}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-blue-200/20 text-[10px] italic">No tools recorded</span>
                                    )}
                                  </div>
                                </div>
                                <TaskDetailRow label="Description" value={entry.taskDescription.split(' | ')[2] || parsed.description} icon={FileText} colorClass="border-blue-500/10 bg-blue-500/5" />
                              </div>

                              {entry.status === 'on_hold' && entry.onHoldReason && (
                                <div className="bg-orange-500/5 p-3 rounded-lg border border-orange-500/20 flex items-start gap-3">
                                  <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5" />
                                  <div>
                                    <span className="text-orange-400 font-bold uppercase text-[9px] block mb-1">On Hold Reason</span>
                                    <p className="text-blue-100/70 text-xs leading-relaxed">{entry.onHoldReason}</p>
                                  </div>
                                </div>
                              )}
                            </TabsContent>

                            <TabsContent value="activity" className="mt-0">
                              <ActivityTimelinePanel
                                employeeCode={entry.employeeCode}
                                date={entry.date?.toString()}
                                startTime={entry.startTime}
                                endTime={entry.endTime}
                              />
                            </TabsContent>
                          </Tabs>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex justify-between items-center mt-4 pt-3 border-t border-blue-500/10">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(isExpanded ? null : entry.id.toString())}
                          className="h-8 text-xs text-blue-400 hover:bg-blue-500/5"
                        >
                          {isExpanded ? (
                            <><ChevronUp className="w-3.5 h-3.5 mr-1.5" /> Hide Details</>
                          ) : (
                            <><ChevronDown className="w-3.5 h-3.5 mr-1.5" /> View Details</>
                          )}
                        </Button>

                        {entry.status !== 'approved' && entry.status !== 'rejected' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-8 text-xs px-4 bg-orange-600/20 text-orange-400 border border-orange-500/20 hover:bg-orange-600/30"
                              onClick={() => { setSelectedEntry(entry); setOnHoldDialogOpen(true); }}
                            >
                              <PauseCircle className="w-3.5 h-3.5 mr-1.5" />
                              On Hold
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8 text-xs px-4"
                              onClick={() => { setSelectedEntry(entry); setRejectDialogOpen(true); }}
                            >
                              <X className="w-3.5 h-3.5 mr-1.5" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 text-xs px-4 bg-blue-600 hover:bg-blue-500"
                              onClick={() => user.role === 'admin' ? approveMutation.mutate(entry.id.toString()) : managerApproveMutation.mutate(entry.id.toString())}
                            >
                              <Check className="w-3.5 h-3.5 mr-1.5" />
                              Approve
                            </Button>
                          </div>
                        )}
                        {entry.status === 'on_hold' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs px-4 bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20"
                            onClick={() => {
                              window.location.href = `/discussion?entryId=${entry.id}`;
                            }}
                          >
                            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                            Discuss
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
                {hiddenCount > 0 && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                      className="bg-slate-800 border-blue-500/20 text-blue-300 hover:text-white"
                    >
                      Show {Math.min(PAGE_SIZE, hiddenCount)} more ({hiddenCount} remaining)
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="siteReports">
          <div className="space-y-4">
            {rawSiteReports.length === 0 ? (
              <div className="text-center py-12 bg-slate-800/20 rounded-lg border border-dashed border-cyan-500/20">
                <HardHat className="w-8 h-8 text-cyan-500/40 mx-auto mb-2" />
                <p className="text-cyan-200/40">No site reports submitted yet.</p>
              </div>
            ) : (
              rawSiteReports.map((report) => (
                <Card key={report.id} className="bg-slate-900/60 border-cyan-500/10 p-5 overflow-hidden relative group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-3xl rounded-full -mr-12 -mt-12 group-hover:bg-cyan-500/10 transition-colors" />

                  <div className="flex flex-col md:flex-row justify-between gap-4 relative z-10">
                    <div className="flex gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 flex flex-col items-center justify-center border border-cyan-500/30">
                        <span className="text-cyan-400 font-bold text-xs">{format(parseISO(report.date || new Date().toISOString()), 'dd')}</span>
                        <span className="text-cyan-400/60 text-[8px] uppercase font-bold">{format(parseISO(report.date || new Date().toISOString()), 'MMM')}</span>
                      </div>
                      <div>
                        <h3 className="text-lg text-white font-bold">{report.projectName}</h3>
                        <div className="flex gap-3 mt-1 items-center">
                          <span className="text-xs text-blue-400 font-medium flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" /> {report.startTime} - {report.endTime} ({report.duration})
                          </span>
                          <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5" /> {report.laborCount} Workers
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <Badge className={`uppercase text-[9px] px-2 py-0.5 tracking-wider font-bold ${report.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                        report.status === 'approved' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                          'bg-red-500/20 text-red-400 border-red-500/30'
                        } border`}>
                        {report.status}
                      </Badge>
                      <p className="text-[10px] text-slate-500">Submitted by: <span className="text-slate-300 font-medium">{report.employeeName}</span></p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                      <span className="text-cyan-400 text-[9px] uppercase font-bold block mb-1.5 flex items-center gap-1">
                        <Package className="w-3 h-3" /> Work Category
                      </span>
                      <p className="text-white text-xs font-semibold">{report.workCategory}</p>
                    </div>
                    {report.locationLat && (
                      <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                        <span className="text-emerald-400 text-[9px] uppercase font-bold block mb-1.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Location
                        </span>
                        <p className="text-white text-xs font-semibold truncate">{report.locationLat.substring(0, 8)}, {report.locationLng?.substring(0, 8)}</p>
                      </div>
                    )}
                    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 lg:col-span-2">
                      <span className="text-blue-400 text-[9px] uppercase font-bold block mb-1.5 flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Description
                      </span>
                      <p className="text-slate-300 text-xs line-clamp-2">{report.workDone}</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-white/5 flex flex-col md:flex-row justify-between gap-4">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-[10px] text-slate-400 hover:text-white"
                        onClick={async () => {
                          setLoadingDetail(true);
                          setSiteReportDetailOpen(true);
                          try {
                            const res = await apiRequest('GET', `/api/site-reports/${report.id}`);
                            const detail = await res.json();
                            setSiteReportDetail(detail);
                          } catch (e) {
                            toast({ title: "Failed to load report", variant: "destructive" });
                          } finally {
                            setLoadingDetail(false);
                          }
                        }}
                      >
                        <Eye className="w-3.5 h-3.5 mr-2" />
                        View Full Report
                      </Button>
                    </div>

                    {report.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 text-xs font-bold"
                          onClick={() => rejectSiteReportMutation.mutate(report.id)}
                          disabled={rejectSiteReportMutation.isPending}
                        >
                          {rejectSiteReportMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-bold"
                          onClick={() => approveSiteReportMutation.mutate(report.id)}
                          disabled={approveSiteReportMutation.isPending}
                        >
                          {approveSiteReportMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                          Approve Report
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {user.role === 'admin' && (
          <TabsContent value="adminApproval">
            <AdminApprovalPanel user={user} />
          </TabsContent>
        )}

        <TabsContent value="dailyPlans">
          <div className="space-y-2">
            {rawDailyPlans.length === 0 ? (
              <div className="text-center py-12 bg-slate-800/20 rounded-lg border border-dashed border-amber-500/20">
                <Target className="w-8 h-8 text-amber-500/40 mx-auto mb-2" />
                <p className="text-amber-200/40">No daily plans submitted yet.</p>
              </div>
            ) : (
              rawDailyPlans.map((plan: any) => {
                const isExpanded = expandedPlanId === plan.id;
                const deviations = (plan.tasks || []).filter((t: any) => t.isDeviation && t.status === 'pending');
                const postponed = plan.postponedTasks || [];

                return (
                  <div key={plan.id} className="rounded-2xl border border-amber-500/10 bg-slate-900/60 overflow-hidden">
                    {/* Summary row – click to expand */}
                    <button
                      type="button"
                      onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/40 transition-colors text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-9 h-9 rounded-full bg-amber-600/20 flex items-center justify-center text-sm text-amber-500 font-bold border border-amber-500/20 shrink-0">
                          {(plan.employeeName || 'U').charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{plan.employeeName}</p>
                          <p className="text-[10px] text-amber-400/50 uppercase font-bold tracking-wider">{plan.employeeCode} · {plan.date}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1.5">
                          <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold">
                            {(plan.tasks || []).filter((t: any) => !t.isDeviation).length} Tasks
                          </span>
                          {deviations.length > 0 && (
                            <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-bold animate-pulse">
                              {deviations.length} Dev
                            </span>
                          )}
                          {postponed.length > 0 && (
                            <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full font-bold">
                              {postponed.length} Postponed
                            </span>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                      </div>
                    </button>

                    {/* Expanded area */}
                    {isExpanded && (
                      <div className="border-t border-slate-800 px-5 py-4 space-y-4">
                        {/* Planned Tasks */}
                        <div>
                          <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-2">📋 Planned Tasks</p>
                          <div className="space-y-2">
                            {(plan.tasks || []).map((task: any) => {
                              const schedule = parsePlanScheduleData(task);
                              const start = formatPlanTime12h(schedule.startTime || task.startTime);
                              const end = formatPlanTime12h(schedule.endTime || task.endTime);
                              const subtaskName = schedule.subtaskName || task.subtaskName;
                              return (
                                <div key={task.id} className={`flex items-center justify-between p-3 rounded-xl border ${task.isDeviation ? 'bg-amber-500/5 border-amber-500/20' : 'bg-slate-800/30 border-slate-700/40'}`}>
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-bold text-white">{task.taskName}</span>
                                      {task.isDeviation && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[8px] h-4">Deviation</Badge>}
                                      {(start && end) && (
                                        <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                                          {start} – {end}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">{task.projectName}</p>
                                    {subtaskName && <p className="text-[11px] text-blue-300/70 mt-0.5">↳ {subtaskName}</p>}
                                    {task.isDeviation && task.deviationReason && (
                                      <p className="text-xs text-amber-200/60 italic mt-0.5">"{task.deviationReason}"</p>
                                    )}
                                  </div>
                                  {task.isDeviation && task.status === 'pending' ? (
                                    <div className="flex gap-1.5 shrink-0 ml-3">
                                      <Button size="sm" variant="destructive" className="h-7 text-[10px] px-2"
                                        onClick={() => updatePlanTaskMutation.mutate({ taskId: task.id, status: 'rejected' })}>
                                        Reject
                                      </Button>
                                      <Button size="sm" className="h-7 text-[10px] px-2 bg-green-600 hover:bg-green-500"
                                        onClick={() => updatePlanTaskMutation.mutate({ taskId: task.id, status: 'approved' })}>
                                        Approve
                                      </Button>
                                    </div>
                                  ) : (
                                    <Badge className={`uppercase text-[8px] shrink-0 ml-3 ${task.status === 'approved' ? 'bg-green-500/20 text-green-400' : task.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-500'}`}>
                                      {task.status}
                                    </Badge>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Postponed Tasks */}
                        {postponed.length > 0 && (
                          <div>
                            <p className="text-[10px] text-orange-400 font-black uppercase tracking-widest mb-2">⏭️ Postponed Tasks</p>
                            <div className="space-y-2">
                              {postponed.map((pt: any, i: number) => (
                                <div key={i} className="flex items-start justify-between p-3 rounded-xl border bg-orange-500/5 border-orange-500/20">
                                  <div>
                                    <span className="text-sm font-bold text-white">{pt.task_name}</span>
                                    <p className="text-xs text-orange-200/60 italic mt-0.5">"{pt.reason}"</p>
                                  </div>
                                  <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full font-bold shrink-0 ml-3">
                                    Due: {pt.new_due_date}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="bg-slate-900 border-blue-500/20 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Reject Submission</DialogTitle>
            <DialogDescription className="text-blue-200/60 text-sm">
              Please provide a reason for rejecting this timesheet entry.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Rejection reason..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            className="bg-slate-800 border-blue-500/20 text-white min-h-[120px] focus:ring-blue-500/50"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => { setRejectDialogOpen(false); setRejectionReason(''); }}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={confirmReject} disabled={!rejectionReason.trim() || rejectMutation.isPending}>
              {rejectMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkRejectDialogOpen} onOpenChange={setBulkRejectDialogOpen}>
        <DialogContent className="bg-slate-900 border-blue-500/20 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Reject Selected Entries</DialogTitle>
            <DialogDescription className="text-blue-200/60 text-sm">
              Provide a reason for rejecting {selectedIds.size} selected timesheet entries.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Rejection reason..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            className="bg-slate-800 border-blue-500/20 text-white min-h-[120px] focus:ring-blue-500/50"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => { setBulkRejectDialogOpen(false); setRejectionReason(''); }}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={confirmBulkReject} disabled={!rejectionReason.trim() || bulkRejectMutation.isPending}>
              {bulkRejectMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
              Confirm Bulk Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={onHoldDialogOpen} onOpenChange={setOnHoldDialogOpen}>
        <DialogContent className="bg-slate-900 border-blue-500/20 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Put Task On Hold</DialogTitle>
            <DialogDescription className="text-blue-200/60 text-sm">
              Please provide a reason why this task is being put on hold.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for holding..."
            value={onHoldReason}
            onChange={(e) => setOnHoldReason(e.target.value)}
            className="bg-slate-800 border-blue-500/20 text-white min-h-[120px] focus:ring-blue-500/50"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => { setOnHoldDialogOpen(false); setOnHoldReason(''); }}>Cancel</Button>
            <Button variant="secondary" size="sm" onClick={confirmOnHold} disabled={!onHoldReason.trim() || onHoldMutation.isPending} className="bg-orange-600 hover:bg-orange-500">
              {onHoldMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
              Confirm On Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Site Report Full Detail Dialog */}
      <Dialog open={siteReportDetailOpen} onOpenChange={(open) => { setSiteReportDetailOpen(open); if (!open) setSiteReportDetail(null); }}>
        <DialogContent className="bg-slate-900 border-white/10 sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-400" />
              Site Report Details
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Full details of the submitted site report
            </DialogDescription>
          </DialogHeader>

          {loadingDetail ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : siteReportDetail ? (
            <div className="space-y-6">
              {/* Header Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[9px] uppercase font-bold text-cyan-400 block mb-1">Project</span>
                  <p className="text-white text-sm font-semibold">{siteReportDetail.projectName}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[9px] uppercase font-bold text-blue-400 block mb-1">Date</span>
                  <p className="text-white text-sm font-semibold">{siteReportDetail.date}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[9px] uppercase font-bold text-emerald-400 block mb-1">Category</span>
                  <p className="text-white text-sm font-semibold">{siteReportDetail.workCategory}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[9px] uppercase font-bold text-violet-400 block mb-1">Submitted By</span>
                  <p className="text-white text-sm font-semibold">{siteReportDetail.employeeName}</p>
                </div>
              </div>

              {/* Working Hours */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <span className="text-[9px] uppercase font-bold text-blue-400 block mb-1"><Clock className="w-3 h-3 inline mr-1" />Start Time</span>
                  <p className="text-white text-sm font-bold">{siteReportDetail.startTime || 'N/A'}</p>
                </div>
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <span className="text-[9px] uppercase font-bold text-indigo-400 block mb-1"><Clock className="w-3 h-3 inline mr-1" />End Time</span>
                  <p className="text-white text-sm font-bold">{siteReportDetail.endTime || 'N/A'}</p>
                </div>
                <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                  <span className="text-[9px] uppercase font-bold text-cyan-400 block mb-1"><Clock className="w-3 h-3 inline mr-1" />Duration</span>
                  <p className="text-white text-sm font-bold">{siteReportDetail.duration || 'N/A'}</p>
                </div>
              </div>

              {/* Work Done */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-white/5">
                <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" /> Work Done / Notes
                </h4>
                <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{siteReportDetail.workDone || 'No notes provided.'}</p>
              </div>

              {/* Sqft & Materials side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {siteReportDetail.sqftCovered && (
                  <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
                    <h4 className="text-sm font-bold text-orange-400 mb-2 flex items-center gap-2">
                      <Target className="w-4 h-4" /> Work Output (Sqft)
                    </h4>
                    <p className="text-white text-sm">{siteReportDetail.sqftCovered}</p>
                  </div>
                )}
                {siteReportDetail.materialsUsed && (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <h4 className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-2">
                      <Package className="w-4 h-4" /> Materials Used
                    </h4>
                    <p className="text-slate-300 text-sm whitespace-pre-wrap">{siteReportDetail.materialsUsed}</p>
                  </div>
                )}
              </div>

              {/* Issues */}
              {siteReportDetail.issuesFaced && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <h4 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> Issues Faced
                  </h4>
                  <p className="text-slate-300 text-sm whitespace-pre-wrap">{siteReportDetail.issuesFaced}</p>
                </div>
              )}

              {/* Labour Log */}
              {siteReportDetail.laborData && JSON.parse(typeof siteReportDetail.laborData === 'string' ? siteReportDetail.laborData : JSON.stringify(siteReportDetail.laborData)).length > 0 && (
                <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                  <h4 className="text-sm font-bold text-violet-400 mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4" /> Labour Attendance Log
                    <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-[10px] px-2">
                      {(JSON.parse(typeof siteReportDetail.laborData === 'string' ? siteReportDetail.laborData : JSON.stringify(siteReportDetail.laborData))).length} workers
                    </Badge>
                  </h4>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-3 py-1 text-[9px] uppercase text-slate-500 font-bold">
                      <span className="w-6">#</span>
                      <span className="flex-[3]">Name</span>
                      <span className="flex-1 text-center">In</span>
                      <span className="flex-1 text-center">Out</span>
                    </div>
                    {(JSON.parse(typeof siteReportDetail.laborData === 'string' ? siteReportDetail.laborData : JSON.stringify(siteReportDetail.laborData))).map((l: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-white/5">
                        <span className="w-6 text-[10px] text-slate-500 font-mono">{i + 1}</span>
                        <span className="flex-[3] text-sm text-white">{l.name || 'Anonymous'}</span>
                        <span className="flex-1 text-center text-xs text-slate-300 font-mono">{l.inTime || '--:--'}</span>
                        <span className="flex-1 text-center text-xs text-slate-300 font-mono">{l.outTime || '--:--'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* GPS Location */}
              {siteReportDetail.locationLat && siteReportDetail.locationLng && (
                <div className="p-4 rounded-xl bg-slate-800/40 border border-white/5">
                  <h4 className="text-sm font-bold text-orange-400 mb-3 flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> GPS Location
                    <span className="text-xs text-slate-400 font-normal">{siteReportDetail.locationLat}, {siteReportDetail.locationLng}</span>
                  </h4>
                  <div className="w-full h-[200px] rounded-xl overflow-hidden border border-white/10">
                    <iframe
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      scrolling="no"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(siteReportDetail.locationLng) - 0.005}%2C${parseFloat(siteReportDetail.locationLat) - 0.005}%2C${parseFloat(siteReportDetail.locationLng) + 0.005}%2C${parseFloat(siteReportDetail.locationLat) + 0.005}&layer=mapnik&marker=${siteReportDetail.locationLat}%2C${siteReportDetail.locationLng}`}
                      style={{ filter: 'invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)' }}
                    />
                  </div>
                </div>
              )}

              {/* Attachments / Photos */}
              {siteReportDetail.attachments && siteReportDetail.attachments.length > 0 && (
                <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <h4 className="text-sm font-bold text-indigo-400 mb-3 flex items-center gap-2">
                    <Eye className="w-4 h-4" /> Site Evidence Photos
                    <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px] px-2">
                      {siteReportDetail.attachments.length}
                    </Badge>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {siteReportDetail.attachments.map((att: any, i: number) => (
                      <div key={i} className="rounded-xl overflow-hidden border border-white/10 bg-slate-800/40">
                        {(att.fileType?.startsWith('image/') || att.fileUrl?.startsWith('data:image/')) ? (
                          <img src={att.fileUrl} alt={att.fileName} className="w-full h-48 object-cover" />
                        ) : (
                          <div className="w-full h-32 flex items-center justify-center bg-slate-800">
                            <FileText className="w-10 h-10 text-slate-500" />
                          </div>
                        )}
                        <div className="p-2">
                          <p className="text-xs text-slate-300 truncate">{att.fileName}</p>
                          <p className="text-[10px] text-slate-500 uppercase">{att.fileType?.split('/')[1] || 'file'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-white/5">
                <span className="text-xs text-slate-400">Report Status</span>
                <Badge className={`uppercase text-[10px] px-3 py-1 font-bold ${siteReportDetail.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                  siteReportDetail.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                    'bg-red-500/20 text-red-400 border-red-500/30'
                  } border`}>
                  {siteReportDetail.status}
                </Badge>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin Approval tab: rule-based auto approve / reject for one employee + date range
// ---------------------------------------------------------------------------
// Rules are edited here, saved on the server, and enforced on employee submission and on approval.
function RuleRow({ label, hint, submit, approve, onSubmit, onApprove, children }: {
  label: string; hint?: string; submit: boolean; approve: boolean;
  onSubmit: (v: boolean) => void; onApprove: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(150px,1.2fr)_90px_90px_minmax(0,2fr)] items-center gap-x-3 gap-y-1 py-2 border-b border-blue-500/10 last:border-0">
      <div className="min-w-0">
        <span className="text-xs font-medium text-blue-100">{label}</span>
        {hint && <span className="block text-[10px] text-blue-200/40">{hint}</span>}
      </div>
      <div className="flex justify-center"><Switch checked={submit} onCheckedChange={onSubmit} /></div>
      <div className="flex justify-center"><Switch checked={approve} onCheckedChange={onApprove} /></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{children}</div>
    </div>
  );
}

function NumField({ label, value, onChange, max }: {
  label: string; value: number; onChange: (v: number) => void; max?: number;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-blue-200/70">
      {label}
      <Input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max ?? 500, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
        className="bg-slate-900/50 border-blue-500/20 text-white h-8 w-20"
      />
    </label>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-blue-200/70 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} className="border-blue-500/30" />
      {label}
    </label>
  );
}

type ReviewRow = {
  id: string;
  project: string;
  task: string;
  result: 'approved' | 'rejected' | 'skipped' | 'blocked';
  currentStatus: string;
  reasons: string[];
};
type ReviewDate = { date: string; entries: ReviewRow[]; emailSent: boolean; emailNote?: string };
type ReviewResult = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  startDate: string;
  endDate: string;
  totals: { dates: number; entries: number; approved: number; rejected: number; skipped: number };
  dates: ReviewDate[];
  reportEmailSent: boolean;
};

const reviewDateStatus = (d: ReviewDate): 'approved' | 'rejected' | 'partial' | 'skipped' | 'blocked' => {
  const results = d.entries.map(e => e.result);
  if (results.every(r => r === 'approved')) return 'approved';
  if (results.every(r => r === 'rejected')) return 'rejected';
  if (results.every(r => r === 'skipped')) return 'skipped';
  if (results.every(r => r === 'blocked')) return 'blocked';
  return 'partial';
};

const REVIEW_STATUS_STYLES: Record<string, string> = {
  approved: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  partial: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  skipped: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  blocked: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  partial: 'Partially processed',
  skipped: 'Unchanged',
  blocked: 'Conditions not met',
};

const recomputeTotals = (dates: ReviewDate[]) => {
  const all = dates.flatMap(d => d.entries);
  return {
    dates: dates.length,
    entries: all.length,
    approved: all.filter(e => e.result === 'approved').length,
    rejected: all.filter(e => e.result === 'rejected').length,
    skipped: all.filter(e => e.result === 'skipped' || e.result === 'blocked').length,
  };
};

// Turns the saved rules into plain-language approval conditions shown to the admin.
const describeApprovalConditions = (r: ValidationRules): string[] => {
  const out: string[] = [];
  const text = (label: string) => `${label} must be filled with at least ${TIMESHEET_MIN_CHARS} characters of real content (no "n/a", "none" or repeated characters)`;
  if (r.quantify.approve) {
    out.push(`${text('Quantify Your Result')}, at most ${r.quantify.maxWords} words${r.quantify.requireNumber ? ', and it must contain a measurable number' : ''}`);
  }
  if (r.achievements.approve) {
    out.push(`${text('Achievements')}, at most ${r.achievements.maxWords} words${r.achievements.allowProblemsInstead ? ' (if empty, a valid Problems & Issues entry is accepted instead)' : ''}`);
  }
  if (r.problemAndIssues.approve) out.push(text('Problems & Issues'));
  if (r.description.approve) out.push(`${text('Description')}, at most ${r.description.maxWords} words`);
  if (r.toolsUsed.approve) out.push('Tools Used must have at least one tool selected');
  if (r.percentageComplete.approve) out.push(`Completion % must be between ${r.percentageComplete.minValue} and 100`);
  if (r.keyStep.approve) out.push('Key Step must be filled');
  if (r.subTask.approve) out.push('Subtask must be filled');
  if (r.scopeOfImprovements.approve) out.push(text('Scope of Improvements'));
  return out;
};

function AdminApprovalPanel({ user }: { user: User }) {
  const { toast } = useToast();
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const { rules: savedRules, record: rulesRecord } = useValidationRules();
  const [draftRules, setDraftRules] = useState<ValidationRules | null>(null);
  const rules: ValidationRules = draftRules ?? savedRules;
  const rulesDirty = draftRules !== null && JSON.stringify(draftRules) !== JSON.stringify(savedRules);
  const setRule = <K extends keyof ValidationRules>(key: K, patch: Partial<ValidationRules[K]>) =>
    setDraftRules(prev => {
      const base = prev ?? savedRules;
      return { ...base, [key]: { ...base[key], ...patch } };
    });
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [failures, setFailures] = useState<{ employeeId: string; name: string; error: string }[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ employeeId: string; date: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null); // `${action}:${employeeId}:${date}`

  const { data: employees = [] } = useQuery<any[]>({ queryKey: ['/api/employees'] });
  const activeEmployees = useMemo(
    () => employees.filter(e => e.isActive !== false).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [employees]
  );
  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return activeEmployees;
    return activeEmployees.filter(e => `${e.name} ${e.employeeCode}`.toLowerCase().includes(q));
  }, [activeEmployees, employeeSearch]);
  const selectedEmployees = useMemo(
    () => activeEmployees.filter(e => employeeIds.includes(e.id)),
    [activeEmployees, employeeIds]
  );
  const toggleEmployee = (id: string) =>
    setEmployeeIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const allFilteredSelected = filteredEmployees.length > 0 && filteredEmployees.every(e => employeeIds.includes(e.id));
  const toggleAllFiltered = () =>
    setEmployeeIds(prev =>
      allFilteredSelected
        ? prev.filter(id => !filteredEmployees.some(e => e.id === id))
        : Array.from(new Set([...prev, ...filteredEmployees.map(e => e.id)]))
    );

  const approvalConditions = useMemo(() => describeApprovalConditions(savedRules), [savedRules]);

  const rangeError =
    startDate && endDate && startDate > endDate ? 'Start Date must be on or before End Date' : '';
  const canStart = employeeIds.length > 0 && !!startDate && !!endDate && !rangeError && !rulesDirty && !progress;

  const invalidateEntries = () =>
    queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/time-entries'),
    });

  const saveRulesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PUT', '/api/timesheet-validation-rules', { adminId: user.id, rules });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData([VALIDATION_RULES_QUERY_KEY], data);
      setDraftRules(null);
      toast({ title: 'Approval conditions saved', description: 'They now apply to timesheet submission and approval.' });
    },
    onError: (err: any) =>
      toast({ title: 'Could not save rules', description: String(err?.message || err), variant: 'destructive' }),
  });

  // Replace one date of one employee's result and keep totals in sync.
  const patchDate = (employeeId: string, date: string, fn: (d: ReviewDate) => ReviewDate) =>
    setResults(prev => prev.map(r => {
      if (r.employeeId !== employeeId) return r;
      const dates = r.dates.map(d => (d.date === date ? fn(d) : d));
      return { ...r, dates, totals: recomputeTotals(dates) };
    }));

  // Auto review: each selected employee is evaluated against the saved conditions, one after another.
  const runReview = async () => {
    setResults([]);
    setFailures([]);
    setProgress({ done: 0, total: employeeIds.length });
    const collected: ReviewResult[] = [];
    const failed: { employeeId: string; name: string; error: string }[] = [];
    for (let i = 0; i < employeeIds.length; i++) {
      const id = employeeIds[i];
      try {
        const res = await apiRequest('POST', '/api/time-entries/admin-review', {
          adminId: user.id, employeeId: id, startDate, endDate,
        });
        collected.push((await res.json()) as ReviewResult);
      } catch (err: any) {
        const emp = activeEmployees.find(e => e.id === id);
        failed.push({ employeeId: id, name: emp ? `${emp.name} (${emp.employeeCode})` : id, error: String(err?.message || err) });
      }
      setResults([...collected]);
      setFailures([...failed]);
      setProgress({ done: i + 1, total: employeeIds.length });
    }
    setProgress(null);
    invalidateEntries();
    const t = collected.reduce((a, r) => ({
      approved: a.approved + r.totals.approved, rejected: a.rejected + r.totals.rejected, skipped: a.skipped + r.totals.skipped,
    }), { approved: 0, rejected: 0, skipped: 0 });
    toast({
      title: 'Review complete',
      description: `${collected.length} employee(s): ${t.approved} approved, ${t.rejected} rejected, ${t.skipped} skipped${failed.length ? `, ${failed.length} failed` : ''}`,
      variant: failed.length ? 'destructive' : undefined,
    });
  };

  const approveDate = async (r: ReviewResult, date: string) => {
    const key = `approve:${r.employeeId}:${date}`;
    setBusyKey(key);
    try {
      const res = await apiRequest('POST', '/api/time-entries/admin-review/approve-date', {
        adminId: user.id, employeeId: r.employeeId, date, startDate: r.startDate, endDate: r.endDate,
      });
      const data = (await res.json()) as { date: string; entries: ReviewRow[] };
      patchDate(r.employeeId, date, d => ({
        ...d,
        entries: d.entries.map(e => data.entries.find(x => x.id === e.id) ?? e),
      }));
      invalidateEntries();
      const approved = data.entries.filter(e => e.result === 'approved').length;
      const blocked = data.entries.filter(e => e.result === 'blocked').length;
      toast({
        title: blocked ? `${r.employeeName}: ${date} partly approved` : `${r.employeeName}: ${date} approved`,
        description: blocked
          ? `${approved} approved, ${blocked} did not meet the approval conditions (see reasons).`
          : `${approved} entr${approved === 1 ? 'y' : 'ies'} approved.`,
        variant: blocked && approved === 0 ? 'destructive' : undefined,
      });
    } catch (err: any) {
      toast({ title: 'Approve failed', description: String(err?.message || err), variant: 'destructive' });
    } finally {
      setBusyKey(null);
    }
  };

  const rejectDate = async () => {
    if (!rejectTarget) return;
    const r = results.find(x => x.employeeId === rejectTarget.employeeId);
    if (!r) return;
    const key = `reject:${r.employeeId}:${rejectTarget.date}`;
    setBusyKey(key);
    try {
      const res = await apiRequest('POST', '/api/time-entries/admin-review/reject-date', {
        adminId: user.id, employeeId: r.employeeId, date: rejectTarget.date,
        startDate: r.startDate, endDate: r.endDate, reason: rejectReason.trim(),
      });
      const data = (await res.json()) as { date: string; rejectedIds: string[]; reason: string; emailSent: boolean; emailNote?: string };
      patchDate(r.employeeId, data.date, d => ({
        ...d,
        emailSent: data.emailSent,
        emailNote: data.emailNote,
        entries: d.entries.map(e =>
          data.rejectedIds.includes(e.id)
            ? { ...e, result: 'rejected' as const, currentStatus: 'rejected', reasons: [data.reason] }
            : e
        ),
      }));
      invalidateEntries();
      toast({ title: `${r.employeeName}: ${data.date} rejected`, variant: 'destructive' });
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: any) {
      toast({ title: 'Reject failed', description: String(err?.message || err), variant: 'destructive' });
    } finally {
      setBusyKey(null);
    }
  };

  const downloadReport = () => {
    if (results.length === 0) return;
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Employee', 'Project', 'Task', 'Result', 'Reason'].map(esc).join(',')];
    for (const r of results) {
      for (const d of r.dates) {
        for (const e of d.entries) {
          lines.push([d.date, `${r.employeeName} (${r.employeeCode})`, e.project, e.task, e.result, e.reasons.join('; ')].map(esc).join(','));
        }
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-approval-${startDate}_to_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const grand = results.reduce((a, r) => ({
    dates: a.dates + r.totals.dates, approved: a.approved + r.totals.approved,
    rejected: a.rejected + r.totals.rejected, skipped: a.skipped + r.totals.skipped,
  }), { dates: 0, approved: 0, rejected: 0, skipped: 0 });
  const rejectEmployee = rejectTarget ? results.find(r => r.employeeId === rejectTarget.employeeId) : null;

  return (
    <div className="space-y-4">
      <Card className="bg-slate-800/60 border-blue-500/20 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-blue-300">Employees (select one or more)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between bg-slate-900/50 border-blue-500/20 text-white h-9 font-normal hover:bg-slate-900">
                  <span className="truncate">
                    {selectedEmployees.length === 0
                      ? 'Select employees'
                      : selectedEmployees.length === 1
                        ? `${selectedEmployees[0].name} (${selectedEmployees[0].employeeCode})`
                        : `${selectedEmployees.length} employees selected`}
                  </span>
                  <ChevronDown className="w-4 h-4 opacity-60 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-2 bg-slate-900 border-blue-500/20">
                <Input
                  placeholder="Search name or code..."
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="bg-slate-800 border-blue-500/20 text-white h-8 mb-2"
                />
                <div className="flex items-center justify-between px-1 pb-2 border-b border-blue-500/10">
                  <label className="flex items-center gap-2 text-xs text-blue-100 cursor-pointer">
                    <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} className="border-blue-500/30" />
                    Select all{employeeSearch ? ' (filtered)' : ''}
                  </label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px] text-blue-400" onClick={() => setEmployeeIds([])} disabled={employeeIds.length === 0}>
                    Clear
                  </Button>
                </div>
                <div className="max-h-64 overflow-y-auto pt-1">
                  {filteredEmployees.length === 0 && <p className="text-xs text-blue-200/40 text-center py-4">No employees found</p>}
                  {filteredEmployees.map(e => (
                    <label key={e.id} className="flex items-center gap-2 px-1 py-1.5 rounded hover:bg-blue-500/10 cursor-pointer text-xs text-white">
                      <Checkbox checked={employeeIds.includes(e.id)} onCheckedChange={() => toggleEmployee(e.id)} className="border-blue-500/30" />
                      <span className="truncate">{e.name}</span>
                      <span className="text-blue-200/40 ml-auto shrink-0">{e.employeeCode}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {selectedEmployees.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {selectedEmployees.slice(0, 6).map(e => (
                  <Badge key={e.id} className="bg-blue-500/15 text-blue-200 border border-blue-500/20 text-[10px] gap-1 pr-1">
                    {e.name}
                    <button type="button" aria-label={`Remove ${e.name}`} onClick={() => toggleEmployee(e.id)}><X className="w-3 h-3" /></button>
                  </Badge>
                ))}
                {selectedEmployees.length > 6 && <span className="text-[10px] text-blue-200/50 self-center">+{selectedEmployees.length - 6} more</span>}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-blue-300">Start Date</Label>
            <Input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-900/50 border-blue-500/20 text-white h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-blue-300">End Date</Label>
            <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-900/50 border-blue-500/20 text-white h-9" />
          </div>
        </div>
        {rangeError && <p className="text-xs text-red-400">{rangeError}</p>}

        {/* Exact conditions for Approval and Rejection (read from the saved rules) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-green-500/25 bg-green-500/5 p-3">
            <p className="text-xs font-bold uppercase text-green-400 mb-1.5 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Conditions for Approval</p>
            <p className="text-[11px] text-blue-200/60 mb-2">An entry is approved only when it is submitted (status pending, resubmitted or manager approved) and ALL of these are met:</p>
            {approvalConditions.length === 0 ? (
              <p className="text-[11px] text-blue-200/50">No field is mandatory at approval, so every eligible entry is approved.</p>
            ) : (
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-green-100/90">
                {approvalConditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3">
            <p className="text-xs font-bold uppercase text-red-400 mb-1.5 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Conditions for Rejection</p>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-red-100/90">
              <li>Automatic: an eligible entry is rejected when ANY approval condition on the left is not met. The exact failed conditions are saved as the rejection reason and emailed to the employee.</li>
              <li>Manual: the Reject button on an employee's date rejects every non-rejected entry of that date. A written reason is mandatory.</li>
              <li>Not changed: drafts and entries already approved, rejected or on hold are skipped.</li>
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-blue-500/15">
          <button type="button" onClick={() => setShowRules(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/5">
            <span>Configure approval conditions {rulesDirty && <span className="text-yellow-400 font-normal ml-2">(unsaved changes)</span>}</span>
            {showRules ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showRules && <div className="px-3 pb-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label className="text-xs text-blue-300">Configure approval conditions (mandatory fields)</Label>
                  <p className="text-[11px] text-blue-200/50">
                    Switch a field on to make it mandatory. Mandatory text fields need at least {TIMESHEET_MIN_CHARS} characters of real content; Tools Used, Key Step and Subtask only need to be filled.
                    Optional fields are accepted when empty. Saved rules apply automatically when employees submit and when you approve.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {rulesRecord?.updatedAt && !rulesDirty && (
                    <span className="text-[10px] text-blue-200/40">
                      Saved {format(new Date(rulesRecord.updatedAt), 'dd MMM yyyy, hh:mm a')}{rulesRecord.updatedBy ? ` by ${rulesRecord.updatedBy}` : ''}
                    </span>
                  )}
                  {rulesDirty && <span className="text-[10px] text-yellow-400">Unsaved changes</span>}
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px] text-blue-400 hover:text-white"
                    onClick={() => setDraftRules(DEFAULT_VALIDATION_RULES)}>
                    Reset to defaults
                  </Button>
                  {rulesDirty && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px] text-slate-300" onClick={() => setDraftRules(null)}>
                      Discard
                    </Button>
                  )}
                  <Button type="button" size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-500" disabled={!rulesDirty || saveRulesMutation.isPending}
                    onClick={() => saveRulesMutation.mutate()}>
                    {saveRulesMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                    Save rules
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/10 bg-slate-900/40 px-3">
                <div className="grid grid-cols-[minmax(150px,1.2fr)_90px_90px_minmax(0,2fr)] gap-x-3 py-2 border-b border-blue-500/20 text-[10px] font-bold uppercase text-blue-400">
                  <span>Field</span>
                  <span className="text-center">Mandatory at submission</span>
                  <span className="text-center">Mandatory at approval</span>
                  <span>Options</span>
                </div>
                <RuleRow label="Quantify Your Result" submit={rules.quantify.submit} approve={rules.quantify.approve}
                  onSubmit={(v) => setRule('quantify', { submit: v })} onApprove={(v) => setRule('quantify', { approve: v })}>
                  <NumField label="Max words" max={200} value={rules.quantify.maxWords} onChange={(v) => setRule('quantify', { maxWords: v })} />
                  <ToggleField label='Must contain a number (e.g. "5 reports")' checked={rules.quantify.requireNumber} onChange={(v) => setRule('quantify', { requireNumber: v })} />
                </RuleRow>
                <RuleRow label="Achievements" submit={rules.achievements.submit} approve={rules.achievements.approve}
                  onSubmit={(v) => setRule('achievements', { submit: v })} onApprove={(v) => setRule('achievements', { approve: v })}>
                  <NumField label="Max words" max={200} value={rules.achievements.maxWords} onChange={(v) => setRule('achievements', { maxWords: v })} />
                  <ToggleField label="If empty, a valid Problems & Issues can replace it" checked={rules.achievements.allowProblemsInstead} onChange={(v) => setRule('achievements', { allowProblemsInstead: v })} />
                </RuleRow>
                <RuleRow label="Problems & Issues" hint="Mandatory on its own" submit={rules.problemAndIssues.submit} approve={rules.problemAndIssues.approve}
                  onSubmit={(v) => setRule('problemAndIssues', { submit: v })} onApprove={(v) => setRule('problemAndIssues', { approve: v })} />
                <RuleRow label="Description" submit={rules.description.submit} approve={rules.description.approve}
                  onSubmit={(v) => setRule('description', { submit: v })} onApprove={(v) => setRule('description', { approve: v })}>
                  <NumField label="Max words" max={200} value={rules.description.maxWords} onChange={(v) => setRule('description', { maxWords: v })} />
                </RuleRow>
                <RuleRow label="Tools Used" hint="Just needs to be filled" submit={rules.toolsUsed.submit} approve={rules.toolsUsed.approve}
                  onSubmit={(v) => setRule('toolsUsed', { submit: v })} onApprove={(v) => setRule('toolsUsed', { approve: v })} />
                <RuleRow label="Completion %" submit={rules.percentageComplete.submit} approve={rules.percentageComplete.approve}
                  onSubmit={(v) => setRule('percentageComplete', { submit: v })} onApprove={(v) => setRule('percentageComplete', { approve: v })}>
                  <NumField label="Minimum %" max={100} value={rules.percentageComplete.minValue} onChange={(v) => setRule('percentageComplete', { minValue: v })} />
                </RuleRow>
                <RuleRow label="Key Step" hint="Just needs to be filled" submit={rules.keyStep.submit} approve={rules.keyStep.approve}
                  onSubmit={(v) => setRule('keyStep', { submit: v })} onApprove={(v) => setRule('keyStep', { approve: v })} />
                <RuleRow label="Subtask" hint="Just needs to be filled" submit={rules.subTask.submit} approve={rules.subTask.approve}
                  onSubmit={(v) => setRule('subTask', { submit: v })} onApprove={(v) => setRule('subTask', { approve: v })} />
                <RuleRow label="Scope of Improvements" submit={rules.scopeOfImprovements.submit} approve={rules.scopeOfImprovements.approve}
                  onSubmit={(v) => setRule('scopeOfImprovements', { submit: v })} onApprove={(v) => setRule('scopeOfImprovements', { approve: v })} />
              </div>
            </div>

          </div>}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={runReview} disabled={!canStart} className="bg-blue-600 hover:bg-blue-500">
            {progress ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {progress ? `Reviewing ${progress.done}/${progress.total}...` : `Run auto review${employeeIds.length > 1 ? ` (${employeeIds.length} employees)` : ''}`}
          </Button>
          <p className="text-[11px] text-blue-200/50">
            Applies the conditions above to every selected employee's submitted timesheets between the Start and End Date (inclusive).
            You can then Approve or Reject each employee and date separately below.
            {rulesDirty ? ' Save the rules before running.' : ''}
          </p>
        </div>
      </Card>

      {failures.length > 0 && (
        <Card className="bg-red-500/5 border-red-500/20 p-3 space-y-1">
          <p className="text-xs font-bold text-red-400">Could not process {failures.length} employee(s)</p>
          {failures.map(f => <p key={f.employeeId} className="text-[11px] text-red-200/80">{f.name}: {f.error}</p>)}
        </Card>
      )}

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="bg-slate-800/40 border-blue-500/10 p-3 text-center">
              <span className="text-[10px] text-blue-400 font-bold uppercase block mb-1">Employees</span>
              <span className="text-xl font-bold text-white">{results.length}</span>
            </Card>
            <Card className="bg-slate-800/40 border-blue-500/10 p-3 text-center">
              <span className="text-[10px] text-blue-400 font-bold uppercase block mb-1">Dates</span>
              <span className="text-xl font-bold text-white">{grand.dates}</span>
            </Card>
            <Card className="bg-green-500/5 border-green-500/20 p-3 text-center">
              <span className="text-[10px] text-green-400 font-bold uppercase block mb-1">Approved</span>
              <span className="text-xl font-bold text-green-400">{grand.approved}</span>
            </Card>
            <Card className="bg-red-500/5 border-red-500/20 p-3 text-center">
              <span className="text-[10px] text-red-400 font-bold uppercase block mb-1">Rejected</span>
              <span className="text-xl font-bold text-red-400">{grand.rejected}</span>
            </Card>
            <Card className="bg-slate-500/5 border-slate-500/20 p-3 text-center">
              <span className="text-[10px] text-slate-300 font-bold uppercase block mb-1">Unchanged</span>
              <span className="text-xl font-bold text-slate-300">{grand.skipped}</span>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-blue-200/60">{startDate} → {endDate} · status below is per employee and date</p>
            <Button size="sm" variant="outline" onClick={downloadReport} className="bg-slate-800 border-blue-500/20 text-blue-300">
              <Download className="w-4 h-4 mr-2" /> Download report (CSV)
            </Button>
          </div>

          <div className="space-y-5">
            {results.map(r => (
              <div key={r.employeeId} className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 border-b border-blue-500/15 pb-1.5">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold text-white">{r.employeeName} ({r.employeeCode})</span>
                  <span className="text-[11px] text-green-400">{r.totals.approved} approved</span>
                  <span className="text-[11px] text-red-400">{r.totals.rejected} rejected</span>
                  <span className="text-[11px] text-slate-400">{r.totals.skipped} unchanged</span>
                </div>
                {r.dates.length === 0 ? (
                  <div className="text-center py-6 bg-slate-800/20 rounded-lg border border-dashed border-blue-500/20">
                    <AlertCircle className="w-6 h-6 text-blue-500/40 mx-auto mb-1" />
                    <p className="text-sm text-blue-200/40">No submitted timesheets in the selected range.</p>
                  </div>
                ) : r.dates.map(d => {
                  const status = reviewDateStatus(d);
                  const canReject = d.entries.some(e => e.result !== 'rejected');
                  const canApprove = d.entries.some(e => e.result !== 'approved' && e.result !== 'rejected' && ['pending', 'resubmitted', 'manager_approved'].includes(e.currentStatus));
                  const approving = busyKey === `approve:${r.employeeId}:${d.date}`;
                  const rejecting = busyKey === `reject:${r.employeeId}:${d.date}`;
                  return (
                    <Card key={d.date} className="bg-slate-800/40 border-blue-500/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="flex items-center text-xs text-green-400 font-bold bg-green-500/15 px-2 py-1 rounded-md border border-green-500/20">
                            <CalendarIcon className="w-3 h-3 mr-1.5" /> {format(parseISO(d.date), 'EEE, MMM dd, yyyy')}
                          </span>
                          <Badge className={`uppercase text-[10px] px-2 py-0.5 border ${REVIEW_STATUS_STYLES[status]}`}>{REVIEW_STATUS_LABELS[status]}</Badge>
                          {d.emailSent && <span className="text-[10px] text-blue-300/60">email queued</span>}
                          {d.emailNote && <span className="text-[10px] text-orange-400">{d.emailNote}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" disabled={!canApprove || !!busyKey} className="h-8 text-xs px-4 bg-green-600 hover:bg-green-500"
                            onClick={() => approveDate(r, d.date)}>
                            {approving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" disabled={!canReject || !!busyKey} className="h-8 text-xs px-4"
                            onClick={() => { setRejectTarget({ employeeId: r.employeeId, date: d.date }); setRejectReason(''); }}>
                            {rejecting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <X className="w-3.5 h-3.5 mr-1.5" />}
                            Reject
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {d.entries.map(e => (
                          <div key={e.id} className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-slate-900/60 border border-blue-500/10">
                            <div className="min-w-0">
                              <p className="text-sm text-white font-medium">{e.project}</p>
                              <p className="text-[11px] text-blue-200/50">{e.task}</p>
                              {e.reasons.length > 0 && (
                                <ul className={`mt-1 text-[11px] list-disc list-inside ${e.result === 'rejected' ? 'text-red-300' : e.result === 'blocked' ? 'text-orange-300' : 'text-slate-400'}`}>
                                  {e.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                                </ul>
                              )}
                            </div>
                            <Badge className={`uppercase text-[10px] px-2 py-0.5 border shrink-0 ${REVIEW_STATUS_STYLES[e.result]}`}>{REVIEW_STATUS_LABELS[e.result] ?? e.result}</Badge>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(''); } }}>
        <DialogContent className="bg-slate-900 border-blue-500/20 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Reject {rejectTarget?.date}</DialogTitle>
            <DialogDescription className="text-blue-200/60 text-sm">
              Every timesheet entry of {rejectEmployee?.employeeName} on this date will be rejected and the employee will be emailed. They can then re-apply.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="bg-slate-800 border-blue-500/20 text-white min-h-[120px] focus:ring-blue-500/50"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => { setRejectTarget(null); setRejectReason(''); }}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!rejectReason.trim() || !!busyKey}
              onClick={rejectDate}
            >
              {busyKey?.startsWith('reject:') && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Sub-component to fetch and display LMS hours for a specific employee and date
function LMSHoursDisplay({ employeeCode, date }: { employeeCode: string; date: string }) {
  const { data: lmsHours } = useQuery<{ leaveHours: number; permissionHours: number; odHours: number; totalLMSHours: number; odWindows?: { from: string; to: string; isFullDay: boolean; durationType: string }[] }>({
    queryKey: ['/api/lms/hours', employeeCode, date],
    queryFn: async () => {
      const response = await fetch(`/api/lms/hours?employeeCode=${employeeCode}&date=${date}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!employeeCode && !!date,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });

  if (!lmsHours || lmsHours.totalLMSHours === 0) return null;

  const formatTime = (t?: string) => {
    if (!t) return '';
    const [hStr, mStr] = t.split(':');
    let h = parseInt(hStr, 10);
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${mStr} ${period}`;
  };
  const odWindow = lmsHours.odWindows?.[0];

  return (
    <div className="flex flex-wrap gap-2 mb-4 p-2 rounded-lg bg-blue-500/5 border border-blue-500/10 shadow-inner">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20">
        <Clock className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[9px] font-extrabold uppercase tracking-widest text-blue-300/60">LMS Data</span>
      </div>

      {lmsHours.leaveHours > 0 && (
        <Badge className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-none shadow-md shadow-blue-900/40 text-[10px] py-1 px-3 font-bold">
          <CalendarIcon className="w-3 h-3 mr-1.5" />
          Leave: {lmsHours.leaveHours}h
        </Badge>
      )}

      {lmsHours.permissionHours > 0 && (
        <Badge className="bg-gradient-to-r from-purple-600 to-pink-600 text-white border-none shadow-md shadow-purple-900/40 text-[10px] py-1 px-3 font-bold">
          <Zap className="w-3 h-3 mr-1.5" />
          Permission: {lmsHours.permissionHours}h
        </Badge>
      )}

      {lmsHours.odHours > 0 && (
        <Badge className="bg-gradient-to-r from-orange-600 to-amber-600 text-white border-none shadow-md shadow-orange-900/40 text-[10px] py-1 px-3 font-bold">
          <CalendarIcon className="w-3 h-3 mr-1.5" />
          OD: {lmsHours.odHours}h
          {odWindow && !odWindow.isFullDay ? ` (${formatTime(odWindow.from)} – ${formatTime(odWindow.to)})` : ''}
          {odWindow?.isFullDay ? ' (Full Day)' : ''}
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-2 px-3 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20">
        <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Total</span>
        <span className="text-sm font-black text-white">{lmsHours.totalLMSHours}h</span>
      </div>
    </div>
  );
}