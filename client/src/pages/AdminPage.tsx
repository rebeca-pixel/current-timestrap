import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Shield, 
  Users, 
  Clock, 
  CheckSquare, 
  Settings, 
  Activity,
  AlertCircle,
  RefreshCw,
  Download
} from 'lucide-react';
import { User } from '@/context/AuthContext';

interface AdminPageProps {
  user: User;
}

// todo: remove mock functionality
const mockStats = {
  totalEmployees: 15,
  activeTimesheets: 12,
  pendingApprovals: 5,
  todayLogins: 14,
};

const mockAuditLogs = [
  { id: '1', action: 'User Login', user: 'Mohanraj C', timestamp: '2025-12-11 09:00:15', details: 'Successful login from 192.168.1.1' },
  { id: '2', action: 'Timesheet Submit', user: 'Yuvaraj', timestamp: '2025-12-11 17:30:22', details: 'Submitted 8 hours timesheet' },
  { id: '3', action: 'Approval', user: 'Ishaan Bhat', timestamp: '2025-12-11 18:00:45', details: 'Approved timesheet for Sivaram C' },
  { id: '4', action: 'User Created', user: 'Rebecasuji', timestamp: '2025-12-10 14:22:33', details: 'Created new employee EMP050' },
  { id: '5', action: 'Password Reset', user: 'System', timestamp: '2025-12-10 11:15:00', details: 'Password reset for DurgaDevi' },
  { id: '6', action: 'Department Created', user: 'Rebecasuji', timestamp: '2025-12-09 10:00:00', details: 'Created Marketing department' },
];

const mockSettings = {
  autoCreateOnLogin: false,
  approvalWorkflow: true,
  emailNotifications: true,
  minGapMinutes: 20,
  defaultShiftHours: 8,
};

export default function AdminPage({ user }: AdminPageProps) {
  const [settings, setSettings] = useState(mockSettings);
  const [activeTab, setActiveTab] = useState('overview');

  const updateSetting = (key: string, value: boolean | number) => {
    setSettings({ ...settings, [key]: value });
  };

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="admin-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            Administration
          </h1>
          <p className="text-blue-200/60 text-sm">
            System settings and audit logs
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="bg-slate-800 border-blue-500/20 text-white">
            <Download className="w-4 h-4 mr-2" />
            Export Logs
          </Button>
          <Button variant="outline" className="bg-slate-800 border-blue-500/20 text-white">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Total Employees</p>
              <p className="text-2xl font-bold text-white">{mockStats.totalEmployees}</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Clock className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Active Timesheets</p>
              <p className="text-2xl font-bold text-white">{mockStats.activeTimesheets}</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/20">
              <CheckSquare className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Pending Approvals</p>
              <p className="text-2xl font-bold text-white">{mockStats.pendingApprovals}</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <Activity className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Today's Logins</p>
              <p className="text-2xl font-bold text-white">{mockStats.todayLogins}</p>
            </div>
          </div>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800/50 border border-blue-500/20">
          <TabsTrigger 
            value="overview" 
            className="data-[state=active]:bg-blue-600"
            data-testid="tab-overview"
          >
            <Shield className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger 
            value="audit" 
            className="data-[state=active]:bg-blue-600"
            data-testid="tab-audit"
          >
            <Activity className="w-4 h-4 mr-2" />
            Audit Logs
          </TabsTrigger>
          <TabsTrigger 
            value="settings" 
            className="data-[state=active]:bg-blue-600"
            data-testid="tab-settings"
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-slate-800/50 border-blue-500/20">
              <CardHeader>
                <CardTitle className="text-lg text-white">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {mockAuditLogs.slice(0, 4).map(log => (
                  <div 
                    key={log.id} 
                    className="flex items-start gap-3 p-3 bg-slate-700/30 rounded-lg border border-blue-500/10"
                  >
                    <Activity className="w-4 h-4 text-blue-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium">{log.action}</p>
                      <p className="text-xs text-blue-200/60">
                        {log.user} - {log.timestamp}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-blue-500/20">
              <CardHeader>
                <CardTitle className="text-lg text-white">System Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-sm text-white">Database Connection</span>
                  </div>
                  <Badge className="bg-green-500/20 text-green-400">Healthy</Badge>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-sm text-white">Email Service</span>
                  </div>
                  <Badge className="bg-green-500/20 text-green-400">Operational</Badge>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-yellow-500" />
                    <span className="text-sm text-white">Background Jobs</span>
                  </div>
                  <Badge className="bg-yellow-500/20 text-yellow-400">3 Pending</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <Card className="bg-slate-800/50 border-blue-500/20">
            <CardHeader>
              <CardTitle className="text-lg text-white">Audit Logs</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-blue-500/20 hover:bg-transparent">
                      <TableHead className="text-blue-300">Timestamp</TableHead>
                      <TableHead className="text-blue-300">Action</TableHead>
                      <TableHead className="text-blue-300">User</TableHead>
                      <TableHead className="text-blue-300">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mockAuditLogs.map(log => (
                      <TableRow 
                        key={log.id} 
                        className="border-blue-500/10 hover:bg-slate-700/30"
                      >
                        <TableCell className="text-sm text-blue-200/60 font-mono">
                          {log.timestamp}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-blue-300 border-blue-500/30">
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-white">{log.user}</TableCell>
                        <TableCell className="text-blue-200/60 text-sm max-w-xs truncate">
                          {log.details}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <Card className="bg-slate-800/50 border-blue-500/20">
            <CardHeader>
              <CardTitle className="text-lg text-white">System Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                <div>
                  <Label className="text-white font-medium">Auto-create users on login</Label>
                  <p className="text-sm text-blue-200/60">
                    Automatically create new employee accounts when they first login
                  </p>
                </div>
                <Switch 
                  checked={settings.autoCreateOnLogin}
                  onCheckedChange={(v) => updateSetting('autoCreateOnLogin', v)}
                  data-testid="switch-auto-create"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                <div>
                  <Label className="text-white font-medium">Approval Workflow</Label>
                  <p className="text-sm text-blue-200/60">
                    Require manager approval for submitted timesheets
                  </p>
                </div>
                <Switch 
                  checked={settings.approvalWorkflow}
                  onCheckedChange={(v) => updateSetting('approvalWorkflow', v)}
                  data-testid="switch-approval-workflow"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                <div>
                  <Label className="text-white font-medium">Email Notifications</Label>
                  <p className="text-sm text-blue-200/60">
                    Send email notifications for approvals and submissions
                  </p>
                </div>
                <Switch 
                  checked={settings.emailNotifications}
                  onCheckedChange={(v) => updateSetting('emailNotifications', v)}
                  data-testid="switch-email-notifications"
                />
              </div>

              <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-white font-medium">Time Validation Rules</p>
                    <p className="text-sm text-blue-200/60 mt-1">
                      Minimum gap between tasks: {settings.minGapMinutes} minutes
                      <br />
                      Default shift hours: {settings.defaultShiftHours} hours
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
