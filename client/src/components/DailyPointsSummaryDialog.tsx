import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, TrendingUp, TrendingDown, Sparkles, Star, AlertTriangle, Smile } from 'lucide-react';
import { getDailyPointsSummary, type DailyPointsSummary, type DailyPointsEntry, clearDailyPointsSummary } from '@/lib/gamification';

interface DailyPointsSummaryDialogProps {
  /**
   * Optional controlled state. If provided, parent controls the dialog.
   * Otherwise the dialog will open automatically on first mount when
   * there are non-zero entries to show, and re-open whenever a
   * `gamification:daily-summary-show` window event is fired.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function DailyPointsSummaryDialog({ open: openProp, onOpenChange }: DailyPointsSummaryDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [summary, setSummary] = useState<DailyPointsSummary | null>(null);

  // Listen for the show event from anywhere in the app
  useEffect(() => {
    function onShow() {
      setSummary(getDailyPointsSummary());
      setInternalOpen(true);
    }
    function onUpdate(ev: any) {
      if (ev && ev.detail) {
        setSummary(ev.detail as DailyPointsSummary);
      }
    }
    window.addEventListener('gamification:daily-summary-show', onShow as EventListener);
    window.addEventListener('gamification:daily-summary-updated', onUpdate as EventListener);
    return () => {
      window.removeEventListener('gamification:daily-summary-show', onShow as EventListener);
      window.removeEventListener('gamification:daily-summary-updated', onUpdate as EventListener);
    };
  }, []);

  const isOpen = openProp !== undefined ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    if (openProp === undefined) setInternalOpen(v);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const handleClear = () => {
    clearDailyPointsSummary();
    setSummary(getDailyPointsSummary());
    setOpen(false);
  };

  const earnedEntries = (summary?.entries || []).filter(e => e.type === 'earned');
  const deductedEntries = (summary?.entries || []).filter(e => e.type === 'deducted');
  const totalEarned = summary?.totalEarned || 0;
  const totalDeducted = summary?.totalDeducted || 0;
  const netPoints = summary?.netPoints || 0;

  const netColor = netPoints > 0 ? 'text-emerald-400' : netPoints < 0 ? 'text-rose-400' : 'text-slate-300';
  const netSign = netPoints > 0 ? '+' : netPoints < 0 ? '' : '';

  const groupedByProject = (summary?.entries || []).reduce((acc, entry) => {
    if (!acc[entry.projectName]) {
      acc[entry.projectName] = { earned: [], deducted: [], net: 0 };
    }
    if (entry.type === 'earned') {
      acc[entry.projectName].earned.push(entry);
      acc[entry.projectName].net += Math.abs(entry.amount);
    } else {
      acc[entry.projectName].deducted.push(entry);
      acc[entry.projectName].net -= Math.abs(entry.amount);
    }
    return acc;
  }, {} as Record<string, { earned: DailyPointsEntry[], deducted: DailyPointsEntry[], net: number }>);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent
        className="bg-slate-900 border-blue-500/30 text-white max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="dialog-daily-points-summary"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 rounded-full bg-gradient-to-br from-emerald-500/30 to-blue-500/30">
              <Sparkles className="w-6 h-6 text-emerald-300" />
            </div>
            <div>
              <div className="text-white">Today's Achievement Summary</div>
              <DialogDescription className="text-blue-200/70 text-xs font-normal mt-0.5">
                Daily performance breakdown • {summary?.date || new Date().toLocaleDateString()}
              </DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-3">
          {Object.keys(groupedByProject).length === 0 ? (
            <div className="text-center text-slate-400 py-8 italic">
              No tasks completed or evaluated today. Complete tasks to grow your tree! 🌱
            </div>
          ) : (
            Object.entries(groupedByProject).map(([projectName, data]) => (
              <div key={projectName} className="rounded-2xl border border-blue-500/20 bg-slate-800/50 p-4 space-y-4">
                <h4 className="text-sm font-black uppercase tracking-wider text-blue-300 flex items-center justify-between border-b border-blue-500/20 pb-2">
                  <span className="truncate pr-4">{projectName}</span>
                  <span className={`text-lg ${data.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {data.net > 0 ? '+' : ''}{data.net} pts
                  </span>
                </h4>
                
                {data.earned.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-emerald-400/70 uppercase tracking-widest flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Earned (On Time)
                    </div>
                    <ul className="space-y-1.5">
                      {data.earned.map(e => (
                        <li key={e.id} className="flex items-center justify-between gap-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            <div className="text-sm text-white truncate">{e.taskName}</div>
                          </div>
                          <div className="text-emerald-300 font-bold text-sm flex-shrink-0">
                            +{Math.abs(e.amount)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.deducted.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-rose-400/70 uppercase tracking-widest flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" /> Deducted (Overdue)
                    </div>
                    <ul className="space-y-1.5">
                      {data.deducted.map(e => (
                        <li key={e.id} className="flex items-center justify-between gap-3 bg-rose-500/5 border border-rose-500/10 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                            <div className="text-sm text-white truncate">{e.taskName}</div>
                          </div>
                          <div className="text-rose-300 font-bold text-sm flex-shrink-0">
                            -{Math.abs(e.amount)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))
          )}

          {/* Today's Result (Overall) */}
          <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 p-4">
            <h4 className="text-sm font-black uppercase tracking-wider text-blue-300 mb-3 flex items-center gap-2">
              <Star className="w-4 h-4" />
              Overall Daily Result
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-900/40 border border-emerald-500/20 p-2 text-center">
                <div className="text-[9px] text-emerald-300/80 uppercase font-bold tracking-widest">Added</div>
                <div className="text-emerald-300 font-black text-lg">+{totalEarned}</div>
              </div>
              <div className="rounded-lg bg-slate-900/40 border border-rose-500/20 p-2 text-center">
                <div className="text-[9px] text-rose-300/80 uppercase font-bold tracking-widest">Deducted</div>
                <div className="text-rose-300 font-black text-lg">{totalDeducted > 0 ? `-${totalDeducted}` : '0'}</div>
              </div>
              <div className="rounded-lg bg-slate-900/40 border border-blue-500/20 p-2 text-center">
                <div className="text-[9px] text-blue-300/80 uppercase font-bold tracking-widest">Net</div>
                <div className={`${netColor} font-black text-lg`} data-testid="text-net-points">
                  {netSign}{netPoints}
                </div>
              </div>
            </div>
            <div className="text-center mt-3 text-xs text-blue-200/70">
              {netPoints > 0 && "🌳 Your trees are growing! Keep it up!"}
              {netPoints === 0 && "🌱 Neutral day. Complete tasks on time to grow faster!"}
              {netPoints < 0 && "🍂 Watch for overdue tasks. Aim to submit on time tomorrow."}
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={handleClear}
            className="text-slate-400 hover:text-white"
            data-testid="button-clear-summary"
          >
            Clear Today's Summary
          </Button>
          <Button
            onClick={handleClose}
            className="bg-gradient-to-r from-blue-600 to-cyan-600 flex-1"
            data-testid="button-close-summary"
          >
            Got it!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
