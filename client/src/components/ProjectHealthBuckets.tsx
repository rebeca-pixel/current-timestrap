import React, { useMemo } from 'react';

export type ProjectHealth = 'blue' | 'green' | 'red';

export interface ProjectHealthBucketsProps {
  /**
   * Whether the employee is actively updating tasks.
   * If true, the blue bucket can show.
   */
  isActivelyUpdating?: boolean;
  /**
   * Number of overdue tasks in the project.
   */
  overdueCount?: number;
  /**
   * Number of pending/in-progress tasks.
   */
  pendingCount?: number;
  /**
   * Total number of tasks.
   */
  totalTasks?: number;
  /**
   * Number of completed tasks.
   */
  completedCount?: number;
  /**
   * Force a specific health color. If not provided, it is computed
   * from the other props.
   */
  health?: ProjectHealth;
}

/**
 * Compute the project's health bucket.
 *
 * Red bucket:
 *  - One or more overdue tasks.
 *
 * Green bucket:
 *  - Most tasks are progressing well, with only minor pending work.
 *  - In other words, there are no overdue tasks, and pending tasks
 *    are less than half of total tasks.
 *
 * Blue bucket:
 *  - Employee is actively updating tasks AND there are no overdue tasks.
 *  - This represents the "thriving" state.
 */
export function computeProjectHealth(props: {
  isActivelyUpdating?: boolean;
  overdueCount?: number;
  pendingCount?: number;
  totalTasks?: number;
  completedCount?: number;
}): ProjectHealth {
  const overdue = props.overdueCount || 0;
  const pending = props.pendingCount || 0;
  const total = props.totalTasks || 0;
  const completed = props.completedCount || 0;
  const activelyUpdating = !!props.isActivelyUpdating;

  if (overdue > 0) return 'red';

  if (total === 0) {
    // No tasks yet — blue if active, green otherwise
    return activelyUpdating ? 'blue' : 'green';
  }

  // No overdue tasks: decide between blue (thriving) and green (mostly ok)
  // If completed >= pending AND user is actively updating → blue
  // Otherwise green
  if (activelyUpdating && completed >= pending) return 'blue';
  if (activelyUpdating) return 'green';

  // Not actively updating but no overdue
  return pending > 0 ? 'green' : 'blue';
}

interface BucketConfig {
  key: ProjectHealth;
  emoji: string;
  label: string;
  description: string;
  bgGradient: string;
  borderColor: string;
  textColor: string;
  ring: string;
  waterDrips: { x: number; h: number; delay: number }[];
}

const BUCKETS: Record<ProjectHealth, BucketConfig> = {
  blue: {
    key: 'blue',
    emoji: '💧',
    label: 'Thriving',
    description: 'Actively updating tasks, no overdue items. Excellent momentum!',
    bgGradient: 'from-sky-500/20 to-blue-600/20',
    borderColor: 'border-sky-400/40',
    textColor: 'text-sky-200',
    ring: 'ring-sky-400/30',
    waterDrips: [
      { x: 18, h: 12, delay: 0 },
      { x: 42, h: 16, delay: 0.4 },
      { x: 65, h: 10, delay: 0.8 },
      { x: 85, h: 14, delay: 1.2 },
    ],
  },
  green: {
    key: 'green',
    emoji: '🟢',
    label: 'Healthy',
    description: 'Project is progressing well, only minor pending work remains.',
    bgGradient: 'from-emerald-500/20 to-green-600/20',
    borderColor: 'border-emerald-400/40',
    textColor: 'text-emerald-200',
    ring: 'ring-emerald-400/30',
    waterDrips: [
      { x: 25, h: 8, delay: 0.2 },
      { x: 55, h: 12, delay: 0.6 },
      { x: 80, h: 9, delay: 1.0 },
    ],
  },
  red: {
    key: 'red',
    emoji: '🔴',
    label: 'At Risk',
    description: 'Overdue tasks detected. Project health is at risk — act now!',
    bgGradient: 'from-rose-500/20 to-red-600/20',
    borderColor: 'border-rose-400/40',
    textColor: 'text-rose-200',
    ring: 'ring-rose-400/30',
    waterDrips: [
      { x: 35, h: 4, delay: 0.1 },
      { x: 60, h: 3, delay: 0.5 },
    ],
  },
};

