import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import gamification, { fetchProjectPoints, fetchProjectDecayStatus } from '@/lib/gamification';
import { confettiBurst } from '@/lib/feedback';
import AchievementTree from '@/components/AchievementTree';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import ProjectHealthBuckets, { type ProjectHealth } from '@/components/ProjectHealthBuckets';
import DailyPointsSummaryDialog from '@/components/DailyPointsSummaryDialog';
import { Eye, EyeOff, Sparkles, Trophy } from 'lucide-react';

const JOLLY_MOTIVATIONS = [
  "🌟 Keep shining! You're making a massive impact today!",
  "🚀 To the moon! Your productivity is out of this world!",
  "🌈 Your hard work is the secret ingredient to our success!",
  "🔥 You're on fire! Keep that momentum rolling!",
  "🎈 High five! You've mastered the art of getting things done!",
  "💎 Simply brilliant! Every entry is a step toward greatness!",
  "👑 Productivity Royalty! Your tree is looking magnificent!",
  "⚡ Zap! You're moving faster than light today!",
];

const STAGES = [
  { key: "seed", threshold: 0, label: "Seed" },
  { key: "sprout", threshold: 10, label: "Sprout" },
  { key: "sapling", threshold: 40, label: "Sapling" },
  { key: "tree", threshold: 120, label: "Tree" },
  { key: "flowering", threshold: 300, label: "Flowering" },
  { key: "fruiting", threshold: 600, label: "Fruiting" },
];

function computeStage(p: number) {
  let s = STAGES[0];
  for (const st of STAGES) if (p >= st.threshold) s = st;
  return s;
}

