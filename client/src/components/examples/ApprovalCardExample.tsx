import { useState } from 'react';
import ApprovalCard from '../ApprovalCard';

// todo: remove mock functionality
const mockSubmission = {
  id: '1',
  employeeName: 'Mohanraj C',
  employeeCode: 'EMP041',
  submissionDate: 'December 11, 2025',
  totalHours: 8,
  productiveHours: 6.5,
  idleHours: 1.5,
  status: 'pending' as const,
  tasks: [
    {
      project: 'Website Redesign',
      taskName: 'Website Development',
      subtask: 'Frontend Implementation',
      duration: '3h 30m',
      description: 'Implemented the new landing page design using React and Tailwind CSS.',
      quantifyResult: 'Completed 3 sections',
      achievements: 'Optimized load time by 20%',
      problemsIssues: 'None',
      scopeImprovements: 'Add animations',
      tools: ['VS Code', 'Chrome', 'ChatGPT']
    },
    {
      project: 'Internal Review',
      taskName: 'Team Meeting',
      subtask: 'Weekly Sync',
      duration: '1h',
      description: 'Discussed project progress and upcoming deadlines.',
      quantifyResult: 'N/A',
      achievements: 'Aligned on next steps',
      problemsIssues: 'None',
      scopeImprovements: 'Shorter meetings',
      tools: ['MS Teams']
    },
    {
      project: 'Knowledge Base',
      taskName: 'Documentation',
      subtask: 'API Docs',
      duration: '2h',
      description: 'Wrote documentation for the new authentication endpoints.',
      quantifyResult: '5 endpoints documented',
      achievements: 'Clear examples added',
      problemsIssues: 'Missing some error codes',
      scopeImprovements: 'Add more examples',
      tools: ['Notion', 'Word']
    },
  ],
};

export default function ApprovalCardExample() {
  const [selected, setSelected] = useState(false);

  return (
    <div className="bg-slate-950 min-h-screen p-6">
      <div className="max-w-xl mx-auto">
        <ApprovalCard
          submission={mockSubmission}
          isSelected={selected}
          onSelect={(_, sel) => setSelected(sel)}
          onApprove={(id) => console.log('Approved:', id)}
          onReject={(id, reason) => console.log('Rejected:', id, reason)}
        />
      </div>
    </div>
  );
}