function WaterBucket({ config, active }: { config: BucketConfig; active: boolean }) {
  return (
    <div
      className={`relative flex flex-col items-center justify-end p-3 rounded-2xl bg-gradient-to-br ${config.bgGradient} border ${config.borderColor} ${active ? `ring-2 ${config.ring}` : 'opacity-40 grayscale'} transition-all duration-500 min-w-[110px] flex-1`}
      data-testid={`bucket-${config.key}${active ? '-active' : ''}`}
    >
      {/* Tiny warning emojis for red bucket */}
      {config.key === 'red' && active && (
        <div className="absolute -top-2 -right-1 text-base animate-bounce" aria-hidden>⚠️</div>
      )}
      {config.key === 'red' && active && (
        <div className="absolute -top-3 -left-1 text-base animate-pulse" aria-hidden>😟</div>
      )}

      {/* Bucket SVG */}
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <defs>
            <linearGradient id={`bucketGrad-${config.key}`} x1="0" y1="0" x2="0" y2="1">
              {config.key === 'blue' && (
                <>
                  <stop offset="0%" stopColor="#7dd3fc" />
                  <stop offset="100%" stopColor="#0284c7" />
                </>
              )}
              {config.key === 'green' && (
                <>
                  <stop offset="0%" stopColor="#86efac" />
                  <stop offset="100%" stopColor="#16a34a" />
                </>
              )}
              {config.key === 'red' && (
                <>
                  <stop offset="0%" stopColor="#fca5a5" />
                  <stop offset="100%" stopColor="#b91c1c" />
                </>
              )}
            </linearGradient>
            <linearGradient id={`waterGrad-${config.key}`} x1="0" y1="0" x2="0" y2="1">
              {config.key === 'blue' && (
                <>
                  <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#0284c7" stopOpacity="0.95" />
                </>
              )}
              {config.key === 'green' && (
                <>
                  <stop offset="0%" stopColor="#bbf7d0" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#15803d" stopOpacity="0.95" />
                </>
              )}
              {config.key === 'red' && (
                <>
                  <stop offset="0%" stopColor="#fecaca" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0.95" />
                </>
              )}
            </linearGradient>
          </defs>

          {/* Bucket body (trapezoid) */}
          <path
            d="M 20 35 L 80 35 L 75 85 L 25 85 Z"
            fill={`url(#bucketGrad-${config.key})`}
            stroke="#0f172a"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {/* Bucket rim */}
          <ellipse cx="50" cy="35" rx="30" ry="5" fill={`url(#bucketGrad-${config.key})`} stroke="#0f172a" strokeWidth="2.5" />
          <ellipse cx="50" cy="35" rx="26" ry="3" fill="#0f172a" opacity="0.25" />

          {/* Water level - varies by health */}
          {config.key === 'blue' && (
            <path
              d="M 22 55 Q 50 48 78 55 L 75 82 L 25 82 Z"
              fill={`url(#waterGrad-${config.key})`}
            >
              <animate attributeName="d" dur="3s" repeatCount="indefinite"
                values="M 22 55 Q 50 48 78 55 L 75 82 L 25 82 Z;
                        M 22 52 Q 50 58 78 52 L 75 82 L 25 82 Z;
                        M 22 55 Q 50 48 78 55 L 75 82 L 25 82 Z" />
            </path>
          )}
          {config.key === 'green' && (
            <path
              d="M 22 60 Q 50 55 78 60 L 75 82 L 25 82 Z"
              fill={`url(#waterGrad-${config.key})`}
            />
          )}
          {config.key === 'red' && (
            <path
              d="M 22 72 Q 50 68 78 72 L 75 82 L 25 82 Z"
              fill={`url(#waterGrad-${config.key})`}
            />
          )}

          {/* Water highlight */}
          {active && (
            <ellipse cx="38" cy={config.key === 'blue' ? 50 : config.key === 'green' ? 55 : 68} rx="6" ry="1.5" fill="white" opacity="0.5" />
          )}

          {/* Handle */}
          <path
            d="M 35 35 Q 50 20 65 35"
            fill="none"
            stroke="#0f172a"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Drip animation for active bucket */}
      {active && (
        <div className="absolute inset-x-0 top-0 h-2 pointer-events-none">
          {config.waterDrips.map((d, i) => (
            <span
              key={i}
              className={`absolute text-base`}
              style={{
                left: `${d.x}%`,
                animation: `bucketDrip 1.8s ${d.delay}s ease-in infinite`,
                opacity: 0.7,
              }}
              aria-hidden
            >
              💧
            </span>
          ))}
        </div>
      )}

      <div className={`mt-2 text-xs font-black uppercase tracking-widest ${config.textColor}`}>
        {config.label}
      </div>
      <div className="text-base mt-0.5" aria-hidden>{config.emoji}</div>
    </div>
  );
}

export default function ProjectHealthBuckets(props: ProjectHealthBucketsProps) {
  const health = useMemo<ProjectHealth>(() => {
    if (props.health) return props.health;
    return computeProjectHealth(props);
  }, [props.health, props.isActivelyUpdating, props.overdueCount, props.pendingCount, props.totalTasks, props.completedCount]);

  const overdue = props.overdueCount || 0;
  const pending = props.pendingCount || 0;
  const completed = props.completedCount || 0;
  const total = props.totalTasks || 0;
  const activeConfig = BUCKETS[health];

  return (
    <div className="w-full">
      <style>{`
        @keyframes bucketDrip {
          0% { transform: translateY(-10px); opacity: 0; }
          30% { opacity: 0.9; }
          100% { transform: translateY(60px); opacity: 0; }
        }
      `}</style>

      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-[10px] font-black text-blue-300 uppercase tracking-[0.25em]">
            Project Health
          </div>
          <div className="text-[10px] text-slate-400 font-bold">
            {overdue > 0
              ? <span className="text-rose-300">⚠️ {overdue} overdue</span>
              : pending > 0
                ? <span className="text-amber-300">🟡 {pending} pending</span>
                : <span className="text-emerald-300">✅ All on track</span>}
          </div>
        </div>

        <div className="flex items-stretch gap-3" data-testid="project-health-buckets">
          <WaterBucket config={BUCKETS.blue} active={health === 'blue'} />
          <WaterBucket config={BUCKETS.green} active={health === 'green'} />
          <WaterBucket config={BUCKETS.red} active={health === 'red'} />
        </div>

        <div className="mt-3 px-3 py-2 rounded-lg bg-slate-900/50 border border-slate-700/60">
          <div className={`text-[11px] font-bold ${activeConfig.textColor} flex items-center gap-2`}>
            <span aria-hidden>{activeConfig.emoji}</span>
            <span>{activeConfig.label}: {activeConfig.description}</span>
          </div>
          {total > 0 && (
            <div className="mt-1 text-[10px] text-slate-400 flex items-center gap-3">
              <span>📋 {total} total</span>
              <span className="text-emerald-300">✅ {completed} done</span>
              <span className="text-amber-300">🟡 {pending} pending</span>
              {overdue > 0 && <span className="text-rose-300">🔴 {overdue} overdue</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
