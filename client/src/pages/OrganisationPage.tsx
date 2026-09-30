import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Plus, MapPin, FileText, CheckCircle, Loader2, Users, FolderTree, UserCircle, Network, Pencil, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { User } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { Organisation, Department, Group } from '@shared/schema';
import { DEPARTMENT_OPTIONS } from '@shared/schema';

interface OrganisationPageProps {
  user: User;
}
                 
export default function OrganisationPage({ user }: OrganisationPageProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('organisations');
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
  const [showCreateDeptDialog, setShowCreateDeptDialog] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
  // Edit states
  const [showEditOrgDialog, setShowEditOrgDialog] = useState(false);
  const [showEditDeptDialog, setShowEditDeptDialog] = useState(false);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organisation | null>(null);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
    
  // Delete states
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string; name: string } | null>(null);
  
  const [orgFormData, setOrgFormData] = useState({
    name: '',
    gstId: '',
    mainAddress: '',
    branchAddress: '',
  });

  const [deptFormData, setDeptFormData] = useState({
    name: '',   
    code: '',
    leader: '',
    parentDepartmentId: '',
  });

  const [groupFormData, setGroupFormData] = useState({
    name: '',
    parentDepartment: '',
    groupLeader: '',
  });

  // Fetch data from database
  const { data: organisations = [], isLoading: orgsLoading } = useQuery<Organisation[]>({
    queryKey: ['/api/organisations'],
  });

  const { data: departments = [], isLoading: deptsLoading } = useQuery<Department[]>({
    queryKey: ['/api/departments'],
  });

  const { data: groups = [], isLoading: groupsLoading } = useQuery<Group[]>({
    queryKey: ['/api/groups'],
  });

  // WebSocket for real-time updates
  useWebSocket({
    organisation_created: () => queryClient.invalidateQueries({ queryKey: ['/api/organisations'] }),
    department_created: () => queryClient.invalidateQueries({ queryKey: ['/api/departments'] }),
    group_created: () => queryClient.invalidateQueries({ queryKey: ['/api/groups'] }),
  });

  // Mutations
  const createOrgMutation = useMutation({
    mutationFn: async (data: typeof orgFormData) => {
      const response = await apiRequest('POST', '/api/organisations', data);
      return response.json();
    },
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ['/api/organisations'] });
      setSuccessMessage(`Organisation "${org.name}" created successfully!`);
      setShowCreateOrgDialog(false);
      setShowSuccessDialog(true);
      setOrgFormData({ name: '', gstId: '', mainAddress: '', branchAddress: '' });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create organisation.", variant: "destructive" });
    },
  });

  const createDeptMutation = useMutation({
    mutationFn: async (data: typeof deptFormData) => {
      const response = await apiRequest('POST', '/api/departments', data);
      return response.json();
    },
    onSuccess: (dept) => {
      queryClient.invalidateQueries({ queryKey: ['/api/departments'] });
      setSuccessMessage(`Department "${dept.name}" created successfully!`);
      setShowCreateDeptDialog(false);
      setShowSuccessDialog(true);
      setDeptFormData({ name: '', code: '', leader: '', parentDepartmentId: '' });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create department.", variant: "destructive" });
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: async (data: typeof groupFormData) => {
      const response = await apiRequest('POST', '/api/groups', data);
      return response.json();
    },
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['/api/groups'] });
      setSuccessMessage(`Group "${group.name}" created successfully!`);
      setShowCreateGroupDialog(false);
      setShowSuccessDialog(true);
      setGroupFormData({ name: '', parentDepartment: '', groupLeader: '' });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create group.", variant: "destructive" });
    },
  });

  // Update mutations
  const updateOrgMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof orgFormData> }) => {
      const response = await apiRequest('PATCH', `/api/organisations/${id}`, data);
      return response.json();
    },
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ['/api/organisations'] });
      setShowEditOrgDialog(false);
      setEditingOrg(null);
      toast({ title: "Success", description: `Organisation "${org.name}" updated successfully!` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update organisation.", variant: "destructive" });
    },
  });

  const updateDeptMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof deptFormData> }) => {
      const response = await apiRequest('PATCH', `/api/departments/${id}`, data);
      return response.json();
    },
    onSuccess: (dept) => {
      queryClient.invalidateQueries({ queryKey: ['/api/departments'] });
      setShowEditDeptDialog(false);
      setEditingDept(null);
      toast({ title: "Success", description: `Department "${dept.name}" updated successfully!` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update department.", variant: "destructive" });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof groupFormData> }) => {
      const response = await apiRequest('PATCH', `/api/groups/${id}`, data);
      return response.json();
    },
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['/api/groups'] });
      setShowEditGroupDialog(false);
      setEditingGroup(null);
      toast({ title: "Success", description: `Group "${group.name}" updated successfully!` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update group.", variant: "destructive" });
    },
  });

  // Delete mutations
  const deleteOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/organisations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organisations'] });
      setDeleteConfirm(null);
      toast({ title: "Deleted", description: "Organisation deleted successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete organisation.", variant: "destructive" });
    },
  });

  const deleteDeptMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/departments'] });
      setDeleteConfirm(null);
      toast({ title: "Deleted", description: "Department deleted successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete department.", variant: "destructive" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/groups'] });
      setDeleteConfirm(null);
      toast({ title: "Deleted", description: "Group deleted successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete group.", variant: "destructive" });
    },
  });

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'org') deleteOrgMutation.mutate(deleteConfirm.id);
    else if (deleteConfirm.type === 'dept') deleteDeptMutation.mutate(deleteConfirm.id);
    else if (deleteConfirm.type === 'group') deleteGroupMutation.mutate(deleteConfirm.id);
  };

  const handleCreateOrg = () => {
    if (!orgFormData.name || !orgFormData.gstId || !orgFormData.mainAddress) {
      toast({ title: "Validation Error", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    createOrgMutation.mutate(orgFormData);
  };

  const handleCreateDept = () => {
    if (!deptFormData.name || !deptFormData.code) {
      toast({ title: "Validation Error", description: "Please fill in department name and code.", variant: "destructive" });
      return;
    }
    createDeptMutation.mutate(deptFormData);
  };

  const handleCreateGroup = () => {
    if (!groupFormData.name || !groupFormData.parentDepartment) {
      toast({ title: "Validation Error", description: "Please fill in group name and parent department.", variant: "destructive" });
      return;
    }
    createGroupMutation.mutate(groupFormData);
  };

  // Group departments by parent for structure view
  const groupsByDepartment = groups.reduce((acc, group) => {
    const dept = group.parentDepartment;
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(group);
    return acc;
  }, {} as Record<string, Group[]>);

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="organisation-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            Organisation Management
          </h1>
          <p className="text-blue-200/60 text-sm">
            Manage organisations, departments, and groups
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-blue-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <Building2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-200/60">Organisations</p>
              <p className="text-2xl font-bold text-white">{organisations.length}</p>
            </div>
          </div>
        </Card>
        <Card className="bg-slate-800/50 border-purple-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <FolderTree className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-purple-200/60">Departments</p>
              <p className="text-2xl font-bold text-white">{departments.length}</p>
            </div>
          </div>
        </Card>
        <Card className="bg-slate-800/50 border-cyan-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20">
              <Users className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs text-cyan-200/60">Groups</p>
              <p className="text-2xl font-bold text-white">{groups.length}</p>
            </div>
          </div>
        </Card>
        <Card className="bg-slate-800/50 border-green-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Network className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-green-200/60">Structure Levels</p>
              <p className="text-2xl font-bold text-white">{Object.keys(groupsByDepartment).length}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-slate-800/50 border border-blue-500/20">
          <TabsTrigger value="organisations" className="data-[state=active]:bg-blue-600">Organisations</TabsTrigger>
          <TabsTrigger value="departments" className="data-[state=active]:bg-blue-600">Departments</TabsTrigger>
          <TabsTrigger value="groups" className="data-[state=active]:bg-blue-600">Groups</TabsTrigger>
          <TabsTrigger value="structure" className="data-[state=active]:bg-blue-600">Structure View</TabsTrigger>
        </TabsList>

        {/* Organisations Tab */}
        <TabsContent value="organisations" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">All Organisations</h2>
            <Button onClick={() => setShowCreateOrgDialog(true)} className="bg-gradient-to-r from-blue-600 to-cyan-600" data-testid="button-create-organisation">
              <Plus className="w-4 h-4 mr-2" />
              Create Organisation
            </Button>
          </div>
          
          {orgsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            </div>
          ) : organisations.length === 0 ? (
            <Card className="bg-slate-800/50 border-blue-500/20 p-8 text-center">
              <Building2 className="w-12 h-12 text-blue-400/40 mx-auto mb-4" />
              <p className="text-blue-200/60">No organisations created yet.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {organisations.map((org) => (
                <Card key={org.id} className="bg-slate-800/50 border-blue-500/20" data-testid={`card-org-${org.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg text-white flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-blue-400" />
                        {org.name}
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-blue-400"
                          onClick={() => { setEditingOrg(org); setShowEditOrgDialog(true); }}
                          data-testid={`button-edit-org-${org.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-red-400"
                          onClick={() => setDeleteConfirm({ type: 'org', id: org.id, name: org.name })}
                          data-testid={`button-delete-org-${org.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-blue-200/60">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        GST: {org.gstId}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-blue-200/60">Main Address</p>
                        <p className="text-sm text-white">{org.mainAddress}</p>
                      </div>
                    </div>
                    {org.branchAddress && (
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-blue-200/60">Branch Address</p>
                          <p className="text-sm text-white">{org.branchAddress}</p>
                        </div>
                      </div>
                    )}
                    <Badge variant="outline" className="text-green-400 border-green-500/30 bg-green-500/10 mt-2">
                      Active
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Departments Tab */}
        <TabsContent value="departments" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">All Departments</h2>
            <Button onClick={() => setShowCreateDeptDialog(true)} className="bg-gradient-to-r from-purple-600 to-pink-600" data-testid="button-create-department">
              <Plus className="w-4 h-4 mr-2" />
              Create Department
            </Button>
          </div>
          
          {deptsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
          ) : departments.length === 0 ? (
            <Card className="bg-slate-800/50 border-purple-500/20 p-8 text-center">
              <FolderTree className="w-12 h-12 text-purple-400/40 mx-auto mb-4" />
              <p className="text-purple-200/60">No departments created yet.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {departments.map((dept) => (
                <Card key={dept.id} className="bg-slate-800/50 border-purple-500/20" data-testid={`card-dept-${dept.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg text-white flex items-center gap-2">
                        <FolderTree className="w-5 h-5 text-purple-400" />
                        {dept.name}
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-purple-400"
                          onClick={() => { setEditingDept(dept); setShowEditDeptDialog(true); }}
                          data-testid={`button-edit-dept-${dept.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-red-400"
                          onClick={() => setDeleteConfirm({ type: 'dept', id: dept.id, name: dept.name })}
                          data-testid={`button-delete-dept-${dept.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-purple-200/60">
                      Code: {dept.code}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {dept.leader && (
                      <div className="flex items-center gap-2">
                        <UserCircle className="w-4 h-4 text-purple-400" />
                        <span className="text-sm text-white">Leader: {dept.leader}</span>
                      </div>
                    )}
                    <Badge variant="outline" className="text-purple-400 border-purple-500/30 bg-purple-500/10 mt-2">
                      Active
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Groups Tab */}
        <TabsContent value="groups" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">All Groups</h2>
            <Button onClick={() => setShowCreateGroupDialog(true)} className="bg-gradient-to-r from-cyan-600 to-teal-600" data-testid="button-create-group">
              <Plus className="w-4 h-4 mr-2" />
              Create Group
            </Button>
          </div>
          
          {groupsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : groups.length === 0 ? (
            <Card className="bg-slate-800/50 border-cyan-500/20 p-8 text-center">
              <Users className="w-12 h-12 text-cyan-400/40 mx-auto mb-4" />
              <p className="text-cyan-200/60">No groups created yet.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((group) => (
                <Card key={group.id} className="bg-slate-800/50 border-cyan-500/20" data-testid={`card-group-${group.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg text-white flex items-center gap-2">
                        <Users className="w-5 h-5 text-cyan-400" />
                        {group.name}
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-cyan-400"
                          onClick={() => { setEditingGroup(group); setShowEditGroupDialog(true); }}
                          data-testid={`button-edit-group-${group.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-red-400"
                          onClick={() => setDeleteConfirm({ type: 'group', id: group.id, name: group.name })}
                          data-testid={`button-delete-group-${group.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-cyan-200/60">
                      Department: {group.parentDepartment}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {group.groupLeader && (
                      <div className="flex items-center gap-2">
                        <UserCircle className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm text-white">Leader: {group.groupLeader}</span>
                      </div>
                    )}
                    <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 bg-cyan-500/10 mt-2">
                      Active
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Structure View Tab - Tree Diagram */}
        <TabsContent value="structure" className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Organisation Structure Diagram</h2>
          
          {groups.length === 0 && departments.length === 0 ? (
            <Card className="bg-slate-800/50 border-green-500/20 p-8 text-center">
              <Network className="w-12 h-12 text-green-400/40 mx-auto mb-4" />
              <p className="text-green-200/60">No structure data yet. Create departments and groups first.</p>
            </Card>
          ) : (
            <div className="flex flex-col items-center py-8">
              {/* Root - Organisation */}
              <div className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg border-2 border-blue-400 shadow-lg shadow-blue-500/30">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-white" />
                  <span className="text-white font-bold text-lg">Organisation</span>
                </div>
              </div>
              
              {/* Vertical connector */}
              <div className="w-0.5 h-8 bg-blue-500/50" />
              
              {/* Horizontal line */}
              <div className="w-full max-w-4xl h-0.5 bg-blue-500/50" />
              
              {/* Departments Row */}
              <div className="flex flex-wrap justify-center gap-8 mt-0">
                {DEPARTMENT_OPTIONS.filter(deptName => 
                  groupsByDepartment[deptName]?.length > 0 || departments.some(d => d.name === deptName)
                ).map((deptName, index) => {
                  const deptGroups = groupsByDepartment[deptName] || [];
                  const dept = departments.find(d => d.name === deptName);
                  
                  return (
                    <div key={deptName} className="flex flex-col items-center">
                      {/* Vertical connector from horizontal line */}
                      <div className="w-0.5 h-6 bg-blue-500/50" />
                      
                      {/* Department Node */}
                      <div className="px-4 py-2 bg-purple-600/80 rounded-lg border border-purple-400 shadow-md min-w-32 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <FolderTree className="w-4 h-4 text-white" />
                          <span className="text-white font-semibold text-sm">{deptName}</span>
                        </div>
                        {dept?.leader && (
                          <p className="text-purple-200 text-xs mt-1">{dept.leader}</p>
                        )}
                      </div>
                      
                      {/* Groups under department */}
                      {deptGroups.length > 0 && (
                        <>
                          <div className="w-0.5 h-4 bg-purple-500/50" />
                          <div className="flex flex-col gap-2">
                            {deptGroups.map((group, gIndex) => (
                              <div key={group.id} className="flex items-center">
                                {gIndex > 0 && <div className="w-0.5 h-2 bg-cyan-500/50 absolute -mt-2" />}
                                <div className="px-3 py-1.5 bg-cyan-600/60 rounded-md border border-cyan-400/50 min-w-28 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <Users className="w-3 h-3 text-white" />
                                    <span className="text-white text-xs font-medium">{group.name}</span>
                                  </div>
                                  {group.groupLeader && (
                                    <p className="text-cyan-200 text-xs">{group.groupLeader}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Legend */}
              <div className="mt-12 flex flex-wrap justify-center gap-6 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gradient-to-r from-blue-600 to-cyan-600 rounded" />
                  <span className="text-slate-400 text-sm">Organisation</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-purple-600 rounded" />
                  <span className="text-slate-400 text-sm">Department</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-cyan-600 rounded" />
                  <span className="text-slate-400 text-sm">Group/Team</span>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Organisation Dialog */}
      <Dialog open={showCreateOrgDialog} onOpenChange={setShowCreateOrgDialog}>
        <DialogContent className="bg-slate-900 border-blue-500/20 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-400" />
              Create New Organisation
            </DialogTitle>
            <DialogDescription className="text-blue-200/60">
              Fill in the details to create a new organisation
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-blue-100">Organisation Name *</Label>
              <Input value={orgFormData.name} onChange={(e) => setOrgFormData({ ...orgFormData, name: e.target.value })} placeholder="e.g., CT International Pvt Ltd" className="bg-slate-800 border-blue-500/20 text-white" data-testid="input-org-name" />
            </div>
            <div className="space-y-2">
              <Label className="text-blue-100">GST ID *</Label>
              <Input value={orgFormData.gstId} onChange={(e) => setOrgFormData({ ...orgFormData, gstId: e.target.value.toUpperCase() })} placeholder="e.g., 33AABCU9603R1ZM" className="bg-slate-800 border-blue-500/20 text-white" data-testid="input-org-gst" />
            </div>
            <div className="space-y-2">
              <Label className="text-blue-100">Main Address *</Label>
              <Textarea value={orgFormData.mainAddress} onChange={(e) => setOrgFormData({ ...orgFormData, mainAddress: e.target.value })} placeholder="Enter the main office address" className="bg-slate-800 border-blue-500/20 text-white" data-testid="input-org-main-address" />
            </div>
            <div className="space-y-2">
              <Label className="text-blue-100">Branch Address</Label>
              <Textarea value={orgFormData.branchAddress} onChange={(e) => setOrgFormData({ ...orgFormData, branchAddress: e.target.value })} placeholder="Enter the branch office address (optional)" className="bg-slate-800 border-blue-500/20 text-white" data-testid="input-org-branch-address" />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateOrgDialog(false)} className="border-slate-600">Cancel</Button>
            <Button onClick={handleCreateOrg} className="bg-blue-600" disabled={createOrgMutation.isPending} data-testid="button-save-organisation">
              {createOrgMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Organisation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Department Dialog */}
      <Dialog open={showCreateDeptDialog} onOpenChange={setShowCreateDeptDialog}>
        <DialogContent className="bg-slate-900 border-purple-500/20 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-purple-400" />
              Create New Department
            </DialogTitle>
            <DialogDescription className="text-purple-200/60">
              Add a new department to your organisation
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-purple-100">Department Name *</Label>
              <Input value={deptFormData.name} onChange={(e) => setDeptFormData({ ...deptFormData, name: e.target.value })} placeholder="e.g., Software Development" className="bg-slate-800 border-purple-500/20 text-white" data-testid="input-dept-name" />
            </div>
            <div className="space-y-2">
              <Label className="text-purple-100">Department Code *</Label>
              <Input value={deptFormData.code} onChange={(e) => setDeptFormData({ ...deptFormData, code: e.target.value.toUpperCase() })} placeholder="e.g., SOFT-DEV" className="bg-slate-800 border-purple-500/20 text-white" data-testid="input-dept-code" />
            </div>
            <div className="space-y-2">
              <Label className="text-purple-100">Department Leader</Label>
              <Input value={deptFormData.leader} onChange={(e) => setDeptFormData({ ...deptFormData, leader: e.target.value })} placeholder="Enter leader name" className="bg-slate-800 border-purple-500/20 text-white" data-testid="input-dept-leader" />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDeptDialog(false)} className="border-slate-600">Cancel</Button>
            <Button onClick={handleCreateDept} className="bg-purple-600" disabled={createDeptMutation.isPending} data-testid="button-save-department">
              {createDeptMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Department'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Group Dialog */}
      <Dialog open={showCreateGroupDialog} onOpenChange={setShowCreateGroupDialog}>
        <DialogContent className="bg-slate-900 border-cyan-500/20 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-cyan-400" />
              Create New Group
            </DialogTitle>
            <DialogDescription className="text-cyan-200/60">
              Add a new group under a department
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-cyan-100">Group Name *</Label>
              <Input value={groupFormData.name} onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })} placeholder="e.g., Frontend Team" className="bg-slate-800 border-cyan-500/20 text-white" data-testid="input-group-name" />
            </div>
            <div className="space-y-2">
              <Label className="text-cyan-100">Parent Department *</Label>
              <Select value={groupFormData.parentDepartment} onValueChange={(value) => setGroupFormData({ ...groupFormData, parentDepartment: value })}>
                <SelectTrigger className="bg-slate-800 border-cyan-500/20 text-white" data-testid="select-parent-department">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-cyan-500/20">
                  {DEPARTMENT_OPTIONS.map((dept) => (
                    <SelectItem key={dept} value={dept} className="text-white hover:bg-slate-700">
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-cyan-100">Group Leader Name</Label>
              <Input value={groupFormData.groupLeader} onChange={(e) => setGroupFormData({ ...groupFormData, groupLeader: e.target.value })} placeholder="Enter group leader name" className="bg-slate-800 border-cyan-500/20 text-white" data-testid="input-group-leader" />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateGroupDialog(false)} className="border-slate-600">Cancel</Button>
            <Button onClick={handleCreateGroup} className="bg-cyan-600" disabled={createGroupMutation.isPending} data-testid="button-save-group">
              {createGroupMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Create Group'}
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
            <DialogTitle className="text-white text-xl mb-2">Success!</DialogTitle>
            <p className="text-blue-200/80">{successMessage}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSuccessDialog(false)} className="w-full bg-green-600">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Organisation Dialog */}
      <Dialog open={showEditOrgDialog} onOpenChange={setShowEditOrgDialog}>
        <DialogContent className="bg-slate-900 border-blue-500/20">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-5 h-5 text-blue-400" />
              Edit Organisation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-blue-100">Organisation Name *</Label>
              <Input 
                value={editingOrg?.name || ''} 
                onChange={(e) => setEditingOrg(prev => prev ? { ...prev, name: e.target.value } : null)} 
                className="bg-slate-800 border-blue-500/20 text-white" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-blue-100">GST ID *</Label>
              <Input 
                value={editingOrg?.gstId || ''} 
                onChange={(e) => setEditingOrg(prev => prev ? { ...prev, gstId: e.target.value } : null)} 
                className="bg-slate-800 border-blue-500/20 text-white" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-blue-100">Main Address *</Label>
              <Textarea 
                value={editingOrg?.mainAddress || ''} 
                onChange={(e) => setEditingOrg(prev => prev ? { ...prev, mainAddress: e.target.value } : null)} 
                className="bg-slate-800 border-blue-500/20 text-white" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-blue-100">Branch Address</Label>
              <Textarea 
                value={editingOrg?.branchAddress || ''} 
                onChange={(e) => setEditingOrg(prev => prev ? { ...prev, branchAddress: e.target.value } : null)} 
                className="bg-slate-800 border-blue-500/20 text-white" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditOrgDialog(false); setEditingOrg(null); }} className="border-slate-600">Cancel</Button>
            <Button 
              onClick={() => editingOrg && updateOrgMutation.mutate({ id: editingOrg.id, data: { name: editingOrg.name, gstId: editingOrg.gstId, mainAddress: editingOrg.mainAddress, branchAddress: editingOrg.branchAddress || undefined } })} 
              className="bg-blue-600" 
              disabled={updateOrgMutation.isPending}
            >
              {updateOrgMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Department Dialog */}
      <Dialog open={showEditDeptDialog} onOpenChange={setShowEditDeptDialog}>
        <DialogContent className="bg-slate-900 border-purple-500/20">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-5 h-5 text-purple-400" />
              Edit Department
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-purple-100">Department Name *</Label>
              <Input 
                value={editingDept?.name || ''} 
                onChange={(e) => setEditingDept(prev => prev ? { ...prev, name: e.target.value } : null)} 
                className="bg-slate-800 border-purple-500/20 text-white" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-purple-100">Department Code *</Label>
              <Input 
                value={editingDept?.code || ''} 
                onChange={(e) => setEditingDept(prev => prev ? { ...prev, code: e.target.value } : null)} 
                className="bg-slate-800 border-purple-500/20 text-white" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-purple-100">Leader Name</Label>
              <Input 
                value={editingDept?.leader || ''} 
                onChange={(e) => setEditingDept(prev => prev ? { ...prev, leader: e.target.value } : null)} 
                className="bg-slate-800 border-purple-500/20 text-white" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditDeptDialog(false); setEditingDept(null); }} className="border-slate-600">Cancel</Button>
            <Button 
              onClick={() => editingDept && updateDeptMutation.mutate({ id: editingDept.id, data: { name: editingDept.name, code: editingDept.code, leader: editingDept.leader || undefined } })} 
              className="bg-purple-600" 
              disabled={updateDeptMutation.isPending}
            >
              {updateDeptMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={showEditGroupDialog} onOpenChange={setShowEditGroupDialog}>
        <DialogContent className="bg-slate-900 border-cyan-500/20">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-5 h-5 text-cyan-400" />
              Edit Group
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-cyan-100">Group Name *</Label>
              <Input 
                value={editingGroup?.name || ''} 
                onChange={(e) => setEditingGroup(prev => prev ? { ...prev, name: e.target.value } : null)} 
                className="bg-slate-800 border-cyan-500/20 text-white" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-cyan-100">Parent Department *</Label>
              <Select 
                value={editingGroup?.parentDepartment || ''} 
                onValueChange={(value) => setEditingGroup(prev => prev ? { ...prev, parentDepartment: value } : null)}
              >
                <SelectTrigger className="bg-slate-800 border-cyan-500/20 text-white">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-cyan-500/20">
                  {DEPARTMENT_OPTIONS.map((dept) => (
                    <SelectItem key={dept} value={dept} className="text-white hover:bg-slate-700">
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-cyan-100">Group Leader</Label>
              <Input 
                value={editingGroup?.groupLeader || ''} 
                onChange={(e) => setEditingGroup(prev => prev ? { ...prev, groupLeader: e.target.value } : null)} 
                className="bg-slate-800 border-cyan-500/20 text-white" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditGroupDialog(false); setEditingGroup(null); }} className="border-slate-600">Cancel</Button>
            <Button 
              onClick={() => editingGroup && updateGroupMutation.mutate({ id: editingGroup.id, data: { name: editingGroup.name, parentDepartment: editingGroup.parentDepartment, groupLeader: editingGroup.groupLeader || undefined } })} 
              className="bg-cyan-600" 
              disabled={updateGroupMutation.isPending}
            >
              {updateGroupMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent className="bg-slate-900 border-red-500/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              Confirm Delete
            </AlertDialogTitle>
            <AlertDialogDescription className="text-blue-200/80">
              Are you sure you want to delete "{deleteConfirm?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600 text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete} 
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
