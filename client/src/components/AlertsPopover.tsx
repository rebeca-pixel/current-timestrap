
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Bell, Check, AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';

interface Alert {
  id: string;
  type: 'missing_submission' | 'late_submission' | 'approval_required';
  message: string;
  date: string;
  isRead: boolean;
  createdAt: string;
}

export default function AlertsPopover({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false);

  const { data: alerts = [], isLoading } = useQuery<Alert[]>({
    queryKey: [`/api/alerts/${employeeId}`],
    enabled: !!employeeId,
    refetchInterval: 30000, // Refresh every 30s
  });

  const unreadCount = alerts.filter(a => !a.isRead).length;

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('POST', `/api/alerts/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/alerts/${employeeId}`] });
    }
  });

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'missing_submission': return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'late_submission': return <Clock className="w-4 h-4 text-amber-500" />;
      default: return <Bell className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-slate-400 hover:text-white">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-slate-900">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-slate-900 border-slate-800 shadow-2xl" align="end">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-white">Notifications</h3>
          {unreadCount > 0 && (
            <span className="text-[10px] font-bold bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">
              {unreadCount} NEW
            </span>
          )}
        </div>
        <ScrollArea className="h-[350px]">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-slate-500 italic text-sm">
              No notifications yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {alerts.map((alert) => (
                <div 
                  key={alert.id} 
                  className={`p-4 transition-colors hover:bg-slate-800/30 group ${!alert.isRead ? 'bg-blue-500/5' : ''}`}
                >
                  <div className="flex gap-3">
                    <div className="mt-1">{getAlertIcon(alert.type)}</div>
                    <div className="flex-1 space-y-1">
                      <p className={`text-sm leading-relaxed ${!alert.isRead ? 'text-white font-medium' : 'text-slate-400'}`}>
                        {alert.message}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 font-medium">
                          {format(new Date(alert.createdAt), 'MMM dd, hh:mm a')}
                        </span>
                        {!alert.isRead && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-md"
                            onClick={() => markReadMutation.mutate(alert.id)}
                          >
                            <Check className="w-3 h-3 mr-1" />
                            Mark read
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="p-2 border-t border-slate-800 text-center">
          <Button variant="ghost" className="w-full text-[10px] text-slate-500 hover:text-slate-300 h-8">
            View All Notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
