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
  Search,
  Calendar as CalendarIcon,
  Filter,
  Loader2,
  FileSpreadsheet,
  Download,
  AlertCircle,
  Clock,
  UserX,
  Plane
} from "lucide-react";
import { format, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { User } from '@/context/AuthContext';
import * as XLSX from 'xlsx';
import { DateRange } from "react-day-picker";

interface MissingReportEntry {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  email: string;
  department: string;
  date: string;
  status: 'Submitted' | 'Missing' | 'On Leave' | 'Incomplete' | 'Not Submitted';
  workingHours: string;
  lmsHours: string;
  remark: string;
}

interface MissingReportsPageProps {
  user: User;
}

export default function MissingReportsPage({ user }: MissingReportsPageProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: reportData = [], isLoading } = useQuery<MissingReportEntry[]>({
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
      const data = await res.json();
      
      // Map statuses from the API to our Missing Report status labels
      return data.map((item: any) => ({
        ...item,
        status: item.status === 'Not Submitted' ? 'Missing' : item.status
      }));
    },
    enabled: !!dateRange?.from
  });

  const filteredData = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    return reportData.filter(item => {
      const matchesSearch =
        (item.employeeName?.toLowerCase() || "").includes(searchLower) ||
        (item.employeeCode?.toLowerCase() || "").includes(searchLower);
      const matchesDept = departmentFilter === 'all' || item.department === departmentFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      
      const itemEntries = (item as any).entries || [];
      const plannedProjects = (item as any).plannedProjects || [];
      
      const matchesProject = projectFilter === 'all' || 
        itemEntries.some((e: any) => e.projectName === projectFilter) ||
        plannedProjects.includes(projectFilter);

      return matchesSearch && matchesDept && matchesStatus && matchesProject;
    });
  }, [reportData, searchQuery, departmentFilter, statusFilter, projectFilter]);

  const stats = useMemo(() => {
    const total = reportData.length;
    const submitted = reportData.filter(d => d.status === 'Submitted').length;
    const missing = reportData.filter(d => d.status === 'Missing').length;
    const onLeave = reportData.filter(d => d.status === 'On Leave').length;
    
    return { total, submitted, missing, onLeave };
  }, [reportData]);

  const departments = useMemo(() => {
    const depts = new Set<string>();
    reportData.forEach(d => depts.add(d.department));
    return Array.from(depts).sort();
  }, [reportData]);

  const allProjects = useMemo(() => {
    const projs = new Set<string>();
    reportData.forEach(d => {
      const itemEntries = (d as any).entries || [];
      itemEntries.forEach((e: any) => {
        if (e.projectName) projs.add(e.projectName);
      });
      const planned = (d as any).plannedProjects || [];
      planned.forEach((p: string) => projs.add(p));
    });
    return Array.from(projs).sort();
  }, [reportData]);

  const handleExport = () => {
    const exportData = filteredData.map(d => ({
      'Employee Name': d.employeeName,
      'Employee Code': d.employeeCode,
      'Department': d.department,
      'Date': d.date,
      'Status': d.status,
      'Working Hours': d.workingHours,
      'Leave Hours': d.lmsHours,
      'Remark': d.remark
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Missing Report");
    XLSX.writeFile(wb, `Missing_Report_${format(dateRange?.from || new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Submitted':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Submitted ✅</Badge>;
      case 'Missing':
        return <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">Missing ❌</Badge>;
      case 'On Leave':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">On Leave ✈️</Badge>;
      case 'Incomplete':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Incomplete ⚠️</Badge>;
      case 'Sunday':
        return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">Sunday 🏖️</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-8 bg-slate-950 min-h-screen text-slate-200">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-600 rounded-lg shadow-lg shadow-rose-900/20">
              <UserX className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl" style={{ fontFamily: 'Space Grotesk' }}>
              Missing Submissions
            </h1>
          </div>
          <p className="text-slate-400 max-w-2xl">
            Identify employees who missed timesheet submissions or are on approved leave.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="flex-1 lg:flex-none justify-start bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 transition-all">
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
            <PopoverContent className="w-auto p-0 bg-slate-900 border-slate-800" align="end">
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
            onClick={() => setDateRange({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) })}
            variant="outline"
            className="bg-slate-900 border-slate-800 text-slate-300"
          >
            This Month
          </Button>

          <Button
            onClick={handleExport}
            className="flex-1 lg:flex-none bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-lg shadow-emerald-900/20"
            disabled={filteredData.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* KPI Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "Total Records", value: stats.total, icon: Users, color: "blue", className: "missing-card-blue" },
          { title: "Submitted", value: stats.submitted, icon: FileSpreadsheet, color: "emerald", className: "missing-card-green" },
          { title: "Missing", value: stats.missing, icon: UserX, color: "rose", className: "missing-card-red" },
          { title: "On Leave", value: stats.onLeave, icon: Plane, color: "blue", className: "missing-card-amber" },
        ].map((kpi, i) => (
          <Card key={i} className={`bg-slate-900/40 border-slate-800/60 backdrop-blur-xl group hover:border-slate-700/80 transition-all missing-stat-card ${kpi.className}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{kpi.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-slate-100">{kpi.value}</div>
                <kpi.icon className={`h-8 w-8 text-${kpi.color}-500/50`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Control Panel */}
      <Card className="bg-slate-900/40 border-slate-800/60 backdrop-blur-md sticky top-0 z-10 shadow-2xl">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search by name or code..."
              className="pl-10 bg-slate-950/50 border-slate-800 text-slate-300"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-full md:w-[180px] bg-slate-950/50 border-slate-800 text-slate-300">
                <Filter className="mr-2 h-3.5 w-3.5 text-blue-400" />
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(dept => (
                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-full md:w-[180px] bg-slate-950/50 border-slate-800 text-slate-300">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                <SelectItem value="all">All Projects</SelectItem>
                {allProjects.map(proj => (
                  <SelectItem key={proj} value={proj}>{proj}</SelectItem>
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
                <SelectItem value="Missing">Missing 🔴</SelectItem>
                <SelectItem value="On Leave">On Leave 🔵</SelectItem>
                <SelectItem value="Incomplete">Incomplete 🟡</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table Section */}
      {isLoading ? (
        <div className="p-24 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
          <p className="text-slate-400 font-medium">Loading reports...</p>
        </div>
      ) : (
        <Card className="bg-slate-900/40 border-slate-800/60 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-950/80">
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-400 font-bold py-5 px-6">Employee</TableHead>
                  <TableHead className="text-slate-400 font-bold">Department</TableHead>
                  <TableHead className="text-slate-400 font-bold text-center">Date</TableHead>
                  <TableHead className="text-slate-400 font-bold text-center">Status</TableHead>
                  <TableHead className="text-slate-400 font-bold text-right pr-6">Hours (W / L)</TableHead>
                  <TableHead className="text-slate-400 font-bold">Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((row, idx) => (
                  <TableRow key={`${row.employeeId}-${row.date}-${idx}`} className="border-slate-800/60 hover:bg-slate-800/40 transition-all">
                    <TableCell className="py-4 px-6">
                      <div className="font-bold text-slate-100">{row.employeeName}</div>
                      <div className="text-[10px] text-slate-500 font-mono uppercase">{row.employeeCode}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-slate-950/50 border-slate-800 text-slate-400 font-normal">
                        {row.department}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-slate-400 text-sm">
                      {row.date}
                    </TableCell>
                    <TableCell className="text-center">
                      {getStatusBadge(row.status)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums pr-6">
                      <span className="text-emerald-400">{row.workingHours}h</span>
                      <span className="text-slate-600 mx-1">/</span>
                      <span className="text-blue-400">{row.lmsHours}h</span>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs italic text-slate-500 max-w-[300px] flex flex-col gap-1">
                        <span>{row.remark}</span>
                        {row.status === 'Missing' && (row as any).plannedProjects?.length > 0 && (
                          <span className="text-[10px] text-blue-400/60 not-italic">
                            Planned: {(row as any).plannedProjects.join(', ')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
