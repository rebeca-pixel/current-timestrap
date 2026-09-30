import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserPlus, Search, Edit2, Trash2, Shield, ShieldCheck, User as UserIcon, Users, Loader2, CheckCircle } from 'lucide-react';
import { User } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { Employee, Manager } from '@shared/schema';

interface UsersPageProps {
  user: User;
}

const roleColors: Record<string, string> = {
  employee: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  manager: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  hr: 'bg-green-500/20 text-green-400 border-green-500/30',
  admin: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

export default function UsersPage({ user }: UsersPageProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [createdUser, setCreatedUser] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: '',
    employeeCode: '',
    email: '',
    password: '',
    role: 'employee',
    department: '',
    groupName: '',
    lineManagerId: '',
  });

  // Fetch employees from database
  const { data: employees = [], isLoading: loadingEmployees } = useQuery<Omit<Employee, 'password'>[]>({
    queryKey: ['/api/employees'],
  });

  // Fetch managers from database
  const { data: managers = [], isLoading: loadingManagers } = useQuery<Manager[]>({
    queryKey: ['/api/managers'],
  });

  // WebSocket for real-time updates
  useWebSocket({
    employee_created: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
    },
  });

  // Create employee mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest('POST', '/api/employees', data);
      return response.json();
    },
    onSuccess: (emp) => {
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
      setCreatedUser(emp);
      setShowCreateDialog(false);
      setShowSuccessDialog(true);
      setFormData({
        name: '',
        employeeCode: '',
        email: '',
        password: '',
        role: 'employee',
        department: '',
        groupName: '',
        lineManagerId: '',
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Tool validation toggle mutation
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const toolValidationMutation = useMutation({
    mutationFn: async ({ id, enforce }: { id: string; enforce: boolean }) => {
      const response = await apiRequest('PATCH', `/api/employees/${id}/tool-validation`, { enforceToolValidation: enforce });
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
      setTogglingId(null);
      toast({
        title: variables.enforce ? 'Tool Validation Enabled' : 'Tool Validation Disabled',
        description: variables.enforce
          ? 'This employee must now use tools verified in TimeGuard during entry time windows.'
          : 'Tool validation is no longer enforced for this employee.',
      });
    },
    onError: (error: any) => {
      setTogglingId(null);
      toast({
        title: 'Failed to update setting',
        description: error.message || 'Could not update tool validation setting.',
        variant: 'destructive',
      });
    },
  });

  const handleToggleToolValidation = (emp: Omit<Employee, 'password'>) => {
    const nextValue = !emp.enforceToolValidation;
    setTogglingId(emp.id);
    toolValidationMutation.mutate({ id: emp.id, enforce: nextValue });
  };

  // Global TimeGuard Suggestions toggle
  const { data: timeguardSuggestionsSetting, isLoading: loadingTimeguardSetting } = useQuery<{ timeguardSuggestionsEnabled: boolean }>({
    queryKey: ['/api/settings/timeguard-suggestions'],
  });
  const timeguardSuggestionsEnabled = timeguardSuggestionsSetting?.timeguardSuggestionsEnabled !== false;

  const timeguardSuggestionsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await apiRequest('PATCH', '/api/settings/timeguard-suggestions', { enabled });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings/timeguard-suggestions'] });
      toast({
        title: data.timeguardSuggestionsEnabled ? 'TimeGuard Suggestions Enabled' : 'TimeGuard Suggestions Disabled',
        description: data.timeguardSuggestionsEnabled
          ? 'TimeGuard suggestions are now visible to all users.'
          : 'TimeGuard suggestions are now hidden for all users.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to update setting',
        description: error.message || 'Could not update the TimeGuard Suggestions setting.',
        variant: 'destructive',
      });
    },
  });

  const handleToggleTimeguardSuggestions = () => {
    timeguardSuggestionsMutation.mutate(!timeguardSuggestionsEnabled);
  };

  const filteredUsers = employees.filter(u =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.employeeCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateUser = () => {
    if (!formData.name || !formData.employeeCode || !formData.password) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate(formData);
  };

  const getManagerName = (managerId: string | null) => {
    if (!managerId) return '-';
    const manager = managers.find(m => m.id === managerId);
    return manager ? manager.name : '-';
  };

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="users-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            User Management
          </h1>
          <p className="text-blue-200/60 text-sm">
            Create and manage employee accounts
          </p>
        </div>

        <Button
          onClick={() => setShowCreateDialog(true)}
          className="bg-gradient-to-r from-blue-600 to-cyan-600"
          data-testid="button-create-user"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Create User
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Total Users</p>
              <p className="text-2xl font-bold text-white">{employees.length}</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <UserIcon className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Managers</p>
              <p className="text-2xl font-bold text-white">
                {employees.filter(u => u.role === 'manager').length}
              </p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Shield className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">HR</p>
              <p className="text-2xl font-bold text-white">
                {employees.filter(u => u.role === 'hr').length}
              </p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <Shield className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Admins</p>
              <p className="text-2xl font-bold text-white">
                {employees.filter(u => u.role === 'admin').length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="bg-slate-800/50 border-blue-500/20 p-4" data-testid="card-timeguard-suggestions-setting">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white">TimeGuard Suggestions</p>
            <p className="text-xs text-blue-200/60">
              When enabled, all users can use "✨ Suggest from TimeGuard" to auto-fill task descriptions from tracked activity. When disabled, this is hidden for everyone.
            </p>
          </div>
          <Switch
            checked={timeguardSuggestionsEnabled}
            disabled={loadingTimeguardSetting || timeguardSuggestionsMutation.isPending}
            onCheckedChange={handleToggleTimeguardSuggestions}
            data-testid="switch-timeguard-suggestions"
          />
        </div>
      </Card>

      <Card className="bg-slate-800/50 border-blue-500/20">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-lg text-white">All Users</CardTitle>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-700/50 border-blue-500/20 text-white"
                data-testid="input-search-users"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingEmployees ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-blue-500/20 hover:bg-transparent">
                    <TableHead className="text-blue-300">Employee Code</TableHead>
                    <TableHead className="text-blue-300">Name</TableHead>
                    <TableHead className="text-blue-300">Role</TableHead>
                    <TableHead className="text-blue-300 hidden md:table-cell">Department</TableHead>
                    <TableHead className="text-blue-300 hidden lg:table-cell">Group</TableHead>
                    <TableHead className="text-blue-300 hidden lg:table-cell">Line Manager</TableHead>
                    <TableHead className="text-blue-300 hidden md:table-cell" title="Enforce tool validation from TimeGuard for this employee's timesheet entries">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                        Tool Validation
                      </div>
                    </TableHead>
                    <TableHead className="text-blue-300 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map(u => (
                    <TableRow
                      key={u.id}
                      className="border-blue-500/10 hover:bg-slate-700/30"
                      data-testid={`row-user-${u.id}`}
                    >
                      <TableCell className="font-mono text-blue-200">{u.employeeCode}</TableCell>
                      <TableCell className="text-white">{u.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={roleColors[u.role]}>
                          {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-blue-200/60 hidden md:table-cell">{u.department || '-'}</TableCell>
                      <TableCell className="text-blue-200/60 hidden lg:table-cell">{u.groupName || '-'}</TableCell>
                      <TableCell className="text-blue-200/60 hidden lg:table-cell">{getManagerName(u.lineManagerId)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`tool-validation-${u.id}`}
                            checked={!!u.enforceToolValidation}
                            disabled={togglingId === u.id}
                            onCheckedChange={() => handleToggleToolValidation(u as any)}
                            aria-label={`Toggle tool validation for ${u.name}`}
                          />
                          <span className={`text-xs font-medium ${u.enforceToolValidation ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {togglingId === u.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                            ) : u.enforceToolValidation ? 'On' : 'Off'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="icon" variant="ghost" className="text-blue-400 h-8 w-8">
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-400 h-8 w-8"
                            data-testid={`button-delete-user-${u.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-slate-900 border-blue-500/20 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-400" />
              Create New User
            </DialogTitle>
            <DialogDescription className="text-blue-200/60">
              Add a new employee to the system
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label className="text-blue-100">Employee Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
                className="bg-slate-800 border-blue-500/20 text-white"
                data-testid="input-new-user-name"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-blue-100">Employee Code *</Label>
              <Input
                value={formData.employeeCode}
                onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value.toUpperCase() })}
                placeholder="EMP050"
                className="bg-slate-800 border-blue-500/20 text-white"
                data-testid="input-new-user-code"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-blue-100">Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@company.com"
                className="bg-slate-800 border-blue-500/20 text-white"
                data-testid="input-new-user-email"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-blue-100">Password *</Label>
              <Input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Create password"
                className="bg-slate-800 border-blue-500/20 text-white"
                data-testid="input-new-user-password"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-blue-100">Role *</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v })}
              >
                <SelectTrigger className="bg-slate-800 border-blue-500/20 text-white" data-testid="select-new-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="hr">HR</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-blue-100">Department</Label>
              <Select
                value={formData.department}
                onValueChange={(v) => setFormData({ ...formData, department: v })}
              >
                <SelectTrigger className="bg-slate-800 border-blue-500/20 text-white" data-testid="select-new-user-department">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Engineering">Engineering</SelectItem>
                  <SelectItem value="Human Resources">Human Resources</SelectItem>
                  <SelectItem value="Administration">Administration</SelectItem>
                  <SelectItem value="Finance">Finance</SelectItem>
                  <SelectItem value="Marketing">Marketing</SelectItem>
                  <SelectItem value="Sales">Sales</SelectItem>
                  <SelectItem value="Operations">Operations</SelectItem>
                  <SelectItem value="IT">IT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-blue-100">Group Name</Label>
              <Input
                value={formData.groupName}
                onChange={(e) => setFormData({ ...formData, groupName: e.target.value })}
                placeholder="e.g., Frontend Team"
                className="bg-slate-800 border-blue-500/20 text-white"
                data-testid="input-new-user-group"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-blue-100">Line Manager</Label>
              <Select
                value={formData.lineManagerId}
                onValueChange={(v) => setFormData({ ...formData, lineManagerId: v })}
              >
                <SelectTrigger className="bg-slate-800 border-blue-500/20 text-white" data-testid="select-new-user-manager">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  {managers.map(mgr => (
                    <SelectItem key={mgr.id} value={mgr.id}>
                      {mgr.name} ({mgr.employeeCode}) - {mgr.department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="border-slate-600">
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              className="bg-blue-600"
              disabled={createMutation.isPending}
              data-testid="button-save-new-user"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create User'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent className="bg-slate-900 border-green-500/20 max-w-md">
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <DialogTitle className="text-white text-xl mb-2">
              User Created Successfully!
            </DialogTitle>
            {createdUser && (
              <div className="mt-4 p-4 bg-slate-800/50 rounded-lg text-left">
                <p className="text-sm text-blue-200/60">User Details:</p>
                <p className="text-white font-medium">{createdUser.name}</p>
                <p className="text-blue-200/80 text-sm">Code: {createdUser.employeeCode}</p>
                <p className="text-blue-200/80 text-sm">Role: {createdUser.role}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setShowSuccessDialog(false)}
              className="w-full bg-green-600"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}