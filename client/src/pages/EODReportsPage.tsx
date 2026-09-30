import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Download,
  Search,
  Calendar as CalendarIcon,
  Filter,
  Eye,
  Loader2,
  FileSpreadsheet,
  AlertCircle,
  ClipboardCheck,
  Clock
} from "lucide-react";
import { format, isSameDay, startOfDay } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { User } from '@/context/AuthContext';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRange } from "react-day-picker";

interface EODReportEntry {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  email: string;
  department: string;
  date: string;
  status: 'Submitted' | 'Not Submitted' | 'Incomplete';
  workingHours: string;
  requiredHours: number;
  remark: string;
  entries: any[];
}

interface EODReportsPageProps {
  user: User;
}

export default function EODReportsPage({ user }: EODReportsPageProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isDrillDownOpen, setIsDrillDownOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EODReportEntry | null>(null);

  const { data: reportData = [], isLoading } = useQuery<EODReportEntry[]>({
    queryKey: ['/api/reports/eod', dateRange?.from, dateRange?.to],
    queryFn: async () => {
      if (!dateRange?.from) return [];

      let url = `/api/reports/eod`;
      if (dateRange.to && !isSameDay(dateRange.from, dateRange.to)) {
        url += `?startDate=${format(dateRange.from, 'yyyy-MM-dd')}&endDate=${format(dateRange.to, 'yyyy-MM-dd')}`;
      } else {
        url += `?date=${format(dateRange.from, 'yyyy-MM-dd')}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch EOD report');
      return res.json();
    },
    enabled: !!dateRange?.from
  });

  const filteredData = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    return reportData.filter(item => {
      const matchesSearch =
        (item.employeeName?.toLowerCase() || "").includes(searchLower) ||
        (item.employeeCode?.toLowerCase() || "").includes(searchLower) ||
        (item.email?.toLowerCase() || "").includes(searchLower);
      const matchesDept = departmentFilter === 'all' || item.department === departmentFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesSearch && matchesDept && matchesStatus;
    });
  }, [reportData, searchQuery, departmentFilter, statusFilter]);

  const activeEntries = filteredData.filter(d => d.status !== 'Not Submitted');
  const missingEntries = filteredData.filter(d => d.status === 'Not Submitted');

  const stats = useMemo(() => {
    const total = reportData.length;
    const submitted = reportData.filter(d => d.status === 'Submitted').length;
    const notSubmitted = reportData.filter(d => d.status === 'Not Submitted').length;
    const incomplete = reportData.filter(d => d.status === 'Incomplete').length;
    const compliance = total > 0 ? (submitted / total) * 100 : 0;
    const totalHoursLogged = reportData.reduce((acc, d) => acc + parseFloat(d.workingHours), 0);
    const avgHours = total > 0 ? totalHoursLogged / total : 0;

    return { total, submitted, notSubmitted, incomplete, compliance, avgHours };
  }, [reportData]);

  const departments = useMemo(() => {
    const depts = new Set<string>();
    reportData.forEach(d => depts.add(d.department));
    return Array.from(depts).sort();
  }, [reportData]);

  const handleExport = () => {
    const exportData = filteredData.map(d => ({
      'Employee Name': d.employeeName,
      'Email': d.email,
      'Department': d.department,
      'Date': d.date,
      'Status': d.status,
      'Working Hours': d.workingHours,
      'Required Hours': d.requiredHours,
      'Remark': d.remark
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EOD Report");
    XLSX.writeFile(wb, `EOD_Report_${format(dateRange?.from || new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Submitted':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Submitted ✅</Badge>;
      case 'Not Submitted':
        return <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">Not Submitted ❌</Badge>;
      case 'Incomplete':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Incomplete ⚠️</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-8 bg-slate-950 min-h-screen text-slate-200" data-testid="eod-reports-page">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/20">
              <ClipboardCheck className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl" style={{ fontFamily: 'Space Grotesk' }}>
              EOD Reports
            </h1>
          </div>
          <p className="text-slate-400 max-w-2xl">
            Real-time monitoring of daily timesheet compliance and work hour statistics across the organization.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="flex-1 lg:flex-none justify-start bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 transition-all hover:border-slate-700">
                <CalendarIcon className="mr-2 h-4 w-4 text-blue-400" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, y") + " - " + format(dateRange.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-slate-900 border-slate-800 shadow-2xl" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                className="bg-slate-900 text-slate-200"
              />
            </PopoverContent>
          </Popover>

          <Button
            onClick={handleExport}
            className="flex-1 lg:flex-none bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-lg shadow-emerald-900/20 transition-all"
            disabled={filteredData.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export to Excel
          </Button>
        </div>
      </div>

      {/* KPI Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          { title: "Total Employees", value: stats.total, icon: Users, color: "blue", sub: "Registered staff", cardClass: "eod-card-blue" },
          { title: "Submitted", value: stats.submitted, icon: CheckCircle2, color: "emerald", sub: "Full compliance", cardClass: "eod-card-green" },
          { title: "Incomplete", value: stats.incomplete, icon: AlertTriangle, color: "amber", sub: "Logged < 8h", cardClass: "eod-card-amber" },
          { title: "Not Submitted", value: stats.notSubmitted, icon: XCircle, color: "rose", sub: "Missing today", cardClass: "eod-card-red" },
          {
            title: "Compliance %",
            value: `${stats.compliance.toFixed(1)}%`,
            icon: TrendingUp,
            color: stats.compliance < 80 ? "rose" : "purple",
            sub: "Organization target: 80%",
            alert: stats.compliance < 80,
            cardClass: "eod-card-purple"
          },
          { title: "Avg Hours", value: `${stats.avgHours.toFixed(1)}h`, icon: AlertTriangle, color: "amber", sub: "Logged today", cardClass: "eod-card-cyan" }
        ].map((kpi, i) => (
          <Card key={i} className={`bg-slate-900/40 border-slate-800/60 backdrop-blur-xl relative overflow-hidden group hover:border-slate-700/80 transition-all eod-stat-card ${kpi.cardClass}`}>
            <div className={`absolute right-[12px] top-[12px] opacity-15 text-${kpi.color}-400`}>
              <kpi.icon className="w-[40px] h-[40px]" />
            </div>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{kpi.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2">
                <div className={`text-2xl font-bold flex items-center gap-2 ${kpi.alert ? 'text-rose-500' : 'text-slate-100'}`}>
                  {kpi.value}
                  {kpi.alert && <AlertCircle className="h-5 w-5 animate-pulse" />}
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{kpi.sub}</p>
            </CardContent>
            {kpi.alert && <div className="absolute bottom-0 left-0 right-0 h-1 bg-rose-500/50" />}
          </Card>
        ))}
      </div>

      {/* Warning Badge for Compliance */}
      {stats.compliance < 80 && stats.total > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex items-center gap-4 animate-in fade-in slide-in-from-top-2 duration-500 eod-alert-card">
          <div className="p-2 bg-rose-500 rounded-full">
            <AlertCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h4 className="font-bold text-rose-400">Critical Compliance Alert</h4>
            <p className="text-sm text-rose-300/70">Current submission rate is below the 80% threshold. Immediate follow-up required.</p>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <Card className="bg-slate-900/40 border-slate-800/60 backdrop-blur-md sticky top-0 z-10 shadow-2xl overflow-visible eod-filter-bar">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
            <Input
              placeholder="Search by name, email or code..."
              className="pl-10 bg-slate-950/50 border-slate-800 text-slate-300 focus-visible:ring-blue-500/50 focus-visible:border-blue-500/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-full md:w-[180px] bg-slate-950/50 border-slate-800 text-slate-300">
                <Filter className="mr-2 h-3.5 w-3.5 text-blue-400" />
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(dept => (
                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-[180px] bg-slate-950/50 border-slate-800 text-slate-300">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Submitted">Submitted 🟢</SelectItem>
                <SelectItem value="Incomplete">Incomplete 🟡</SelectItem>
                <SelectItem value="Not Submitted">Not Submitted 🔴</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="p-24 flex flex-col items-center justify-center space-y-4 bg-slate-900/40 border border-slate-800/60 rounded-xl">
          <div className="relative">
            <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
            <div className="absolute inset-0 blur-xl bg-blue-500/20 animate-pulse" />
          </div>
          <p className="text-slate-400 font-medium">Crunching organization data...</p>
        </div>
      ) : filteredData.length === 0 ? (
        <Card className="bg-slate-900/40 border-slate-800/60 p-24 text-center">
          <div className="inline-flex p-6 rounded-full bg-slate-950 border border-slate-800 mb-6">
            <FileSpreadsheet className="h-10 w-10 text-slate-700" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Records Found</h3>
          <p className="text-slate-500 max-w-xs mx-auto text-sm">We couldn't find any employees matching your current filter criteria.</p>
          <Button variant="ghost" className="text-blue-400 hover:text-blue-300 underline mt-4" onClick={() => { setSearchQuery(''); setDepartmentFilter('all'); setStatusFilter('all'); }}>
            Clear all filters
          </Button>
        </Card>
      ) : (
        <div className="space-y-12">
          {/* Section 1: Active Submissions */}
          {(statusFilter === 'all' || statusFilter === 'Submitted' || statusFilter === 'Incomplete') && activeEntries.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h2 className="text-xl font-bold text-white uppercase tracking-wider text-sm">Activity Logs: Submitted & Incomplete</h2>
                <Badge variant="outline" className="ml-2 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{activeEntries.length}</Badge>
              </div>
              <Card className="bg-slate-900/40 border-slate-800/60 overflow-hidden shadow-2xl backdrop-blur-md eod-table-card">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-950/80">
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400 font-bold py-5 px-6">Employee Info</TableHead>
                        <TableHead className="text-slate-400 font-bold">Department</TableHead>
                        <TableHead className="text-slate-400 font-bold text-center">Date</TableHead>
                        <TableHead className="text-slate-400 font-bold text-center">Status</TableHead>
                        <TableHead className="text-slate-400 font-bold text-right pr-6">Hours Logged</TableHead>
                        <TableHead className="text-slate-400 font-bold">Status Remark</TableHead>
                        <TableHead className="text-slate-400 font-bold text-right pr-8">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeEntries.map((row) => {
                        const hoursNum = parseFloat(row.workingHours);
                        const isUnderHours = hoursNum < row.requiredHours;
                        return (
                          <TableRow key={row.employeeId + row.date} className="border-slate-800/60 hover:bg-slate-800/40 transition-all group eod-row-card">
                            <TableCell className="py-4 px-6">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm bg-slate-800 border border-slate-700 text-blue-400 shadow-inner group-hover:scale-110 transition-transform">
                                  {row.employeeName.charAt(0)}
                                </div>
                                <div>
                                  <div className="font-bold text-slate-100 group-hover:text-blue-400 transition-colors">
                                    {row.employeeName}
                                    {row.employeeCode === user.employeeCode && (
                                      <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-md font-normal">YOU</span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono uppercase tracking-tighter">{row.employeeCode} • {row.email}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="bg-slate-950/50 border-slate-800 text-slate-400 font-normal">
                                {row.department}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center text-slate-400 text-sm whitespace-nowrap">
                              {row.date}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(row.status)}
                            </TableCell>
                            <TableCell className="text-right font-bold tabular-nums pr-6">
                              <div className={`inline-flex items-center gap-1.5 ${isUnderHours ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {row.workingHours}h
                                <span className="text-[10px] text-slate-600 font-normal">/ {row.requiredHours}h</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-xs italic truncate max-w-[200px] text-slate-500">
                                {row.remark}
                              </div>
                            </TableCell>
                            <TableCell className="text-right pr-6 whitespace-nowrap">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 rounded-full transition-all"
                                onClick={() => {
                                  setSelectedEmployee(row);
                                  setIsDrillDownOpen(true);
                                }}
                              >
                                <Eye className="h-4.5 w-4.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}

          {/* Section 2: Missing Submissions */}
          {(statusFilter === 'all' || statusFilter === 'Not Submitted') && missingEntries.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <XCircle className="h-5 w-5 text-rose-400" />
                <h2 className="text-xl font-bold text-white uppercase tracking-wider text-sm">Missing Submissions: Not Submitted</h2>
                <Badge variant="outline" className="ml-2 bg-rose-500/10 text-rose-400 border-rose-500/20">{missingEntries.length}</Badge>
              </div>
              <Card className="bg-slate-900/40 border-slate-800/60 overflow-hidden shadow-2xl backdrop-blur-md eod-table-card">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-rose-950/10">
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400 font-bold py-5 px-6">Employee Info</TableHead>
                        <TableHead className="text-slate-400 font-bold">Department</TableHead>
                        <TableHead className="text-slate-400 font-bold text-center">Date</TableHead>
                        <TableHead className="text-slate-400 font-bold text-center">Status</TableHead>
                        <TableHead className="text-slate-400 font-bold">Status Remark</TableHead>
                        <TableHead className="text-slate-400 font-bold text-right pr-8">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {missingEntries.map((row) => (
                        <TableRow key={row.employeeId + row.date} className="border-slate-800/60 hover:bg-slate-800/40 transition-all group eod-row-card">
                          <TableCell className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm bg-slate-800 border border-slate-700 text-rose-400 shadow-inner group-hover:scale-110 transition-transform">
                                {row.employeeName.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-slate-100 group-hover:text-rose-400 transition-colors">
                                  {row.employeeName}
                                  {row.employeeCode === user.employeeCode && (
                                    <span className="ml-2 text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded-md font-normal">YOU</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono uppercase tracking-tighter">{row.employeeCode} • {row.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-slate-950/50 border-slate-800 text-slate-400 font-normal">
                              {row.department}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-slate-400 text-sm whitespace-nowrap">
                            {row.date}
                          </TableCell>
                          <TableCell className="text-center">
                            {getStatusBadge(row.status)}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs italic truncate max-w-[200px] text-rose-400/60">
                              {row.remark}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6 whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-full transition-all"
                              onClick={() => {
                                setSelectedEmployee(row);
                                setIsDrillDownOpen(true);
                              }}
                            >
                              <Eye className="h-4.5 w-4.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Drill Down Modal */}
      <Dialog open={isDrillDownOpen} onOpenChange={setIsDrillDownOpen}>
        <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-slate-100 shadow-2xl p-0 overflow-hidden outline-none">
          <div className="h-2 bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600" />

          <div className="p-8">
            <div className="mb-8">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <UserIcon className="h-7 w-7 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
                    {selectedEmployee?.employeeName}
                  </h3>
                  <p className="text-slate-400 text-sm">
                    Detailed Timesheet Log • {selectedEmployee?.date}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
              {[
                { label: "Employee Code", value: selectedEmployee?.employeeCode },
                { label: "Department", value: selectedEmployee?.department },
                { label: "Total Time Logged", value: `${selectedEmployee?.workingHours} hours`, primary: true }
              ].map((info, i) => (
                <div key={i} className={`p-4 rounded-xl border ${info.primary ? 'bg-blue-600/5 border-blue-500/30' : 'bg-slate-900 border-slate-800'}`}>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">{info.label}</p>
                  <p className={`font-semibold ${info.primary ? 'text-blue-400' : 'text-slate-200'}`}>{info.value}</p>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-bold text-slate-300">Work Activities Captured</h3>
                <Badge variant="outline" className="bg-slate-900 border-slate-800">{selectedEmployee?.entries?.length || 0} Entries</Badge>
              </div>

              <div className="max-h-[350px] overflow-y-auto pr-2 custom-scrollbar space-y-3">
                {selectedEmployee?.entries && selectedEmployee.entries.length > 0 ? (
                  selectedEmployee.entries.map((entry: any, idx: number) => (
                    <div key={idx} className="group p-4 bg-slate-900/40 rounded-xl border border-slate-800/80 hover:border-blue-500/30 transition-all hover:bg-slate-900/60">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                          <span className="text-sm font-bold text-slate-200 group-hover:text-blue-400 transition-colors uppercase tracking-tight">{entry.projectName}</span>
                        </div>
                        <div className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-500">
                          {entry.startTime} — {entry.endTime}
                        </div>
                      </div>

                      <p className="text-sm text-slate-400 leading-relaxed mb-4 bg-slate-950/30 p-2 rounded-md border border-slate-800/30">
                        {entry.taskDescription}
                      </p>

                      <div className="flex flex-wrap gap-4 items-center">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-slate-600" />
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Duration: <span className="text-slate-300 ml-1">{entry.totalHours}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="h-3 w-3 text-slate-600" />
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Progress: <span className="text-slate-300 ml-1">{entry.percentageComplete}%</span></span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-16 flex flex-col items-center justify-center bg-slate-900/30 rounded-2xl border-2 border-dashed border-slate-800/50">
                    <div className="p-4 rounded-full bg-slate-950 mb-4">
                      <AlertCircle className="h-8 w-8 text-slate-800" />
                    </div>
                    <p className="text-slate-500 text-sm font-medium">No work activity recorded today</p>
                    <p className="text-[10px] text-slate-600 mt-1 max-w-[180px] text-center">Employee has not yet submitted any tasks for this date.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-inner relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <TrendingUp className="h-12 w-12 text-blue-500" />
              </div>
              <div className="flex items-center gap-4 relative z-10">
                <div className={`p-2.5 rounded-xl ${parseFloat(selectedEmployee?.workingHours || "0") < 8 ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                  {parseFloat(selectedEmployee?.workingHours || "0") < 8 ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Gap Analysis / Insights</h4>
                  <p className="text-sm font-medium text-slate-300">
                    {parseFloat(selectedEmployee?.workingHours || "0") < 8
                      ? (selectedEmployee?.status === 'Not Submitted'
                        ? `Immediate attention required: No timesheet found. A full 8-hour shift is expected.`
                        : `Organization requirement check: Employee is ${8 - parseFloat(selectedEmployee?.workingHours || "0")} hours short of the mandatory daily shift.`)
                      : "Shift requirements fully met. Performance scorecard updated successfully. 🎉"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <Button onClick={() => setIsDrillDownOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white rounded-xl px-8 transition-all">
                Close Report
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const UserIcon = (props: any) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
