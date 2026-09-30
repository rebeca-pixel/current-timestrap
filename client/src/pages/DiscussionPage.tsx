import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Send,
    ArrowLeft,
    Clock,
    MessageSquare,
    AlertCircle,
    Search,
    User as UserIcon,
    Layout
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { TimeEntry, Discussion, Employee } from '@shared/schema';


export default function DiscussionPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [message, setMessage] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    if (!user) return null;

    // Extract entryId from query params
    const params = new URLSearchParams(window.location.search);
    const entryId = params.get('entryId');

    const { data: entry } = useQuery<TimeEntry>({
        queryKey: [`/api/time-entries/${entryId}`],
        enabled: !!entryId,
    });

    const { data: discussions = [] } = useQuery<Discussion[]>({
        queryKey: entryId ? [`/api/discussions?entryId=${entryId}`] : [`/api/discussions?employeeId=${user?.id}`],
        enabled: !!user,
    });

    const { data: allTimeEntriesData = [] } = useQuery<TimeEntry[]>({
        queryKey: ['/api/time-entries'],
        enabled: !!user && (user.role === 'admin' || user.role === 'manager'),
    });

    const { data: myOnHoldEntriesData = [] } = useQuery<TimeEntry[]>({
        queryKey: ['/api/time-entries/employee', user?.id],
        enabled: !!user && user.role === 'employee',
    });

    // Fetch employees to resolve heldBy (approvedBy) IDs to names
    const { data: employees = [] } = useQuery<Employee[]>({
        queryKey: ['/api/employees'],
        enabled: !!user,
    });

    const onHoldEntriesData = (user.role === 'admin' || user.role === 'manager' ? allTimeEntriesData : myOnHoldEntriesData);
    const onHoldEntries = Array.isArray(onHoldEntriesData) ? onHoldEntriesData.filter(e => e.status === 'on_hold') : [];
    const safeDiscussions = Array.isArray(discussions) ? discussions : [];

    // Map employee ID to employee for quick lookup
    const employeeMap = new Map<string, Employee>(
        Array.isArray(employees) ? employees.map(emp => [emp.id, emp]) : []
    );

    // Helper to find who held the task (uses approvedBy or managerApprovedBy)
    const getHeldBy = (entry: TimeEntry): Employee | null => {
        const heldById = entry.approvedBy || entry.managerApprovedBy;
        if (!heldById) return null;
        return employeeMap.get(heldById) || null;
    };

    const filteredOnHold = onHoldEntries.filter(e =>
        e.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.taskDescription.toLowerCase().includes(searchQuery.toLowerCase())
    );


    const sendMutation = useMutation({
        mutationFn: async (newMessage: string) => {
            if (!entry && !entryId) return;
            return apiRequest('POST', '/api/discussions', {
                timeEntryId: entryId || entry?.id,
                employeeId: entry?.employeeId || user?.id,
                senderId: user?.id,
                senderName: user?.name,
                message: newMessage,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: entryId ? [`/api/discussions?entryId=${entryId}`] : [`/api/discussions?employeeId=${user?.id}`] });
            setMessage('');
            toast({ title: 'Message sent' });
        },
    });

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [safeDiscussions]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (message.trim()) {
            sendMutation.mutate(message.trim());
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-950 p-4 md:p-6 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => window.location.href = entryId ? '/discussion' : '/reports'} className="text-blue-400">
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Discussions</h1>
                        <p className="text-blue-200/60 text-sm">Communication regarding held tasks</p>
                    </div>
                </div>
                {entry?.taskDescription && (
                    <Badge
                        variant="outline"
                        className="bg-orange-500/10 text-orange-400 border-orange-500/30 px-4 py-1.5 h-auto max-w-[300px] truncate block"
                        title={entry.taskDescription}
                    >
                        Task: {entry.taskDescription.split(' | ')[0]}
                    </Badge>
                )}
            </div>

            {!entryId ? (
                <div className="space-y-4 flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between gap-4">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400/60" />
                            <Input
                                placeholder="Search by name, project or task..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-slate-900/50 border-blue-500/20 text-white focus:ring-blue-500/50"
                            />
                        </div>
                        <Badge variant="outline" className="text-blue-300 border-blue-500/20 px-4 py-1.5 h-auto">
                            {filteredOnHold.length} Tasks On Hold
                        </Badge>
                    </div>

                    <Card className="flex-1 bg-slate-900/40 border-blue-500/20 overflow-hidden flex flex-col">
                        <div className="overflow-x-auto flex-1 custom-scrollbar">
                            <Table>
                                <TableHeader className="bg-slate-900/60 sticky top-0 z-10 shadow-sm">
                                    <TableRow className="border-blue-500/10 hover:bg-transparent">
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider">Employee</TableHead>
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider">Project</TableHead>
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider">Task Description</TableHead>
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider">On Hold Reason</TableHead>
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider">Held By</TableHead>
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider text-center">Date</TableHead>
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider text-center">Completion</TableHead>
                                        <TableHead className="text-blue-400 font-bold text-xs uppercase tracking-wider text-right pr-6">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredOnHold.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="h-64 text-center">

                                                <div className="flex flex-col items-center justify-center text-blue-300/30">
                                                    <Layout className="w-12 h-12 mb-2 opacity-10" />
                                                    <p className="text-sm italic">No entries found for discussion.</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredOnHold.map((e) => (
                                            <TableRow key={e.id} className="border-blue-500/5 hover:bg-blue-500/5 transition-colors group">
                                                <TableCell className="py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 p-[1px]">
                                                            <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                                                                <span className="text-[10px] font-bold text-blue-400">{e.employeeName.charAt(0)}</span>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-semibold text-white">{e.employeeName}</div>
                                                            <div className="text-[9px] text-blue-400/60 uppercase">{e.employeeCode}</div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <span className="text-xs font-semibold text-blue-100">{e.projectName}</span>
                                                </TableCell>
                                                <TableCell>
                                                    <p className="text-xs text-blue-200/60 max-w-[250px] truncate" title={e.taskDescription}>
                                                        {e.taskDescription}
                                                    </p>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-start gap-2 max-w-[200px]">
                                                        <AlertCircle className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
                                                        <p className="text-xs text-orange-200/70 italic line-clamp-2">
                                                            "{e.onHoldReason || 'No reason provided'}"
                                                        </p>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {(() => {
                                                        const heldBy = getHeldBy(e);
                                                        if (heldBy) {
                                                            return (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 p-[1px] shrink-0">
                                                                        <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                                                                            <span className="text-[9px] font-bold text-purple-300">{heldBy.name.charAt(0)}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="text-xs font-semibold text-white truncate" title={heldBy.name}>{heldBy.name}</div>
                                                                        <div className="text-[9px] text-purple-300/70 uppercase">{heldBy.employeeCode}</div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }
                                                        return (
                                                            <span className="text-[10px] italic text-blue-300/40">Unknown</span>
                                                        );
                                                    })()}
                                                </TableCell>
                                                <TableCell className="text-center text-xs text-blue-200/40">
                                                    {e.date ? format(parseISO(e.date), 'MMM dd, yyyy') : 'N/A'}
                                                </TableCell>

                                                <TableCell className="text-center">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <div className="w-full bg-blue-500/10 h-1 rounded-full overflow-hidden max-w-[60px]">
                                                            <div className="bg-blue-500 h-full" style={{ width: `${e.percentageComplete}%` }}></div>
                                                        </div>
                                                        <span className="text-[10px] text-blue-300">{e.percentageComplete}%</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <Button
                                                        size="sm"
                                                        onClick={() => window.location.href = `/discussion?entryId=${e.id}`}
                                                        className="bg-blue-600 hover:bg-blue-500 shadow-md h-8 text-[11px]"
                                                    >
                                                        <MessageSquare className="w-3 h-3 mr-1.5" />
                                                        Discuss Tasks
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </Card>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                    <div className="lg:col-span-1 flex flex-col gap-4 min-h-0">
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Held Tasks</h3>
                                <Badge variant="outline" className="text-[9px] h-4 bg-blue-500/10 border-blue-500/20 text-blue-300">
                                    {onHoldEntries.length}
                                </Badge>
                            </div>
                            {onHoldEntries.length === 0 ? (
                                <div className="p-4 text-center border border-dashed border-blue-500/10 rounded-lg">
                                    <p className="text-xs text-blue-300/20 italic">No other held tasks</p>
                                </div>
                            ) : (
                                onHoldEntries.map(e => (
                                    <div
                                        key={e.id}
                                        onClick={() => window.location.href = `/discussion?entryId=${e.id}`}
                                        className={`p-3 rounded-lg border transition-all cursor-pointer ${entryId === e.id
                                            ? 'bg-blue-600/20 border-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.2)]'
                                            : 'bg-slate-900/40 border-blue-500/10 hover:border-blue-500/30 hover:bg-slate-900/60'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-[10px] font-bold text-blue-400">{e.employeeName}</span>
                                            <Clock className="w-3 h-3 text-blue-500/30" />
                                        </div>
                                        <p className="text-xs text-white font-medium truncate">{e.projectName}</p>
                                        <p className="text-[10px] text-blue-200/40 truncate">{e.taskDescription}</p>
                                    </div>
                                ))
                            )}
                        </div>

                        {entry?.id && (
                            <Card className="bg-slate-900/60 border-blue-500/20 p-5 space-y-4 shadow-xl">
                                <div className="space-y-1">
                                    <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Project</span>
                                    <h3 className="text-white font-semibold">{entry.projectName}</h3>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">Task Description</span>
                                    <p className="text-blue-100/70 text-sm leading-relaxed">{entry.taskDescription}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4 pt-2">
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-green-400 font-bold uppercase tracking-wider">Submitted On</span>
                                        <div className="flex items-center text-white text-xs gap-2">
                                            <Clock className="w-3 h-3 text-green-400" />
                                            {entry.date ? format(parseISO(entry.date), 'MMM dd, yyyy') : 'N/A'}
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-yellow-400 font-bold uppercase tracking-wider">Completion</span>
                                        <div className="text-white text-xs">{entry.percentageComplete}%</div>
                                    </div>
                                </div>
                                                {(() => {
                                                    const heldBy = getHeldBy(entry);
                                                    if (heldBy) {
                                                        return (
                                                            <div className="bg-purple-500/5 p-3 rounded-lg border border-purple-500/20 space-y-2">
                                                                <div className="flex items-center gap-2 text-purple-400">
                                                                    <UserIcon className="w-4 h-4" />
                                                                    <span className="text-[10px] font-bold uppercase tracking-wider">Held By</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 p-[1px] shrink-0">
                                                                        <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                                                                            <span className="text-[10px] font-bold text-purple-300">{heldBy.name.charAt(0)}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="text-xs font-semibold text-white truncate">{heldBy.name}</div>
                                                                        <div className="text-[9px] text-purple-300/70 uppercase">{heldBy.employeeCode}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                })()}

                                <div className="bg-orange-500/5 p-3 rounded-lg border border-orange-500/20 space-y-2">
                                    <div className="flex items-center gap-2 text-orange-400">
                                        <AlertCircle className="w-4 h-4" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">On Hold Reason</span>
                                    </div>
                                    <p className="text-orange-200/70 text-xs italic leading-relaxed">
                                        "{entry.onHoldReason || 'No reason provided'}"
                                    </p>
                                </div>
                            </Card>
                        )}

                    </div>

                    <div className="lg:col-span-2 flex flex-col bg-slate-900/40 border border-blue-500/20 rounded-xl overflow-hidden relative shadow-2xl">
                        <div className="p-4 border-b border-blue-500/10 bg-slate-900/60 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center border border-blue-500/20">
                                    <MessageSquare className="w-4 h-4 text-blue-400" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-semibold text-white">Task Communication</h2>
                                    <p className="text-[10px] text-blue-200/40">Real-time messaging with employee</p>
                                </div>
                            </div>
                        </div>

                        <ScrollArea className="flex-1 p-4">
                            <div className="space-y-4">
                                {safeDiscussions.length === 0 ? (
                                    <div className="h-40 flex flex-col items-center justify-center text-blue-300/30">
                                        <MessageSquare className="w-10 h-10 mb-2 opacity-10" />
                                        <p className="text-sm italic">No messages yet. Start the discussion.</p>
                                    </div>
                                ) : (
                                    safeDiscussions.slice().reverse().map((d) => {
                                        let formattedTime = '...';
                                        try {
                                            formattedTime = d.createdAt ? format(new Date(d.createdAt), 'HH:mm') : '...';
                                        } catch (e) {
                                            formattedTime = '...';
                                        }
                                        const isMe = d.senderId === user.id;
                                        return (
                                            <div key={d.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`flex gap-3 max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                                    <Avatar className="w-8 h-8 border border-blue-500/20 shrink-0">
                                                        <AvatarFallback className={isMe ? 'bg-blue-600 text-white' : 'bg-slate-800 text-blue-400 font-bold'}>
                                                            {(d.senderName || 'U').charAt(0)}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                                        <div className="flex items-center gap-2 px-1 mb-1">
                                                            <span className="text-[10px] font-bold text-blue-400/60">{d.senderName}</span>
                                                            <span className="text-[10px] text-blue-200/30">{formattedTime}</span>
                                                        </div>
                                                        <div className={`p-3 rounded-2xl text-xs leading-relaxed shadow-lg ${isMe
                                                            ? 'bg-blue-600 text-white rounded-tr-none'
                                                            : 'bg-slate-800 text-blue-100/80 rounded-tl-none border border-blue-500/10'}`}>
                                                            {d.message}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={scrollRef} />
                            </div>
                        </ScrollArea>

                        <div className="p-4 border-t border-blue-500/10 bg-slate-900/60">
                            <form onSubmit={handleSubmit} className="flex gap-2">
                                <Input
                                    placeholder="Type your message here..."
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    className="bg-slate-950 border-blue-500/20 text-white focus:ring-blue-500/50 h-10 shadow-inner"
                                />
                                <Button
                                    type="submit"
                                    disabled={!message.trim() || sendMutation.isPending}
                                    className="bg-blue-600 hover:bg-blue-500 px-6 h-10 shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                                >
                                    {sendMutation.isPending ? <Clock className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                </Button>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
