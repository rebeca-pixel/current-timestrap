import TaskTable from '../TaskTable';

// todo: remove mock functionality
const mockTasks = [
  {
    id: '1',
    project: 'Website Redesign',
    title: 'Update homepage layout',
    description: 'Redesign the hero section with new branding',
    problemAndIssues: 'Layout was not responsive on mobile devices',
    quantify: 'Improved mobile responsiveness by 40%',
    achievements: 'Successfully redesigned hero section with new branding',
    scopeOfImprovements: 'Could add more animations and micro-interactions',
    toolsUsed: ['Canva', 'Chrome', 'Notion'],
    startTime: '09:00',
    endTime: '10:30',
    durationMinutes: 90,
    percentageComplete: 100,
    isComplete: true,
  },
  {
    id: '2',
    project: 'API Integration',
    title: 'Implement payment gateway',
    description: 'Integrate Razorpay for Indian payments',
    problemAndIssues: 'API documentation was outdated',
    quantify: 'Integrated payment gateway for 1000+ transactions',
    achievements: 'Successfully integrated Razorpay payment gateway',
    scopeOfImprovements: 'Could add support for international payments',
    toolsUsed: ['VS Code', 'Chrome', 'ChatGPT', 'Zoho Books'],
    startTime: '11:00',
    endTime: '13:00',
    durationMinutes: 120,
    percentageComplete: 60,
    isComplete: false,
  },
  {
    id: '3',
    project: 'Team Sync',
    title: 'Weekly standup meeting',
    description: 'Team status update and planning',
    problemAndIssues: 'Meeting ran over time due to off-topic discussions',
    quantify: 'Completed standup in 30 minutes as scheduled',
    achievements: 'Successfully conducted weekly team standup',
    scopeOfImprovements: 'Could implement a more structured agenda',
    toolsUsed: ['MS Teams', 'Google Calendar'],
    startTime: '14:00',
    endTime: '14:30',
    durationMinutes: 30,
    percentageComplete: 100,
    isComplete: true,
  },
];

export default function TaskTableExample() {
  return (
    <div className="bg-slate-950 min-h-screen p-6">
      <TaskTable 
        tasks={mockTasks}
        onEdit={(task) => console.log('Edit:', task)}
        onDelete={(id) => console.log('Delete:', id)}
        onComplete={(id) => console.log('Complete:', id)}
      />
    </div>
  );
}
