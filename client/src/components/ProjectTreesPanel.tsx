import React from 'react';
import AchievementTree from './AchievementTree';

export default function ProjectTreesPanel({ projects }: { projects: Array<{ project_name: string }> }) {
  // show up to 6 projects, prefer ones provided
  const list = (projects || []).slice(0, 6);
  if (list.length === 0) return null;

  return (
    <div className="project-trees-panel grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {list.map(p => (
        <div key={p.project_name} className="p-3 bg-slate-900/40 border border-blue-500/10 rounded-lg">
          <div className="text-sm text-blue-200 mb-2 font-semibold">{p.project_name}</div>
          <div style={{ height: 220 }}>
            <AchievementTree projectId={p.project_name} />
          </div>
        </div>
      ))}
    </div>
  );
}
