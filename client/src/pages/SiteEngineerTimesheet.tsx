import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { insertSiteReportSchema, type InsertSiteReport } from '@shared/schema';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { offlineDb, type OfflineSiteReport } from '@/lib/offlineDb';
import { useQuery } from '@tanstack/react-query';
import { 
  MapPin, 
  Calendar, 
  Clock, 
  Briefcase, 
  FileText, 
  AlertTriangle, 
  Package, 
  Users, 
  Upload, 
  Save, 
  Wifi, 
  WifiOff, 
  RefreshCw,
  CheckCircle2,
  XCircle,
  FileIcon,
  ImageIcon,
  Paperclip,
  Mail,
  Users2,
  ListRestart,
  Maximize2,
  Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { Target, AlertCircle, Eye, Loader2 } from 'lucide-react';

const WORK_CATEGORIES = [
  "Excavation",
  "Concrete",
  "Inspection",
  "BOQ",
  "Electrical",
  "Plumbing",
  "Finishing",
  "Others"
];

export default function SiteEngineerTimesheet() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedTask, setSelectedTask] = useState<{id: string, name: string} | null>(null);
  const [selectedProjectCode, setSelectedProjectCode] = useState<string>('');
   const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [siteReportDetailOpen, setSiteReportDetailOpen] = useState(false);
  const [siteReportDetail, setSiteReportDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{ lat: string; lng: string } | null>(null);
  const [files, setFiles] = useState<{ fileName: string; fileType: string; base64Data: string }[]>([]);
  const [laborEntries, setLaborEntries] = useState<{ name: string; inTime: string; outTime: string }[]>([{ name: '', inTime: '08:00', outTime: '17:00' }]);
  const [emailGroups, setEmailGroups] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('site_report_email_groups');
    return saved ? JSON.parse(saved) : { "me": user?.email || "", "manager": "manager@company.com" };
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<any>({
    resolver: zodResolver(insertSiteReportSchema),
    defaultValues: {
      employeeId: user?.id || '',
      employeeName: user?.name || '',
      date: format(new Date(), 'yyyy-MM-dd'),
      laborCount: 1,
      workCategory: 'Excavation',
      startTime: '08:00',
      endTime: '17:00',
      duration: '9h 0m',
      emailRecipients: '',
      laborDetails: '',
      sqftCovered: '',
      laborData: []
    }
  });

  const selectedProjectId = watch('projectName'); 
  // We use watch('projectName') to store the PROJECT_CODE or NAME

  // Fetch Projects
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: [`/api/projects?userRole=${encodeURIComponent(user?.role || '')}&userEmpCode=${encodeURIComponent(user?.employeeCode || '')}&userDepartment=${encodeURIComponent(user?.department || '')}`],
    enabled: !!user
  });

  // Fetch Tasks for selected project — use project_code, NOT title
  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: [`/api/tasks?projectId=${encodeURIComponent(selectedProjectCode)}&userEmpCode=${encodeURIComponent(user?.employeeCode || '')}`],
    enabled: !!selectedProjectCode
  });

  const { data: historyReports = [], isLoading: isHistoryLoading } = useQuery<any[]>({
    queryKey: ['/api/site-reports', { employeeId: user?.id }],
    queryFn: async () => {
      const res = await fetch(`/api/site-reports?employeeId=${user?.id}`);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!user?.id
  });

  const startTime = watch('startTime');
  const endTime = watch('endTime');

  // Calculate duration
  useEffect(() => {
    if (startTime && endTime) {
      try {
        const start = new Date(`2000-01-01T${startTime}`);
        const end = new Date(`2000-01-01T${endTime}`);
        if (end > start) {
          const diffMs = end.getTime() - start.getTime();
          const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
          const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          setValue('duration', `${diffHrs}h ${diffMins}m`);
        }
      } catch (e) {
        console.error("Duration calc error", e);
      }
    }
  }, [startTime, endTime, setValue]);

  // Capture GPS
  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) };
          setGpsLocation(loc);
          setValue('locationLat', loc.lat);
          setValue('locationLng', loc.lng);
        },
        (err) => console.warn("Geolocation watch error", err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [setValue]);

  // Online/Offline listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const checkPending = async () => {
      const reports = await offlineDb.getAllReports();
      setPendingCount(reports.filter(r => r.status === 'pending').length);
    };
    checkPending();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync Logic
  const syncReports = useCallback(async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);

    try {
      const reports = await offlineDb.getAllReports();
      const toSync = reports.filter(r => r.status === 'pending');

      for (const report of toSync) {
        try {
          // 1. Create the report
          const savedReport = await apiRequest('POST', '/api/site-reports', report.data);
          const reportJson = await savedReport.json();

          // 2. Upload attachments
          for (const file of report.attachments) {
            await apiRequest('POST', '/api/site-reports/upload', {
              reportId: reportJson.id,
              fileName: file.fileName,
              fileType: file.fileType,
              base64Data: file.base64Data
            });
          }

          // 3. Trigger Email Distribution
          try {
            await apiRequest('POST', `/api/site-reports/${reportJson.id}/send-email`);
            toast({
              title: "Email Sent Successfully",
              description: `Professional report for ${report.data.projectName} delivered to stakeholders.`,
              variant: "default",
            });
          } catch (emailErr) {
            toast({
              title: "Email Failed",
              description: "Report saved, but we couldn't send the email right now.",
              variant: "destructive",
            });
          }

          // 4. Create TimeEntry so it goes to Approvals History
          try {
            await apiRequest('POST', '/api/time-entries', {
              employeeId: report.data.employeeId,
              employeeName: report.data.employeeName,
              employeeCode: user?.employeeCode || '',
              department: user?.department || '',
              date: report.data.date,
              projectName: report.data.projectName, 
              taskDescription: report.data.taskName ? `[${report.data.taskName}] ${report.data.workDone}` : report.data.workDone,
              percentageComplete: 100, // Typical assumption for end-of-day site reporting 
              status: "pending",
              startTime: report.data.startTime,
              endTime: report.data.endTime,
              totalHours: report.data.duration || "08:00",
              pmsId: report.data.taskId 
            });
          } catch (e) {
            console.error("Failed to create TimeEntry for approvals:", e);
          }

          // 5. Mark as synced and cleanup
          await offlineDb.deleteReport(report.localId);
        } catch (e: any) {
          console.error("Failed to sync report", report.localId, e);
          await offlineDb.updateReportStatus(report.localId, 'error');
          toast({
            title: "Sync Failed",
            description: `Report for ${report.data.projectName} failed to sync: ${e.message}`,
            variant: "destructive",
          });
        }
      }

      const updatedReports = await offlineDb.getAllReports();
      setPendingCount(updatedReports.filter(r => r.status === 'pending').length);
      
      if (toSync.length > 0) {
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${toSync.length} reports.`,
          variant: "default",
        });
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing, toast]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      syncReports();
    }
  }, [isOnline, pendingCount, syncReports]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setFiles(prev => [...prev, {
          fileName: file.name,
          fileType: file.type,
          base64Data: base64String
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const onSubmit = async (data: any) => {
    data.laborData = laborEntries;
    data.laborCount = laborEntries.length;
    data.taskId = selectedTask?.id;
    data.taskName = selectedTask?.name;

    if (!isOnline) {
      // Offline: save to IndexedDB
      const localId = crypto.randomUUID();
      const offlineReport: OfflineSiteReport = {
        localId,
        data,
        attachments: files,
        status: 'pending',
        timestamp: Date.now()
      };
      try {
        await offlineDb.saveReport(offlineReport);
        setPendingCount(prev => prev + 1);
        toast({ title: "Saved Offline", description: "Report saved locally. Will sync when online.", variant: "default" });
        reset();
        setFiles([]);
      } catch (e) {
        toast({ title: "Error Saving", description: "Failed to save the report locally.", variant: "destructive" });
      }
      return;
    }

    // Online: submit directly
    try {
      toast({ title: "Submitting...", description: "Saving your site report.", variant: "default" });

      // 1. Create the report
      const savedRes = await apiRequest('POST', '/api/site-reports', data);
      const report = await savedRes.json();

      // 2. Upload attachments
      for (const file of files) {
        try {
          await apiRequest('POST', '/api/site-reports/upload', {
            reportId: report.id,
            fileName: file.fileName,
            fileType: file.fileType,
            base64Data: file.base64Data
          });
        } catch (e) {
          console.warn('Attachment upload failed:', e);
        }
      }

      // 3. Send email
      try {
        await apiRequest('POST', `/api/site-reports/${report.id}/send-email`);
        toast({
          title: "✅ Report Submitted & Email Sent!",
          description: `Site report for "${data.projectName}" saved and professional email sent to stakeholders.`,
          variant: "default",
        });
      } catch (emailErr) {
        toast({
          title: "✅ Report Submitted",
          description: "Report saved successfully. Email delivery failed — please check your recipient list.",
          variant: "default",
        });
      }

      // 4. Create TimeEntry so it goes to Approvals History
      try {
        await apiRequest('POST', '/api/time-entries', {
          employeeId: report.employeeId,
          employeeName: report.employeeName,
          employeeCode: user?.employeeCode || '',
          department: user?.department || '',
          date: report.date,
          projectName: report.projectName, 
          taskDescription: data.taskName ? `[${data.taskName}] ${data.workDone}` : data.workDone,
          percentageComplete: 100, // Typical assumption for end-of-day site reporting 
          status: "pending",
          startTime: report.startTime,
          endTime: report.endTime,
          totalHours: report.duration || "08:00",
          pmsId: data.taskId 
        });
      } catch (e) {
        console.error("Failed to create TimeEntry for approvals:", e);
      }

      // 5. Reset form
      reset();
      setFiles([]);
      setSelectedTask(null);
      setSelectedProjectCode('');

      // 6. Redirect to history
      setTimeout(() => setLocation('/reports'), 1500);

    } catch (e: any) {
      toast({
        title: "Submission Failed",
        description: e.message || "Failed to submit the report. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-0">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full space-y-4"
      >
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/50 p-6 md:p-8 rounded-none border-b border-white/10 shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Briefcase className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Site Engineer Dashboard</h1>
              <p className="text-sm text-slate-400 mt-1">Document site progress, attach evidence, and communicate with clients.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Badge variant={isOnline ? "default" : "destructive"} className="px-3 py-1 gap-2 text-xs font-semibold uppercase tracking-wider">
              {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isOnline ? 'Online' : 'Offline Mode'}
            </Badge>
            
            {pendingCount > 0 && (
              <Badge variant="outline" className="px-3 py-1 gap-2 text-xs font-semibold border-cyan-500/50 text-cyan-400 bg-cyan-500/10">
                <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                {pendingCount} Pending Sync
              </Badge>
            )}
          </div>
        </div>

        <Tabs defaultValue="report" className="w-full">
          <div className="px-6 md:px-12 pt-4">
            <TabsList className="bg-slate-900/50 border border-white/5 p-1 rounded-2xl">
              <TabsTrigger value="report" className="rounded-xl px-8 data-[state=active]:bg-cyan-500 data-[state=active]:text-white transition-all">New Report</TabsTrigger>
              <TabsTrigger value="history" className="rounded-xl px-8 data-[state=active]:bg-blue-500 data-[state=active]:text-white transition-all">My History</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="report">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-12 p-4 md:p-8 w-full">
          <div className="space-y-12 w-full">
            {/* Consolidated Site Context & User Info */}
            <Card className="bg-slate-900/50 backdrop-blur-xl border-white/5 rounded-3xl overflow-hidden shadow-2xl site-report-card">
              <div className="p-5 md:p-6 space-y-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-white/5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-xl">
                      <Briefcase className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white uppercase tracking-wider">Site Reporting Context</h2>
                      <p className="text-[10px] text-slate-400">Project, task and session info</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-slate-950/40 p-2 rounded-2xl border border-white/5">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 text-xs font-bold border border-blue-500/20">
                      {user?.name?.charAt(0)}
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 uppercase font-black">Logged as</p>
                      <p className="text-xs text-white font-medium">{user?.name}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                   <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Project / Site</Label>
                    <Select onValueChange={(val) => {
                      const p = projects.find(p => p.project_code === val);
                      setValue('projectName', p?.project_name || p?.title || val);
                      setSelectedProjectCode(p?.project_code || val);
                      setSelectedTask(null);
                    }}>
                      <SelectTrigger className="bg-slate-800/50 border-white/10 text-white h-10 text-xs rounded-xl">
                        <SelectValue placeholder="Select Project" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-white/10 max-h-64">
                        {projects.map(p => (
                          <SelectItem key={p.project_code} value={p.project_code || p.title}>
                            {p.title || p.project_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Working Task</Label>
                    <Select onValueChange={(val) => {
                      const t = tasks.find(x => x.id === val);
                      if (t) setSelectedTask({ id: t.id, name: t.task_name || t.name });
                    }} disabled={!selectedProjectCode}>
                      <SelectTrigger className="bg-slate-800/50 border-white/10 text-white h-10 text-xs rounded-xl">
                        <SelectValue placeholder={selectedProjectCode ? "Select Task" : "Select Project"} />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-white/10 max-h-64">
                        {tasks.map(t => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.task_name || t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Category</Label>
                    <Select onValueChange={(val) => setValue('workCategory', val)} defaultValue="Excavation">
                      <SelectTrigger className="bg-slate-800/50 border-white/10 text-white h-10 text-xs rounded-xl">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-white/10">
                        {WORK_CATEGORIES.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Start Time</Label>
                    <Input 
                      type="time" 
                      {...register('startTime')} 
                      className="bg-slate-800/50 border-white/10 text-white h-10 text-xs rounded-xl" 
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">End Time</Label>
                    <Input 
                      type="time" 
                      {...register('endTime')} 
                      className="bg-slate-800/50 border-white/10 text-white h-10 text-xs rounded-xl" 
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Reporting Date</Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <Input 
                        value={format(new Date(), 'MMM dd, yyyy')}
                        readOnly
                        className="bg-slate-800/20 border-white/5 text-slate-400 pl-9 h-10 text-[10px] rounded-xl cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Observations & Progress */}
            {/* Observations & Progress */}
            <Card className="bg-slate-900/50 backdrop-blur-xl border-white/5 rounded-3xl overflow-hidden shadow-2xl site-report-card">
              <div className="p-5 md:p-6 space-y-6">
                <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                  <div className="p-2 bg-indigo-500/20 rounded-xl">
                    <FileText className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Observations & Progress</h2>
                    <p className="text-[10px] text-slate-400">Document work achievements and resources</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Column 1: Notes */}
                  <div className="lg:col-span-4 space-y-2">
                    <Label htmlFor="workDone" className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Work Accomplished</Label>
                    <Textarea 
                      id="workDone"
                      {...register('workDone')}
                      placeholder="Today's updates, milestones..."
                      className="bg-slate-800/50 border-white/10 text-white min-h-[180px] text-xs resize-none rounded-2xl focus:ring-indigo-500/50"
                    />
                  </div>

                  {/* Column 2: Labour Log */}
                  <div className="lg:col-span-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Labour Log</Label>
                        <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30 text-[10px] py-0 px-2 h-4">{laborEntries.length}</Badge>
                      </div>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="text-cyan-400 hover:text-cyan-300 h-6 text-[10px]"
                        onClick={() => setLaborEntries([...laborEntries, { name: '', inTime: '08:00', outTime: '17:00' }])}
                      >
                        + Add Labour
                      </Button>
                    </div>
                    
                    <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                      {laborEntries.length === 0 ? (
                        <p className="text-[10px] text-slate-600 italic text-center py-4">No labour entries added.</p>
                      ) : laborEntries.map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 p-1.5 bg-slate-800/40 rounded-xl border border-white/5 group">
                          <Input 
                            placeholder="Name" 
                            value={entry.name}
                            onChange={(e) => {
                              const newEntries = [...laborEntries];
                              newEntries[idx].name = e.target.value;
                              setLaborEntries(newEntries);
                            }}
                            className="flex-1 bg-slate-900/50 border-white/10 text-white text-[10px] h-7 px-2"
                          />
                          <Input 
                            type="time" 
                            value={entry.inTime}
                            onChange={(e) => {
                              const newEntries = [...laborEntries];
                              newEntries[idx].inTime = e.target.value;
                              setLaborEntries(newEntries);
                            }}
                            className="w-[88px] bg-slate-900/50 border-white/10 text-white text-[10px] h-7 px-1 text-center [&::-webkit-calendar-picker-indicator]:invert"
                          />
                          <Input 
                            type="time" 
                            value={entry.outTime}
                            onChange={(e) => {
                              const newEntries = [...laborEntries];
                              newEntries[idx].outTime = e.target.value;
                              setLaborEntries(newEntries);
                            }}
                            className="w-[88px] bg-slate-900/50 border-white/10 text-white text-[10px] h-7 px-1 text-center [&::-webkit-calendar-picker-indicator]:invert"
                          />
                          {laborEntries.length > 1 && (
                            <button 
                              type="button" 
                              className="text-red-500/40 hover:text-red-500 transition-colors"
                              onClick={() => setLaborEntries(laborEntries.filter((_, i) => i !== idx))}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Column 3: Output & Materials */}
                  <div className="lg:col-span-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="sqftCovered" className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Work Output (Sq. Ft)</Label>
                      <Input 
                        id="sqftCovered"
                        {...register('sqftCovered')}
                        placeholder="e.g., 450 sqft"
                        className="bg-slate-800/50 border-white/10 text-white h-9 text-xs rounded-xl"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="materialsUsed" className="text-[11px] uppercase font-bold text-slate-300 tracking-widest pl-1">Material Consumption</Label>
                      <Textarea 
                        id="materialsUsed"
                        {...register('materialsUsed')}
                        placeholder="List items, quantities..."
                        className="bg-slate-800/50 border-white/10 text-white min-h-[100px] text-xs resize-none rounded-2xl focus:ring-emerald-500/50"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Card>

              {/* Location + Evidence side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Live Site Location */}
              <Card className="bg-slate-900/50 backdrop-blur-xl border-white/5 rounded-3xl overflow-hidden shadow-2xl site-report-card site-report-card-location">
                <CardHeader className="bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-b border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-orange-500/20 rounded-xl">
                        <MapPin className="w-5 h-5 text-orange-400" />
                      </div>
                      <div>
                        <CardTitle className="text-lg text-white">Live Site Location</CardTitle>
                        <CardDescription className="text-slate-400 text-xs">Geo-verified reporting coordinates</CardDescription>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-orange-400 hover:text-orange-300 gap-2 h-8 text-[10px]"
                      onClick={() => {
                        setGpsLocation(null);
                        navigator.geolocation.getCurrentPosition(
                          (pos) => setGpsLocation({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }),
                          (err) => toast({ title: "GPS Error", description: "Could not find location", variant: "destructive" })
                        );
                      }}
                    >
                      <RefreshCw className="w-3 h-3" />
                      REFETCH GPS
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="w-full h-[350px] relative bg-slate-900/40">
                    {gpsLocation ? (
                      <iframe 
                        width="100%" 
                        height="100%" 
                        frameBorder="0" 
                        scrolling="no" 
                        marginHeight={0} 
                        marginWidth={0} 
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(gpsLocation.lng)-0.01}%2C${parseFloat(gpsLocation.lat)-0.01}%2C${parseFloat(gpsLocation.lng)+0.01}%2C${parseFloat(gpsLocation.lat)+0.01}&layer=mapnik&marker=${gpsLocation.lat}%2C${gpsLocation.lng}`}
                        style={{ filter: 'invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)', opacity: 0.9 }}
                      ></iframe>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4 p-6">
                        <RefreshCw className="w-8 h-8 animate-spin text-cyan-500/50" />
                        <div className="text-center">
                          <p className="text-[10px] uppercase font-black tracking-widest text-cyan-500/50 mb-1">Live Signal Discovery</p>
                          <p className="text-xs text-slate-600 mb-3">Establishing secure site connection...</p>
                          <div className="p-3 bg-orange-500/5 border border-orange-500/20 rounded-2xl">
                            <p className="text-[10px] text-orange-400 font-bold uppercase mb-1 flex items-center justify-center gap-2">
                              <MapPin className="w-3 h-3" /> Location Blocked?
                            </p>
                            <p className="text-[10px] text-slate-500 leading-relaxed">
                              Click the <strong>tune icon</strong> next to URL and enable <strong>Location</strong>.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-4 left-4 right-4 p-3 bg-slate-950/90 backdrop-blur-md rounded-2xl border border-white/10 flex items-center justify-between shadow-2xl">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${gpsLocation ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-orange-500 animate-pulse'}`} />
                        <div>
                          <p className="text-[9px] uppercase font-bold text-slate-500 tracking-tighter">Lat / Lng</p>
                          <p className="text-xs text-slate-300 font-mono">
                            {gpsLocation ? `${gpsLocation.lat}, ${gpsLocation.lng}` : 'Calibrating...'}
                          </p>
                        </div>
                      </div>
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] py-1 px-2">LIVE</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Evidence & Documents */}
              <Card className="bg-slate-900/50 backdrop-blur-xl border-white/5 rounded-3xl overflow-hidden shadow-2xl site-report-card">
                <CardHeader className="bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border-b border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-indigo-500/20 rounded-xl">
                        <Paperclip className="w-5 h-5 text-indigo-400" />
                      </div>
                      <div>
                        <CardTitle className="text-lg text-white">Evidence & Documents</CardTitle>
                        <CardDescription className="text-slate-400 text-xs">Attachments {files.length > 0 && `(${files.length})`}</CardDescription>
                      </div>
                    </div>
                    <Label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg active:scale-95 flex items-center gap-2">
                      <Upload className="w-4 h-4" />
                      Attach
                      <input type="file" multiple className="hidden" onChange={handleFileChange} accept="image/*,.pdf,.doc,.docx" />
                    </Label>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-white/5 rounded-2xl bg-slate-800/10 group hover:border-blue-500/30 transition-all cursor-pointer min-h-[280px]" onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
                      <div className="w-14 h-14 rounded-full bg-slate-800/80 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Upload className="w-7 h-7 text-slate-500 group-hover:text-blue-400" />
                      </div>
                      <p className="text-slate-400 text-sm font-medium">Click to upload site photos & documents</p>
                      <p className="text-[10px] text-slate-600 mt-1">Images will be embedded in the email report</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                      {files.map((f, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/50 border border-white/5 rounded-2xl group relative">
                          {f.fileType.includes('image') ? (
                            <img src={`data:${f.fileType};base64,${f.base64Data}`} alt={f.fileName} className="w-12 h-12 rounded-xl object-cover border border-white/10" />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center">
                              <FileIcon className="w-5 h-5 text-emerald-400" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white truncate font-medium">{f.fileName}</p>
                            <p className="text-[10px] text-slate-500 uppercase">{f.fileType.split('/')[1]}</p>
                          </div>
                          <button type="button" onClick={() => setFiles(cur => cur.filter((_, idx) => idx !== i))} className="p-2 text-slate-500 hover:text-red-400 transition-colors">
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>

              {/* Email Distribution */}
              <Card className="bg-slate-900/50 backdrop-blur-xl border-white/5 rounded-3xl overflow-hidden shadow-2xl site-report-card">
                <CardHeader className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-violet-500/20 rounded-xl">
                      <Mail className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-white">Email Distribution</CardTitle>
                      <CardDescription className="text-slate-400 text-xs">Send professional report to stakeholders</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Input 
                        {...register('emailRecipients')}
                        placeholder="client@company.com, boss@company.com"
                        className="bg-slate-800/50 border-white/10 text-white h-12 rounded-xl"
                      />
                    </div>
                    <Button 
                      type="button" 
                      variant="outline"
                      className="h-12 border-white/10 text-slate-300 hover:bg-white/5 rounded-xl"
                      onClick={() => {
                        const name = prompt("Enter group name:");
                        if (name) {
                          const recipients = watch('emailRecipients');
                          const newGroups: Record<string, string> = { ...emailGroups, [name]: recipients || "" };
                          setEmailGroups(newGroups);
                          localStorage.setItem('site_report_email_groups', JSON.stringify(newGroups));
                          toast({ title: "Group Saved", description: `Group '${name}' saved successfully.` });
                        }
                      }}
                    >
                      Save Group
                    </Button>
                  </div>
                  
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Load Group:</span>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(emailGroups).map(([name, recipients]) => (
                        <Badge 
                          key={name} 
                          variant="secondary" 
                          className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white px-3 py-1 transition-all rounded-lg border-white/5"
                          onClick={() => {
                            setValue('emailRecipients', recipients);
                            toast({ title: `Group Loaded: ${name}`, description: `Recipients: ${recipients}` });
                          }}
                        >
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 italic">Recipients will receive a professional HTML summary with all attachments.</p>
                </CardContent>
              </Card>
            </div>


          {/* Location Info */}
          <div className="flex items-center justify-between text-[10px] text-slate-500 px-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-3 h-3 text-cyan-500/50" />
              {gpsLocation ? (
                <span>GPS Locked: {gpsLocation?.lat?.substring(0, 10)}, {gpsLocation?.lng?.substring(0, 10)}</span>
              ) : (
                <span>Awaiting Location...</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>Timestamp: {format(new Date(), 'HH:mm:ss')}</span>
            </div>
          </div>

            <Button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full h-16 rounded-3xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-lg font-bold shadow-2xl shadow-cyan-500/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? (
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Save className="w-5 h-5 mr-2" />
              )}
              {isOnline ? 'Submit Site Report' : 'Save Locally (Offline)'}
            </Button>
          </form>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-6">
              {isHistoryLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                </div>
              ) : historyReports.length === 0 ? (
                <Card className="bg-slate-900/50 border-white/5 p-20 text-center">
                  <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-white font-medium">No history found</h3>
                  <p className="text-slate-500 text-sm mt-1">Submit your first report to see it here.</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {historyReports.map((report) => (
                    <Card key={report.id} className="bg-slate-900/50 backdrop-blur-xl border-white/5 hover:border-cyan-500/30 transition-all group overflow-hidden">
                      <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-slate-800 flex flex-col items-center justify-center border border-white/5">
                            <span className="text-[10px] uppercase font-bold text-slate-500">{format(new Date(report.date), 'MMM')}</span>
                            <span className="text-lg font-bold text-white leading-none">{format(new Date(report.date), 'dd')}</span>
                          </div>
                          <div>
                            <h3 className="text-white font-bold">{report.projectName}</h3>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[10px] uppercase font-black text-cyan-500/70 tracking-widest">{report.workCategory}</span>
                              <span className="text-slate-600 text-[10px]">•</span>
                              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {report.startTime} - {report.endTime} ({report.duration})
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 ml-auto">
                          <div className="text-right">
                             <Badge className={`uppercase text-[9px] px-2 py-0.5 tracking-wider font-bold ${
                              report.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                              report.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                              'bg-red-500/20 text-red-400 border-red-500/30'
                            } border`}>
                              {report.status}
                            </Badge>
                            <p className="text-[10px] text-slate-500 mt-1">Uploaded {format(new Date(report.timestamp), 'h:mm a')}</p>
                          </div>
                          
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-9 px-3 text-slate-400 hover:text-white hover:bg-white/5"
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
                            <Eye className="w-4 h-4 mr-2" />
                            Details
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* Site Report Full Detail Dialog */}
      <Dialog open={siteReportDetailOpen} onOpenChange={(open) => { setSiteReportDetailOpen(open); if (!open) setSiteReportDetail(null); }}>
        <DialogContent className="bg-slate-900 border-white/10 sm:max-w-3xl max-h-[90vh] overflow-y-auto custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2 font-black tracking-tight">
              <div className="p-2 bg-cyan-500/20 rounded-lg">
                <FileText className="w-5 h-5 text-cyan-400" />
              </div>
              Site Report Details
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Full submission audit log for this entry
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
                  <p className="text-white text-sm font-semibold truncate">{siteReportDetail.projectName}</p>
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
                  <span className="text-[9px] uppercase font-bold text-violet-400 block mb-1">Status</span>
                   <Badge className={`uppercase text-[9px] px-2 py-0 tracking-wider font-bold ${
                    siteReportDetail.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                    siteReportDetail.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>
                    {siteReportDetail.status}
                  </Badge>
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
              <div className="p-4 rounded-xl bg-slate-800/40 border border-white/5 shadow-inner">
                <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" /> Work Accomplishments
                </h4>
                <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{siteReportDetail.workDone || 'No notes provided.'}</p>
              </div>

              {/* Sqft & Materials */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {siteReportDetail.sqftCovered && (
                  <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
                    <h4 className="text-sm font-bold text-orange-400 mb-2 flex items-center gap-2">
                      <Target className="w-4 h-4" /> Work Output
                    </h4>
                    <p className="text-white text-sm font-medium">{siteReportDetail.sqftCovered} Sq.Ft</p>
                  </div>
                )}
                {siteReportDetail.materialsUsed && (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <h4 className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-2">
                      <Package className="w-4 h-4" /> Materials Consumed
                    </h4>
                    <p className="text-slate-300 text-sm whitespace-pre-wrap">{siteReportDetail.materialsUsed}</p>
                  </div>
                )}
              </div>

              {/* Issues */}
              {siteReportDetail.issuesFaced && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <h4 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> Site Bottlenecks
                  </h4>
                  <p className="text-slate-300 text-sm whitespace-pre-wrap">{siteReportDetail.issuesFaced}</p>
                </div>
              )}

              {/* GPS Map */}
              {siteReportDetail.locationLat && siteReportDetail.locationLng && (
                <div className="p-4 rounded-xl bg-slate-800/40 border border-white/5 shadow-inner">
                  <h4 className="text-sm font-bold text-orange-400 mb-3 flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> GPS Verified Location
                    <span className="text-xs text-slate-500 font-mono font-normal">[{siteReportDetail.locationLat}, {siteReportDetail.locationLng}]</span>
                  </h4>
                  <div className="w-full h-[250px] rounded-xl overflow-hidden border border-white/10 group relative">
                    <iframe
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      scrolling="no"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(siteReportDetail.locationLng)-0.005}%2C${parseFloat(siteReportDetail.locationLat)-0.005}%2C${parseFloat(siteReportDetail.locationLng)+0.005}%2C${parseFloat(siteReportDetail.locationLat)+0.005}&layer=mapnik&marker=${siteReportDetail.locationLat}%2C${siteReportDetail.locationLng}`}
                      style={{ filter: 'invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)', opacity: 0.9 }}
                    />
                    <div className="absolute top-4 right-4 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-[10px] text-emerald-400 font-bold tracking-widest uppercase">Secured Fix</div>
                  </div>
                </div>
              )}

              {/* Photos Grid */}
              {siteReportDetail.attachments && siteReportDetail.attachments.length > 0 && (
                <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <h4 className="text-sm font-bold text-indigo-400 mb-3 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> Visual Evidence
                    <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px] px-2">{siteReportDetail.attachments.length}</Badge>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {siteReportDetail.attachments.map((att: any, i: number) => (
                      <div key={i} className="rounded-xl overflow-hidden border border-white/10 bg-slate-800/40 group relative cursor-pointer" onClick={() => window.open(att.fileUrl, '_blank')}>
                        {(att.fileType?.startsWith('image/') || att.fileUrl?.startsWith('data:image/')) ? (
                          <img src={att.fileUrl} alt={att.fileName} className="w-full h-40 object-cover group-hover:scale-110 transition-transform duration-500" />
                        ) : (
                          <div className="w-full h-32 flex flex-col items-center justify-center bg-slate-800">
                            <FileText className="w-8 h-8 text-slate-600 mb-2" />
                            <span className="text-[10px] text-slate-500">Document File</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                           <Badge className="bg-white/10 backdrop-blur-md text-white border-white/20">Enlarge</Badge>
                        </div>
                        <div className="p-2 border-t border-white/5">
                          <p className="text-[10px] text-slate-300 truncate font-mono">{att.fileName}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

