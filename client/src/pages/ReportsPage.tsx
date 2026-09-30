import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Search,
  Filter,
  RefreshCw,
  Download,
  Clock,
  Check,
  X,
  User as UserIcon,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Calendar as CalendarIcon,
  Loader2,
  MessageSquare
} from 'lucide-react';
import { User } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { TimeEntry, Employee } from '@shared/schema';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import reportsIllustration from '@/assets/animations/reports-illustration.png';
import reportsIllustrationDark from '@/assets/animations/reports-illustration-dark-v2.png';

interface ReportsPageProps {
  user: User;
}

export default function ReportsPage({ user }: ReportsPageProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [specificDate, setSpecificDate] = useState<Date | undefined>(undefined);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

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

  const getEmployeeInfo = (employeeId: string) => {
    return employees.find(e => e.id === employeeId);
  };

  const getApproverName = (approverId: string | null) => {
    if (!approverId) return 'N/A';
    const approver = employees.find(e => e.id === approverId);
    return approver ? approver.name : approverId;
  };

  const filteredEntries = timeEntries.filter(entry => {
    const matchesSearch =
      entry.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.employeeCode.toLowerCase().includes(searchQuery.toLowerCase());
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
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>;
      case 'manager_approved':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Manager Approved</Badge>;
      case 'approved':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>;
      case 'on_hold':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">On Hold</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const handleExportToExcel = () => {
    const exportData = filteredEntries.map(entry => ({
      'Employee Code': entry.employeeCode,
      'Employee Name': entry.employeeName,
      'Date': entry.date,
      'Project': entry.projectName,
      'Task': entry.taskDescription,
      'Start Time': entry.startTime,
      'End Time': entry.endTime,
      'Total Hours': entry.totalHours,
      'Completion %': entry.percentageComplete ?? 0,
      'Status': entry.status,
      'Manager Approved By': entry.managerApprovedBy ? getApproverName(entry.managerApprovedBy) : 'N/A',
      'Manager Approved At': entry.managerApprovedAt ? format(new Date(entry.managerApprovedAt), 'yyyy-MM-dd HH:mm') : 'N/A',
      'Admin Approved By': entry.approvedBy ? getApproverName(entry.approvedBy) : 'N/A',
      'Admin Approved At': entry.approvedAt ? format(new Date(entry.approvedAt), 'yyyy-MM-dd HH:mm') : 'N/A',
      'Rejection Reason': entry.rejectionReason || 'N/A',
      'Approval Comment': entry.approvalComment || 'N/A',
      'Submitted At': entry.submittedAt ? format(new Date(entry.submittedAt), 'yyyy-MM-dd HH:mm') : 'N/A',
    }));

    if (exportData.length === 0) {
      toast({
        title: "No Data",
        description: "There are no entries to export.",
        variant: "destructive",
      });
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [
      { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 40 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 15 },
      { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 30 },
      { wch: 30 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Timesheet Reports');
    XLSX.writeFile(wb, `TimesheetReports_${format(new Date(), 'yyyyMMdd')}.xlsx`);

    toast({
      title: "Export Successful",
      description: `Downloaded ${exportData.length} entries as Excel file.`,
    });
  };

  const totalApproved = timeEntries.filter(e => e.status === 'approved').length;
  const totalRejected = timeEntries.filter(e => e.status === 'rejected').length;
  const totalOnHold = timeEntries.filter(e => e.status === 'on_hold').length;
  const totalPending = timeEntries.filter(e => e.status === 'pending' || e.status === 'manager_approved').length;

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="reports-page">
      <Card className="reports-top-container relative py-4 px-6 overflow-hidden">
        {/* Header Row */}
        <div className="reports-header-row flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10 md:w-[70%]">
          <div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
              {isEmployee ? 'My Reports' : 'Timesheet Reports'}
            </h1>
            <p className="text-blue-200/60 text-sm">
              {isEmployee
                ? 'View your timesheet status, approvals, and detailed reports'
                : 'View employee timesheet status, approvals, and detailed reports'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="bg-slate-800 border-blue-500/20 text-white"
              onClick={() => refetch()}
              data-testid="button-refresh-reports"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              onClick={handleExportToExcel}
              className="bg-gradient-to-r from-green-600 to-emerald-600"
              disabled={filteredEntries.length === 0}
              data-testid="button-export-reports"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="reports-stats-row flex flex-wrap md:flex-nowrap gap-3 relative z-10 md:w-[70%] mt-4">
          <Card className="bg-slate-800/50 border-blue-500/20 p-4 reports-stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <FileSpreadsheet className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-blue-200/60">Total Entries</p>
                <p className="text-2xl font-bold text-blue-400">{timeEntries.length}</p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-800/50 border-green-500/20 p-4 reports-stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <Check className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-xs text-blue-200/60">Approved</p>
                <p className="text-2xl font-bold text-green-400">{totalApproved}</p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-800/50 border-yellow-500/20 p-4 reports-stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/20">
                <Clock className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-blue-200/60">Pending</p>
                <p className="text-2xl font-bold text-yellow-400">{totalPending}</p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-800/50 border-red-500/20 p-4 reports-stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/20">
                <X className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-xs text-blue-200/60">Rejected</p>
                <p className="text-2xl font-bold text-red-400">{totalRejected}</p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-800/50 border-orange-500/20 p-4 reports-stat-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Clock className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="text-xs text-blue-200/60">On Hold</p>
                <p className="text-2xl font-bold text-orange-400">{totalOnHold}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Illustration slot — light mode shows image, dark mode reserved */}
        <img
          src={reportsIllustration}
          alt="Reports illustration"
          className="reports-illustration-light"
          style={{ position: 'absolute', right: 0, bottom: 0, width: '300px', height: '220px', objectFit: 'contain', filter: 'invert(1) hue-rotate(180deg)', zIndex: 5 }}
        />
        {/* Dark mode illustration */}
        <img
          src={reportsIllustrationDark}
          alt="illustration"
          className="reports-illustration-dark"
          style={{
            width: '280px',
            height: '200px',
            objectFit: 'contain',
            position: 'absolute',
            right: '0',
            bottom: '0',
            zIndex: 5,
          }}
        />
      </Card>

      <Card className="bg-slate-800/50 border-blue-500/20 p-4 reports-filter-bar">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 w-full md:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
              <Input
                placeholder="Search by name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-700/50 border-blue-500/20 text-white"
                data-testid="input-search-reports"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="w-full sm:w-40 bg-slate-700/50 border-blue-500/20 text-white"
                data-testid="select-status-filter"
              >
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="manager_approved">Manager Approved</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateFilter} onValueChange={(v) => { setDateFilter(v); if (v !== 'all') setSpecificDate(undefined); }}>
              <SelectTrigger
                className="w-full sm:w-40 bg-slate-700/50 border-blue-500/20 text-white"
                data-testid="select-date-filter"
              >
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
                  data-testid="button-specific-date"
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full text-blue-300"
                      onClick={() => setSpecificDate(undefined)}
                    >
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
        <Card className="bg-slate-800/50 border-blue-500/20 p-12 text-center reports-stat-card">
          <FileSpreadsheet className="w-12 h-12 text-blue-400/40 mx-auto mb-4" />
          <p className="text-blue-200/60">No timesheet entries found.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {employeeList.map(group => {
            const isExpanded = expandedEmployee === group.employeeId;
            const approvedCount = group.entries.filter(e => e.status === 'approved').length;
            const rejectedCount = group.entries.filter(e => e.status === 'rejected').length;
            const onHoldCount = group.entries.filter(e => e.status === 'on_hold').length;
            const pendingCount = group.entries.filter(e => e.status === 'pending' || e.status === 'manager_approved').length;

            return (
              <Card
                key={group.employeeId}
                className="bg-slate-800/50 border-blue-500/20 overflow-hidden reports-employee-card"
                data-testid={`card-employee-${group.employeeId}`}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-slate-700/30 transition-colors"
                  onClick={() => setExpandedEmployee(isExpanded ? null : group.employeeId)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                        <UserIcon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{group.employeeName}</p>
                        <p className="text-sm text-blue-200/60">{group.employeeCode}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex gap-2">
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                          {approvedCount} Approved
                        </Badge>
                        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                          {pendingCount} Pending
                        </Badge>
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                          {rejectedCount} Rejected
                        </Badge>
                        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                          {onHoldCount} On Hold
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
                      <div
                        key={entry.id}
                        className="bg-slate-700/30 rounded-lg p-4 space-y-3 reports-entry-card"
                        data-testid={`entry-${entry.id}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              {getStatusBadge(entry.status || 'pending')}
                              <span className="text-sm text-blue-200/60">{entry.date}</span>
                            </div>
                            <p className="text-white font-medium">{entry.projectName}</p>
                            <p className="text-sm text-blue-200/80">{entry.taskDescription}</p>
                          </div>
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

                        {entry.status === 'approved' && (
                          <div className="bg-green-500/10 rounded p-3 space-y-2">
                            <p className="text-sm text-green-400 font-medium">Approval Details</p>
                            {entry.managerApprovedBy && (
                              <p className="text-xs text-blue-200/80">
                                Manager Approved by: {getApproverName(entry.managerApprovedBy)}
                                {entry.managerApprovedAt && ` on ${format(new Date(entry.managerApprovedAt), 'MMM d, yyyy HH:mm')}`}
                              </p>
                            )}
                            {entry.approvedBy && (
                              <p className="text-xs text-blue-200/80">
                                Admin Approved by: {getApproverName(entry.approvedBy)}
                                {entry.approvedAt && ` on ${format(new Date(entry.approvedAt), 'MMM d, yyyy HH:mm')}`}
                              </p>
                            )}
                            {entry.approvalComment && (
                              <p className="text-xs text-blue-200/80">
                                Comment: {entry.approvalComment}
                              </p>
                            )}
                          </div>
                        )}

                        {entry.status === 'manager_approved' && (
                          <div className="bg-blue-500/10 rounded p-3 space-y-2">
                            <p className="text-sm text-blue-400 font-medium">Manager Approved - Pending Admin</p>
                            {entry.managerApprovedBy && (
                              <p className="text-xs text-blue-200/80">
                                Manager: {getApproverName(entry.managerApprovedBy)}
                                {entry.managerApprovedAt && ` on ${format(new Date(entry.managerApprovedAt), 'MMM d, yyyy HH:mm')}`}
                              </p>
                            )}
                          </div>
                        )}

                        {entry.status === 'rejected' && (
                          <div className="bg-red-500/10 rounded p-3 space-y-2">
                            <p className="text-sm text-red-400 font-medium">Rejection Details</p>
                            <p className="text-xs text-blue-200/80">
                              Reason: {entry.rejectionReason || 'No reason provided'}
                            </p>
                            {entry.approvedBy && (
                              <p className="text-xs text-blue-200/80">
                                Rejected by: {getApproverName(entry.approvedBy)}
                                {entry.approvedAt && ` on ${format(new Date(entry.approvedAt), 'MMM d, yyyy HH:mm')}`}
                              </p>
                            )}
                          </div>
                        )}

                        {entry.status === 'on_hold' && (
                          <div className="bg-orange-500/10 rounded p-3 space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-sm text-orange-400 font-medium">On Hold Details</p>
                                <p className="text-xs text-blue-200/80 mt-1">
                                  Reason: {entry.onHoldReason || 'No reason provided'}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] bg-orange-500/10 border-orange-500/20 text-orange-400 hover:bg-orange-500/20"
                                onClick={() => window.location.href = `/discussion?entryId=${entry.id}`}
                              >
                                <MessageSquare className="w-3 h-3 mr-1" />
                                Discuss
                              </Button>
                            </div>
                            {entry.approvedBy && (
                              <p className="text-[10px] text-blue-200/40">
                                Put on hold by: {getApproverName(entry.approvedBy)}
                                {entry.approvedAt && ` on ${format(new Date(entry.approvedAt), 'MMM d, yyyy HH:mm')}`}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="text-xs text-blue-200/40">
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
    </div>
  );
}