import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Loader2, CalendarClock, User, FileText, Search } from 'lucide-react';

interface Postponement {
    id: string;
    taskId: string;
    previousDueDate: string;
    newDueDate: string;
    reason: string;
    postponedBy: string;
    postponedAt: string;
    postponeCount: number;
    employeeName: string;
    employeeCode: string;
    taskName?: string;
}

export default function PostponementsPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const { data: postponements, isLoading } = useQuery<Postponement[]>({
        queryKey: ['/api/admin/postponements'],
    });

    const filteredPostponements = useMemo(() => {
        if (!postponements) return [];
        return postponements.filter(post =>
            post.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (post.taskName && post.taskName.toLowerCase().includes(searchQuery.toLowerCase())) ||
            post.employeeCode.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [postponements, searchQuery]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 bg-slate-950 min-h-screen">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <CalendarClock className="h-8 w-8 text-blue-500" />
                        Task Postponements
                    </h1>
                    <p className="text-slate-400 mt-2">
                        Monitor all task deadline extensions requested by employees.
                    </p>
                </div>
            </div>

            <Card className="border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur-sm">
                <CardHeader className="border-b border-slate-800 pb-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <CardTitle className="text-xl text-white flex items-center gap-2">
                            <FileText className="h-5 w-5 text-blue-400" />
                            Postponement History
                        </CardTitle>
                        <div className="relative w-full md:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                            <Input
                                placeholder="Search employee or task..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-slate-950/50 border-slate-800 text-slate-200 focus:ring-blue-500/20"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-800 hover:bg-transparent">
                                    <TableHead className="text-slate-300">Employee</TableHead>
                                    <TableHead className="text-slate-300">Task Information</TableHead>
                                    <TableHead className="text-slate-300">Previous Due</TableHead>
                                    <TableHead className="text-slate-300">New Due Date</TableHead>
                                    <TableHead className="text-slate-300">Reason</TableHead>
                                    <TableHead className="text-slate-300">Requested At</TableHead>
                                    <TableHead className="text-slate-300 text-center">Count</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredPostponements.length > 0 ? (
                                    filteredPostponements.map((post) => (
                                        <TableRow key={post.id} className="border-slate-800 hover:bg-slate-800/30 transition-colors">
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                                                        <User className="h-4 w-4 text-blue-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-white">{post.employeeName}</div>
                                                        <div className="text-xs text-slate-500">{post.employeeCode}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-white font-medium">
                                                    {post.taskName || 'Unknown Task'}
                                                </div>
                                                <div className="text-xs text-slate-500">
                                                    ID: {post.taskId}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-slate-400 line-through decoration-red-500/50">
                                                {post.previousDueDate || 'N/A'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 bg-emerald-500/5">
                                                    {post.newDueDate}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-slate-300 max-w-xs overflow-hidden text-ellipsis italic">
                                                "{post.reason}"
                                            </TableCell>
                                            <TableCell className="text-slate-500 text-sm">
                                                {format(new Date(post.postponedAt), 'MMM dd, yyyy HH:mm')}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant="secondary" className="bg-slate-800 text-slate-300 border-slate-700">
                                                    {post.postponeCount}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                                            No postponement requests found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
