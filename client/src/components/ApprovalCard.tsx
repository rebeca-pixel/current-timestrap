import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Check, X, Clock, User, Calendar, ChevronDown, ChevronUp, AlertCircle, FileText, Target, Trophy, HelpCircle, TrendingUp, Hammer } from 'lucide-react';

interface TaskSummary {
  project: string;
  taskName: string;
  keyStep?: string;
  subtask: string;
  duration: string;
  description: string;
  quantifyResult: string;
  achievements: string;
  problemsIssues: string;
  scopeImprovements: string;
  tools: string[];
}

interface ApprovalSubmission {
  id: string;
  employeeName: string;
  employeeCode: string;
  submissionDate: string;
  totalHours: number;
  productiveHours: number;
  idleHours: number;
  tasks: TaskSummary[];
  status: 'pending' | 'approved' | 'rejected';
}

interface ApprovalCardProps {
  submission: ApprovalSubmission;
  isSelected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}

export default function ApprovalCard({ 
  submission, 
  isSelected, 
  onSelect, 
  onApprove, 
  onReject 
}: ApprovalCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleReject = () => {
    if (rejectReason.trim()) {
      onReject(submission.id, rejectReason);
      setShowRejectDialog(false);
      setRejectReason('');
    }
  };

  const statusColors = {
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    approved: 'bg-green-500/20 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  return (
    <>
      <Card 
        className={`bg-slate-900 border-blue-500/20 transition-all ${
          isSelected ? 'ring-2 ring-blue-500/50' : ''
        }`}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Checkbox 
                checked={isSelected}
                onCheckedChange={(checked) => onSelect(submission.id, !!checked)}
                className="border-blue-500/50 data-[state=checked]:bg-blue-600"
              />
              <div>
                <CardTitle className="text-base font-medium text-white flex items-center gap-2 flex-wrap">
                  <User className="w-4 h-4 text-blue-400" />
                  {submission.employeeName}
                  <Badge variant="outline" className="text-xs text-blue-300 border-blue-500/30">
                    {submission.employeeCode}
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-2 mt-1 text-sm text-blue-200/60">
                  <Calendar className="w-3 h-3" />
                  {submission.submissionDate}
                </div>
              </div>
            </div>
            <Badge variant="outline" className={statusColors[submission.status]}>
              {submission.status.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        
        <CardContent className="pb-3">
          {/* Main Hours Summary */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-slate-800/50 rounded-lg border border-white/5">
              <p className="text-xs text-blue-200/60 mb-1 uppercase font-bold">Total Hours</p>
              <p className="text-lg font-bold text-white">{submission.totalHours}h</p>
            </div>
            <div className="text-center p-3 bg-green-500/5 rounded-lg border border-green-500/10">
              <p className="text-xs text-green-400/60 mb-1 uppercase font-bold">Productive</p>
              <p className="text-lg font-bold text-green-400">{submission.productiveHours}h</p>
            </div>
            <div className="text-center p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/10">
              <p className="text-xs text-yellow-400/60 mb-1 uppercase font-bold">Idle</p>
              <p className="text-lg font-bold text-yellow-400">{submission.idleHours}h</p>
            </div>
          </div>
          
          {isExpanded && (
            <div className="mt-6 space-y-6">
              {submission.tasks.map((task, i) => (
                <div key={i} className="space-y-4">
                  {/* Top Row: Project, Task, Subtask */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-cyan-400 mb-1 uppercase">Project</p>
                      <p className="text-sm text-white font-medium">{task.project}</p>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-indigo-400 mb-1 uppercase">Key Step</p>
                      <p className="text-sm text-white font-medium">{task.keyStep || "N/A"}</p>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-purple-400 mb-1 uppercase">Task</p>
                      <p className="text-sm text-white font-medium">{task.taskName}</p>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-pink-400 mb-1 uppercase">Subtask</p>
                      <p className="text-sm text-white font-medium">{task.subtask}</p>
                    </div>
                  </div>

                  {/* Row: Quantify Result & Achievements */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-blue-300 mb-2 uppercase flex items-center gap-1">
                        <Target className="w-3 h-3" /> Quantify Result
                      </p>
                      <p className="text-sm text-blue-100/80">{task.quantifyResult}</p>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-blue-300 mb-2 uppercase flex items-center gap-1">
                        <Trophy className="w-3 h-3" /> Achievements
                      </p>
                      <p className="text-sm text-blue-100/80">{task.achievements}</p>
                    </div>
                  </div>

                  {/* Row: Problems & Issues & Scope of Improvements */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-blue-300 mb-2 uppercase flex items-center gap-1">
                        <HelpCircle className="w-3 h-3" /> Problems & Issues
                      </p>
                      <p className="text-sm text-blue-100/80">{task.problemsIssues}</p>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-blue-300 mb-2 uppercase flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Scope of Improvements
                      </p>
                      <p className="text-sm text-blue-100/80">{task.scopeImprovements}</p>
                    </div>
                  </div>

                  {/* Row: Tools Used & Description */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-blue-300 mb-2 uppercase flex items-center gap-1">
                        <Hammer className="w-3 h-3" /> Tools Used
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {task.tools.map(tool => (
                          <Badge key={tool} className="bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg border border-white/5">
                      <p className="text-[10px] font-bold text-blue-300 mb-2 uppercase flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Description
                      </p>
                      <p className="text-sm text-blue-100/80">{task.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full mt-4 text-blue-400 hover:bg-white/5"
          >
            {isExpanded ? (
              <><ChevronUp className="w-4 h-4 mr-2" /> Hide Details</>
            ) : (
              <><ChevronDown className="w-4 h-4 mr-2" /> View Details</>
            )}
          </Button>
        </CardContent>
        
        {submission.status === 'pending' && (
          <CardFooter className="pt-3 border-t border-white/5 flex gap-3">
            <Button
              variant="destructive"
              onClick={() => setShowRejectDialog(true)}
              className="flex-1 bg-red-600/20 text-red-400 border border-red-500/20 hover:bg-red-600 hover:text-white"
            >
              <X className="w-4 h-4 mr-2" /> Reject
            </Button>
            <Button
              onClick={() => onApprove(submission.id)}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Check className="w-4 h-4 mr-2" /> Approve
            </Button>
          </CardFooter>
        )}
      </Card>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="bg-slate-900 border-blue-500/20 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-400" />
              Reject Timesheet
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-blue-200/60 mb-3">
              Reason for rejecting {submission.employeeName}'s timesheet:
            </p>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason..."
              className="bg-slate-800 border-blue-500/20 text-white"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim()}>
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}