import AnalyticsPanel from '../AnalyticsPanel';

// todo: remove mock functionality
const mockData = {
  productiveMinutes: 240,
  idleMinutes: 30,
  neutralMinutes: 45,
  nonProductiveMinutes: 15,
  taskHours: [
    { task: 'Development', hours: 3 },
    { task: 'Meetings', hours: 1.5 },
    { task: 'Documentation', hours: 1 },
    { task: 'Code Review', hours: 0.5 },
  ],
  toolsUsage: [
    { tool: 'VS Code', minutes: 180 },
    { tool: 'Chrome', minutes: 90 },
    { tool: 'MS Teams', minutes: 45 },
    { tool: 'Notion', minutes: 30 },
    { tool: 'ChatGPT', minutes: 25 },
  ],
  hourlyProductivity: [
    { hour: '9AM', minutes: 45 },
    { hour: '10AM', minutes: 55 },
    { hour: '11AM', minutes: 50 },
    { hour: '12PM', minutes: 30 },
    { hour: '1PM', minutes: 20 },
    { hour: '2PM', minutes: 50 },
    { hour: '3PM', minutes: 55 },
    { hour: '4PM', minutes: 40 },
  ],
};

export default function AnalyticsPanelExample() {
  return (
    <div className="bg-slate-950 min-h-screen p-6">
      <AnalyticsPanel {...mockData} />
    </div>
  );
}