function StageGuideCard({ stages, currentIdx }: { stages: any[]; currentIdx: number }) {
  return (
    <div className="bg-slate-900 shadow-xl border border-blue-500/10 p-5 rounded-[22px]">
      <div className="text-sm font-bold text-slate-300 mb-4 tracking-tight uppercase opacity-60">Maturation Stages</div>
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-4 mb-3 group">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300 ${i <= currentIdx ? "bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]" : "bg-slate-800 text-slate-600 border border-slate-700"}`}>
            {i <= currentIdx ? "\u2713" : i + 1}
          </div>
          <div className="flex-1">
            <div className={`text-sm font-bold transition-colors ${i === currentIdx ? "text-green-400" : i < currentIdx ? "text-slate-300" : "text-slate-600"}`}>{s.label}</div>
            <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{s.threshold} Points Required</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* Helper: read the project points state for a project, returning 0 on error. */
function safeNum(v: any, fallback = 0): number {
  const n = parseInt(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/* Helper: derive ProjectHealth from tasks counts and lastActive date. */
function deriveHealthFromTasks(
  overdueCount: number,
  pendingCount: number,
  completedCount: number,
  totalTasks: number,
  lastActiveIso: string | null | undefined
): ProjectHealth {
  if (overdueCount > 0) return 'red';
  if (totalTasks === 0) {
    // No tasks - blue if recently active, else green
    if (lastActiveIso) {
      const days = Math.floor((Date.now() - new Date(lastActiveIso).getTime()) / 86400000);
      if (days <= 3) return 'blue';
    }
    return 'green';
  }
  if (completedCount >= pendingCount) return 'blue';
  return 'green';
}


export default function AchievementsPage() {
  const { user } = useAuth();
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [currentPoints, setCurrentPoints] = useState<number>(0);
  const [decayStatus, setDecayStatus] = useState<'active' | 'wilting' | 'dying'>('active');
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [showDailySummary, setShowDailySummary] = useState(false);
  const [showKeyStepPanel, setShowKeyStepPanel] = useState(true);
  const badges = gamification.getBadges();

  const { data: pmsProjects = [] } = useQuery<any[]>({
    queryKey: ['/api/projects', user?.id],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/projects?userRole=${user?.role}&userEmpCode=${user?.employeeCode}&userDepartment=${user?.department}`);
        if (!response.ok) throw new Error('Failed to fetch projects');
        const data = await response.json();
        if (data.length > 0 && !selectedProject) {
          setSelectedProject(data[0].project_name);
        }
        return data;
      } catch (e) { return []; }
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    const qId = setInterval(() => {
      setQuoteIdx(prev => (prev + 1) % JOLLY_MOTIVATIONS.length);
    }, 6000);
    return () => clearInterval(qId);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!selectedProject) {
        setCurrentPoints(0);
        setDecayStatus('active');
        return;
      }
      try {
        const pts = await fetchProjectPoints(selectedProject);
        if (!mounted) return;
        const ds = await fetchProjectDecayStatus(selectedProject);
        if (!mounted) return;
        setCurrentPoints(pts);
        setDecayStatus(ds as any);
      } catch (e) {
        setCurrentPoints(0);
        setDecayStatus('active');
      }
    }
    load();
    return () => { mounted = false; };
  }, [selectedProject]);

  /* ══════════════════════════════════════════════════════════
     NEW: Fetch project key steps, time entries and project
     tasks for the selected project to:
       - Render the key step fruits on the tree
       - Compute project health (water buckets)
       - Provide a quick "view key steps" panel
     Existing functionality (point totals, stage, decay) is
     preserved.
  ══════════════════════════════════════════════════════════ */

  // Key steps (titles only from PMS) for the selected project
  const { data: keySteps = [] } = useQuery<any[]>({
    queryKey: ['/api/key-steps', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return [];
      try {
        const res = await fetch(`/api/key-steps?projectId=${encodeURIComponent(selectedProject)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
    enabled: !!selectedProject,
  });

  // Project tasks (PMS) to determine overdue / pending / completed counts
  const { data: projectTasks = [] } = useQuery<any[]>({
    queryKey: ['/api/tasks/project', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return [];
      try {
        const res = await fetch(`/api/tasks?projectName=${encodeURIComponent(selectedProject)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
    enabled: !!selectedProject,
  });

  // Employee time-entries (for lastActive / completed counts)
  const { data: employeeEntries = [] } = useQuery<any[]>({
    queryKey: ['/api/time-entries/employee', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const res = await fetch(`/api/time-entries/employee/${user.id}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    },
    enabled: !!user?.id,
  });

  // Build a set of keyStep IDs that are completed via approved time-entries
  // and a set of overdue/pending/active via project tasks
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const { overdueCount, pendingCount, completedCount, lastActiveIso, keyStepStatusMap } = useMemo(() => {
    const completedKeyStepIds = new Set<string>();
    let lastActive: string | null = null;

    // Walk time entries to find completed key step IDs and last activity
    (employeeEntries as any[]).forEach(e => {
      const ksId = (e as any).keyStepId || (e as any).key_step_id;
      if (e.status === 'approved' && ksId) completedKeyStepIds.add(String(ksId));
      const sub = e.submittedAt || e.approvedAt || e.createdAt;
      if (sub) {
        if (!lastActive || new Date(sub).getTime() > new Date(lastActive).getTime()) {
          lastActive = sub;
        }
      }
    });

    // Compute task counts by mapping keyStep -> status from project tasks
    let overdue = 0;
    let pending = 0;
    let completed = 0;
    const ksMap: Record<string, 'completed' | 'pending' | 'overdue'> = {};

    (projectTasks as any[]).forEach(t => {
      const ksId = t.key_step_id || t.keyStepId;
      const endDate = t.end_date || t.endDate;
      const status = (t.status || '').toLowerCase();
      const isCompleted = status === 'completed' || status === 'done' || status === 'approved';
      if (isCompleted) {
        completed++;
        if (ksId) ksMap[String(ksId)] = 'completed';
      } else {
        // Pending: has end date in future OR no end date
        if (endDate) {
          const ed = new Date(endDate);
          if (!isNaN(ed.getTime()) && ed.getTime() < today.getTime()) {
            overdue++;
            if (ksId) ksMap[String(ksId)] = 'overdue';
          } else {
            pending++;
            if (ksId) ksMap[String(ksId)] = 'pending';
          }
        } else {
          pending++;
          if (ksId) ksMap[String(ksId)] = 'pending';
        }
      }
    });

    // If we have time-entries that completed a key step, ensure that takes precedence
    completedKeyStepIds.forEach(id => {
      ksMap[id] = 'completed';
    });

    return {
      overdueCount: overdue,
      pendingCount: pending,
      completedCount: completed,
      lastActiveIso: lastActive,
      keyStepStatusMap: ksMap,
    };
  }, [projectTasks, employeeEntries, todayStr]);

  // Build the array of KeyStepFruitData for the tree
  const keyStepFruits = useMemo(() => {
    if (!keySteps || keySteps.length === 0) return [];
    return (keySteps as any[]).map((ks: any) => {
      const id = String(ks.id);
      // If we have a known status, use it. Otherwise default to pending.
      const status: 'completed' | 'pending' | 'overdue' = keyStepStatusMap[id] || 'pending';
      return { id, name: ks.name || ks.title || 'Key Step', status };
    });
  }, [keySteps, keyStepStatusMap]);

  // Compute health
  const totalTasks = overdueCount + pendingCount + completedCount;
  const isActivelyUpdating = !!lastActiveIso && (Date.now() - new Date(lastActiveIso).getTime()) < 3 * 86400000;
  const health: ProjectHealth = deriveHealthFromTasks(
    overdueCount, pendingCount, completedCount, totalTasks, lastActiveIso
  );

  const stage = computeStage(currentPoints);
  const idx = STAGES.findIndex(s => s.key === stage.key);
  const nextStage = STAGES[idx + 1];
  const progress = nextStage ? Math.round(((currentPoints - stage.threshold) / (nextStage.threshold - stage.threshold)) * 100) : 100;

  const handleCelebrate = () => { try { confettiBurst(); } catch { } };

  /* Keep currentPoints in sync if the gamification library dispatches updates
     after we returned to the page (e.g., user just submitted timesheet). */
  useEffect(() => {
    function refresh() {
      if (!selectedProject) {
        setCurrentPoints(0);
        return;
      }
      try {
        fetchProjectPoints(selectedProject).then(p => setCurrentPoints(p)).catch(() => { });
      } catch { }
    }
    window.addEventListener('gamification:daily-summary-updated', refresh as EventListener);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('gamification:daily-summary-updated', refresh as EventListener);
      window.removeEventListener('storage', refresh);
    };
  }, [selectedProject]);

  return (
    <div className="min-h-screen bg-[#050810] text-slate-200 p-6 md:p-10 font-sans page-bg-fix">
      <style>{`
        @keyframes growIn{ from{transform:scale(0.95);opacity:0;} to{transform:scale(1);opacity:1;} }
        @keyframes float{ from{transform:translateY(0px) rotate(0deg);} to{transform:translateY(-8px) rotate(1deg);} }
        .ach-card:hover { transform: translateY(-4px); background: rgba(255,255,255,0.05); }
        .spark-box {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(236, 72, 153, 0.15));
          border: 1px solid rgba(255, 255, 255, 0.1);
          animation: float 4s ease-in-out infinite alternate;
          transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .spark-box:hover {
          transform: translateY(-12px) scale(1.02);
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(236, 72, 153, 0.25));
          border-color: rgba(255, 255, 255, 0.3);
          box-shadow: 0 20px 40px rgba(0,0,0,0.4), 0 0 20px rgba(99, 102, 241, 0.2);
        }
      `}</style>

      <div className="max-w-[1400px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8">

        {/* Main Tree Column */}
        <div className="xl:col-span-8 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-4xl font-black text-white tracking-tighter">THE GROWTH ARCHIVE</h1>
              <p className="text-blue-400 font-medium tracking-wide text-sm uppercase opacity-70">Employee Productivity Visualizer</p>
            </div>

            <div className="flex items-center gap-4 bg-slate-900/80 backdrop-blur-md p-2 rounded-2xl border border-blue-500/20 shadow-2xl">
              <Select value={selectedProject} onValueChange={(v) => setSelectedProject(v)}>
                <SelectTrigger className="w-56 bg-transparent border-none text-white font-semibold focus:ring-0">
                  <SelectValue placeholder="Select Project" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-blue-500/20 text-white">
                  {pmsProjects.map((p: any) => (
                    <SelectItem key={p.project_name} value={p.project_name} className="focus:bg-blue-500/20 focus:text-white">{p.project_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="h-8 w-px bg-slate-800" />
              <div className="text-right px-2">
                <div className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Points</div>
                <div className="text-2xl font-black text-white leading-none">{currentPoints}</div>
              </div>
              <button
                onClick={() => setShowDailySummary(true)}
                className="px-3 py-2 rounded-xl bg-emerald-600/80 hover:bg-emerald-600 text-white font-bold transition-all shadow-lg active:scale-95 text-xs flex items-center gap-1"
                title="Show today's points summary"
                data-testid="button-open-daily-summary"
              >
                <Sparkles className="w-3 h-3" />
                Summary
              </button>
              <button
                onClick={handleCelebrate}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-lg active:scale-95 text-sm"
              >
                Celebrate
              </button>
            </div>
          </div>

          <div className="bg-slate-900/40 rounded-[32px] border border-blue-500/10 overflow-hidden shadow-inner flex flex-col max-w-5xl mx-auto w-full">
            <div className="achievement-tree-wrapper relative w-full aspect-[16/8] overflow-hidden group p-4">
              <AchievementTree projectId={selectedProject} keySteps={keyStepFruits} />
            </div>

            <div className="p-8 border-t border-white/5 bg-slate-900/60 transition-all duration-300">
              <div className="flex justify-between items-center mb-4">
                <div className="flex flex-col">
                  <span className="text-xs font-black text-blue-400 uppercase tracking-[0.2em]">Next Milestone: {nextStage?.label || 'Supreme'}</span>
                  <span className={`text-[10px] font-bold mt-1 ${decayStatus === 'dying' ? 'text-red-500' : decayStatus === 'wilting' ? 'text-amber-500' : 'text-green-500'}`}>
                    {decayStatus === 'dying' ? '🥀 Project Abandoned' : decayStatus === 'wilting' ? '🍂 Wilting Inactivity' : '🌱 Growing Healthy'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">{currentPoints} / {nextStage?.threshold || 600}</span>
                  <span className="text-sm font-black text-green-400">{progress}%</span>
                </div>
              </div>
              <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-0.5">
                <div
                  className={`h-full transition-all duration-1000 shadow-[0_0_15px_rgba(34,197,94,0.3)] rounded-full ${decayStatus === 'dying' ? 'bg-red-500' : decayStatus === 'wilting' ? 'bg-amber-500' : 'bg-gradient-to-r from-green-600 via-green-400 to-emerald-300'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* NEW: Project Health Buckets below the tree */}
            <div className="p-6 border-t border-white/5 bg-slate-900/40" data-testid="project-health-section">
              <ProjectHealthBuckets
                isActivelyUpdating={isActivelyUpdating}
                overdueCount={overdueCount}
                pendingCount={pendingCount}
                completedCount={completedCount}
                totalTasks={totalTasks}
                health={health}
              />
            </div>
          </div>

          {/* NEW: Key Steps Panel (collapsed by default for small screens) */}
          <div className="bg-slate-900/40 rounded-[28px] border border-blue-500/10 p-6 max-w-5xl mx-auto w-full">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Trophy className="w-5 h-5 text-amber-300" />
                <h2 className="text-lg font-black text-white tracking-tight">Project Key Steps</h2>
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                  {keySteps.length} total
                </span>
              </div>
              <button
                onClick={() => setShowKeyStepPanel(s => !s)}
                className="text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1"
                data-testid="button-toggle-keysteps"
              >
                {showKeyStepPanel ? <><EyeOff className="w-3 h-3" /> Hide</> : <><Eye className="w-3 h-3" /> Show</>}
              </button>
            </div>
            {showKeyStepPanel && (
              <>
                {keyStepFruits.length === 0 ? (
                  <div className="text-xs text-slate-400 italic py-3">
                    No key steps configured for this project yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {keyStepFruits.map(ks => {
                      const icon = ks.status === 'completed' ? '🟢' : ks.status === 'overdue' ? '🔴' : '🟡';
                      const label = ks.status === 'completed' ? 'Completed' : ks.status === 'overdue' ? 'Overdue' : 'Pending';
                      const cls =
                        ks.status === 'completed'
                          ? 'border-emerald-500/30 bg-emerald-500/10'
                          : ks.status === 'overdue'
                            ? 'border-rose-500/30 bg-rose-500/10'
                            : 'border-amber-500/30 bg-amber-500/10';
                      return (
                        <div
                          key={ks.id}
                          className={`flex items-center gap-2 p-2 rounded-lg border ${cls} transition-all hover:scale-[1.02]`}
                          title={`${ks.name} (${label})`}
                          data-testid={`keystep-${ks.status}`}
                        >
                          <span className="text-lg" aria-hidden>{icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-white truncate">{ks.name}</div>
                            <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">{label}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="text-sm" aria-hidden>🟢</span> Completed</span>
              <span className="flex items-center gap-1"><span className="text-sm" aria-hidden>🟡</span> Pending</span>
              <span className="flex items-center gap-1"><span className="text-sm" aria-hidden>🔴</span> Overdue</span>
              <span className="ml-auto text-[9px] uppercase tracking-widest text-blue-300/80">These appear as fruits on the tree</span>
            </div>
          </div>
        </div>

        {/* Info Column (Right Side) */}
        <div className="xl:col-span-4 flex flex-col gap-6">

          <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900 p-8 rounded-[32px] border border-indigo-500/20 shadow-2xl">
            <h2 className="text-xl font-black text-white mb-6 flex items-center gap-3 italic">
              <span className="text-3xl not-italic">🎖</span> ACHIEVEMENTS
            </h2>
            <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {badges.length === 0 ? (
                <div className="py-10 text-center opacity-40 italic text-sm text-slate-400">Submit your first task to unlock your legacy.</div>
              ) : badges.map(b => (
                <div key={b.id} className="ach-card flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 transition-all cursor-default">
                  <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-xl">
                    {b.id.includes('streak') ? '🔥' : b.id.includes('first') ? '⭐' : '🏆'}
                  </div>
                  <div>
                    <div className="text-sm font-black text-white uppercase tracking-wider">{b.name}</div>
                    <div className="text-[10px] text-indigo-300 font-bold opacity-70">UNLOCKED {new Date(b.awardedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <StageGuideCard stages={STAGES} currentIdx={idx} />

          <div className="spark-box relative overflow-hidden p-8 rounded-[32px] group cursor-pointer">
            <div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/20 blur-[60px] group-hover:bg-indigo-500/40 transition-colors" />
            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-pink-500/20 blur-[60px] group-hover:bg-pink-500/40 transition-colors" />

            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="w-12 h-12 mb-4 bg-white/10 rounded-2xl flex items-center justify-center text-2xl animate-bounce shadow-xl">
                U+2728
              </div>
              <div className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-3 opacity-80">Daily Spark</div>
              <p className="text-white text-lg font-black leading-tight tracking-tight min-h-[3.5rem] flex items-center justify-center transition-all duration-500" key={quoteIdx}>
                {JOLLY_MOTIVATIONS[quoteIdx]}
              </p>
              <div className="mt-4 flex gap-1">
                {JOLLY_MOTIVATIONS.map((_, i) => (
                  <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i === quoteIdx ? "w-6 bg-indigo-500" : "w-1 bg-white/10"}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Points Summary Dialog (NEW) */}
      <DailyPointsSummaryDialog open={showDailySummary} onOpenChange={setShowDailySummary} />
    </div>
  );
}
