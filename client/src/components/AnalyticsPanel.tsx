import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler);

interface AnalyticsPanelProps {
  productiveMinutes: number;
  idleMinutes: number;
  neutralMinutes: number;
  nonProductiveMinutes: number;
  taskHours: { task: string; hours: number }[];
  toolsUsage: { tool: string; minutes: number }[];
  hourlyProductivity: { hour: string; minutes: number }[];
}

export default function AnalyticsPanel({
  productiveMinutes,
  idleMinutes,
  neutralMinutes,
  nonProductiveMinutes,
  taskHours,
  toolsUsage,
  hourlyProductivity,
}: AnalyticsPanelProps) {
  const totalMinutes = productiveMinutes + idleMinutes + neutralMinutes + nonProductiveMinutes;
  
  const workDistributionData = {
    labels: ['Productive', 'Idle', 'Neutral', 'Non-Productive'],
    datasets: [{
      data: [productiveMinutes, idleMinutes, neutralMinutes, nonProductiveMinutes],
      backgroundColor: [
        'rgba(34, 197, 94, 0.8)',
        'rgba(234, 179, 8, 0.8)',
        'rgba(99, 102, 241, 0.8)',
        'rgba(239, 68, 68, 0.8)',
      ],
      borderColor: [
        'rgba(34, 197, 94, 1)',
        'rgba(234, 179, 8, 1)',
        'rgba(99, 102, 241, 1)',
        'rgba(239, 68, 68, 1)',
      ],
      borderWidth: 2,
    }],
  };

  const taskHoursData = {
    labels: taskHours.length > 0 ? taskHours.map(t => t.task) : ['No tasks'],
    datasets: [{
      label: 'Hours',
      data: taskHours.length > 0 ? taskHours.map(t => t.hours) : [0],
      backgroundColor: 'rgba(59, 130, 246, 0.8)',
      borderColor: 'rgba(59, 130, 246, 1)',
      borderWidth: 1,
      borderRadius: 4,
    }],
  };

  const toolsData = {
    labels: toolsUsage.length > 0 ? toolsUsage.slice(0, 5).map(t => t.tool) : ['No tools logged'],
    datasets: [{
      data: toolsUsage.length > 0 ? toolsUsage.slice(0, 5).map(t => t.minutes) : [0],
      backgroundColor: [
        'rgba(59, 130, 246, 0.8)',
        'rgba(34, 211, 238, 0.8)',
        'rgba(168, 85, 247, 0.8)',
        'rgba(249, 115, 22, 0.8)',
        'rgba(34, 197, 94, 0.8)',
      ],
      borderWidth: 0,
    }],
  };

  const productivityData = {
    labels: hourlyProductivity.length > 0 ? hourlyProductivity.map(h => h.hour) : ['No data'],
    datasets: [{
      label: 'Minutes Worked',
      data: hourlyProductivity.length > 0 ? hourlyProductivity.map(h => h.minutes) : [0],
      borderColor: 'rgba(34, 211, 238, 1)',
      backgroundColor: 'rgba(34, 211, 238, 0.2)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: 'rgba(34, 211, 238, 1)',
      pointBorderColor: '#fff',
      pointRadius: 4,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: 'rgba(147, 197, 253, 0.8)',
          font: { size: 11 }
        }
      }
    }
  };

  const barOptions = {
    ...chartOptions,
    scales: {
      x: {
        ticks: { color: 'rgba(147, 197, 253, 0.6)' },
        grid: { color: 'rgba(59, 130, 246, 0.1)' }
      },
      y: {
        ticks: { color: 'rgba(147, 197, 253, 0.6)' },
        grid: { color: 'rgba(59, 130, 246, 0.1)' }
      }
    }
  };

  const lineOptions = {
    ...chartOptions,
    scales: {
      x: {
        ticks: { color: 'rgba(147, 197, 253, 0.6)' },
        grid: { color: 'rgba(59, 130, 246, 0.1)' }
      },
      y: {
        ticks: { color: 'rgba(147, 197, 253, 0.6)' },
        grid: { color: 'rgba(59, 130, 246, 0.1)' },
        beginAtZero: true,
      }
    }
  };

  return (
    <div className="tracker-analytics-outer-container">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-slate-800/50 border-blue-500/20 tracker-analytics-card card-work-distribution">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-200">Work Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {totalMinutes > 0 ? (
              <div className="h-48" data-testid="chart-work-distribution">
                <Doughnut data={workDistributionData} options={chartOptions} />
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                No tracked time data available
              </div>
            )}
          </CardContent>
        </Card>
  
        <Card className="bg-slate-800/50 border-blue-500/20 tracker-analytics-card card-tools-usage">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-200">Tools Usage (Live)</CardTitle>
          </CardHeader>
          <CardContent>
            {toolsUsage.length > 0 ? (
              <div className="h-48" data-testid="chart-tools-usage">
                <Doughnut data={toolsData} options={chartOptions} />
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                No tools logged yet - add tools when creating tasks
              </div>
            )}
          </CardContent>
        </Card>
  
        <Card className="bg-slate-800/50 border-blue-500/20 tracker-analytics-card card-task-hours">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-200">Task-wise Hours</CardTitle>
          </CardHeader>
          <CardContent>
            {taskHours.length > 0 ? (
              <div className="h-48" data-testid="chart-task-hours">
                <Bar data={taskHoursData} options={barOptions} />
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                No task data available
              </div>
            )}
          </CardContent>
        </Card>
  
        <Card className="bg-slate-800/50 border-blue-500/20 tracker-analytics-card card-hourly-productivity">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-200">Hourly Productivity (Live)</CardTitle>
          </CardHeader>
          <CardContent>
            {hourlyProductivity.length > 0 && hourlyProductivity.some(h => h.minutes > 0) ? (
              <div className="h-48" data-testid="chart-hourly-productivity">
                <Line data={productivityData} options={lineOptions} />
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                No hourly data - tracks based on task times
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
