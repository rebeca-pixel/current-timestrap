import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, ChevronDown, Clock } from 'lucide-react';

/**
 * Shared, self-contained "Activity Timeline" panel.
 *
 * Given an employeeCode/date/startTime/endTime, it fetches TimeGuard's
 * tracked tool/website activity for that window and renders it as a
 * chronological day-log — the same shape used on the employee's own
 * Edit Task screen:
 *   10:00 AM – 11:00 AM  →  Chrome, Claude, Supabase, etc   (60m)
 *   11:00 AM – 11:15 AM  →  15m idle
 * plus a collapsible "Totals by App / Site" summary table underneath.
 *
 * It fetches its own data (rather than expecting a parent to pass it in),
 * so it can be dropped into any screen — the employee's Edit Task tab or a
 * reviewer's Approval card — just by supplying the four identifying props.
 * Entirely read-only.
 */

interface ActualWorkedToolEntry {
    activityType: string;
    appName: string;
    browserName: string | null;
    websiteUrl: string | null;
    windowTitle: string;
    startTime: string;
    endTime: string;
    durationSeconds: number;
}

interface ActivityTimelinePanelProps {
    /** Employee code the activity was tracked under (e.g. entry.employeeCode). */
    employeeCode?: string | null;
    /** The work date, "yyyy-MM-dd" (e.g. entry.date). */
    date?: string | null;
    /** Session start time, "HH:mm" 24h (e.g. entry.startTime). */
    startTime?: string | null;
    /** Session end time, "HH:mm" 24h (e.g. entry.endTime). */
    endTime?: string | null;
    /** Optional wrapper className override. */
    className?: string;
}

const IDLE_GAP_SECONDS = 120; // gaps of 2+ minutes with no tracked activity are shown as idle

export default function ActivityTimelinePanel({
    employeeCode,
    date,
    startTime,
    endTime,
    className,
}: ActivityTimelinePanelProps) {
    const enabled = !!employeeCode && !!date && !!startTime && !!endTime;

    const { data, isFetching } = useQuery<{ entries: ActualWorkedToolEntry[] }>({
        queryKey: ['/api/timeguard/actual-worked-tools', employeeCode, date, startTime, endTime],
        queryFn: async () => {
            const params = new URLSearchParams({
                employeeCode: employeeCode || '',
                date: date || '',
                startTime: startTime || '',
                endTime: endTime || '',
            });
            const res = await fetch(`/api/timeguard/actual-worked-tools?${params.toString()}`, { credentials: 'include' });
            if (!res.ok) throw new Error(`${res.status}`);
            return res.json();
        },
        enabled,
    });

    const entries = data?.entries || [];

    const extractDomain = (url: string | null) => {
        if (!url) return null;
        try {
            const withProto = url.match(/^[a-zA-Z]+:\/\//) ? url : `https://${url}`;
            return new URL(withProto).hostname.replace(/^www\./, '');
        } catch {
            return url;
        }
    };

    // Totals per app/site across the whole window — same aggregation used on
    // the Edit Task screen.
    const aggregated = useMemo(() => {
        const groups = new Map<string, {
            appName: string;
            browserName: string | null;
            websiteUrl: string | null;
            totalDurationSeconds: number;
            sessionCount: number;
        }>();

        for (const entry of entries) {
            // Trust the API's browserName/websiteUrl directly rather than only
            // activityType === 'website' — the backend also flags known browser
            // apps (e.g. Chrome logged as a plain 'app' row when it couldn't
            // resolve a specific site) so Browser still shows up even without a
            // captured URL.
            const domain = entry.websiteUrl ? extractDomain(entry.websiteUrl) : null;
            const isBrowserRow = !!(entry.browserName || domain);
            const key = isBrowserRow
                ? `web::${(entry.browserName || entry.appName || '').toLowerCase()}::${(domain || '').toLowerCase()}`
                : `app::${(entry.appName || '').toLowerCase()}`;

            const existing = groups.get(key);
            if (existing) {
                existing.totalDurationSeconds += entry.durationSeconds;
                existing.sessionCount += 1;
            } else {
                groups.set(key, {
                    appName: isBrowserRow ? '' : entry.appName,
                    browserName: isBrowserRow ? (entry.browserName || entry.appName) : null,
                    websiteUrl: domain || entry.websiteUrl,
                    totalDurationSeconds: entry.durationSeconds,
                    sessionCount: 1,
                });
            }
        }

        return Array.from(groups.values()).sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds);
    }, [entries]);

    // Chronological timeline — contiguous stretches of work collapsed into one
    // block listing every tool/site touched, with gaps shown as idle blocks.
    const timeline = useMemo(() => {
        type TimelineBlock = {
            type: 'activity' | 'idle';
            startTime: string;
            endTime: string;
            durationSeconds: number;
            tools: string[];
        };

        if (!entries.length) return [] as TimelineBlock[];

        const sorted = [...entries].sort(
            (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );

        const cleanLabel = (raw: string) => {
            let text = raw;
            try {
                text = decodeURIComponent(text);
            } catch {
                // leave as-is if it isn't valid percent-encoding
            }
            return text.replace(/[_-]+/g, ' ').trim();
        };

        const labelFor = (entry: ActualWorkedToolEntry) => {
            const domain = entry.websiteUrl ? extractDomain(entry.websiteUrl) : null;
            if (domain) return cleanLabel(domain);
            if (entry.browserName) return cleanLabel(entry.browserName);
            return cleanLabel(entry.appName || 'App');
        };

        const blocks: TimelineBlock[] = [];
        let current: TimelineBlock | null = null;

        const addTool = (block: TimelineBlock, label: string) => {
            const exists = block.tools.some((t) => t.toLowerCase() === label.toLowerCase());
            if (!exists) block.tools.push(label);
        };

        for (const entry of sorted) {
            const isIdleEntry = entry.activityType === 'idle';
            const start = entry.startTime;
            const end = entry.endTime;
            const gapSeconds = current
                ? Math.round((new Date(start).getTime() - new Date(current.endTime).getTime()) / 1000)
                : 0;

            if (isIdleEntry) {
                if (current) blocks.push(current);
                current = null;
                blocks.push({ type: 'idle', startTime: start, endTime: end, durationSeconds: entry.durationSeconds, tools: [] });
                continue;
            }

            if (current && current.type === 'activity' && gapSeconds < IDLE_GAP_SECONDS) {
                current.endTime = end;
                current.durationSeconds += entry.durationSeconds;
                addTool(current, labelFor(entry));
                continue;
            }

            if (current) {
                blocks.push(current);
                if (current.type === 'activity' && gapSeconds >= IDLE_GAP_SECONDS) {
                    blocks.push({
                        type: 'idle',
                        startTime: current.endTime,
                        endTime: start,
                        durationSeconds: gapSeconds,
                        tools: [],
                    });
                }
            }

            current = {
                type: 'activity',
                startTime: start,
                endTime: end,
                durationSeconds: entry.durationSeconds,
                tools: [labelFor(entry)],
            };
        }
        if (current) blocks.push(current);

        return blocks;
    }, [entries]);

    const [showTotals, setShowTotals] = useState(true);
    const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());
    const TOOLS_PREVIEW_COUNT = 8;

    const toggleBlockExpanded = (idx: number) => {
        setExpandedBlocks((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const formatTime = (iso: string) =>
        new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const formatDuration = (seconds: number) =>
        seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;

    return (
        <div className={className || 'space-y-6'}>
            <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-300 mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    Activity Timeline
                    <span className="text-blue-400/50 normal-case font-normal tracking-normal">(auto-fetched from TimeGuard, read-only)</span>
                </div>

                {!enabled ? (
                    <p className="text-xs text-blue-300/60 italic mt-2" data-testid="text-activity-timeline-hint">
                        Employee code, date, and start/end time are required to load TimeGuard's tracked activity for this session.
                    </p>
                ) : isFetching ? (
                    <p className="text-xs text-blue-300/60 mt-2" data-testid="text-activity-timeline-loading">
                        Loading TimeGuard activity…
                    </p>
                ) : timeline.length === 0 ? (
                    <p className="text-xs text-blue-300/60 italic mt-2" data-testid="text-activity-timeline-empty">
                        No TimeGuard activity recorded for this time period.
                    </p>
                ) : (
                    <div className="mt-3 space-y-2" data-testid="timeline-activity">
                        {timeline.map((block, idx) => (
                            <div
                                key={idx}
                                className={`flex items-start gap-3 rounded-md border px-3 py-2 ${block.type === 'idle'
                                    ? 'border-dashed border-slate-600/40 bg-slate-800/20'
                                    : 'border-blue-500/20 bg-slate-800/40'
                                    }`}
                                data-testid={`timeline-block-${idx}`}
                            >
                                <div className="text-xs font-mono text-blue-300 whitespace-nowrap pt-1 min-w-[140px]">
                                    {formatTime(block.startTime)} – {formatTime(block.endTime)}
                                </div>
                                <ArrowRight className="w-3.5 h-3.5 text-blue-400/50 shrink-0 mt-1.5" />
                                {block.type === 'idle' ? (
                                    <div className="text-xs text-slate-400 italic pt-1">
                                        {formatDuration(block.durationSeconds)} idle
                                    </div>
                                ) : (
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {(expandedBlocks.has(idx) ? block.tools : block.tools.slice(0, TOOLS_PREVIEW_COUNT)).map((tool, tIdx) => (
                                                <span
                                                    key={tIdx}
                                                    className="inline-flex items-center rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[11px] leading-4 text-blue-100 whitespace-nowrap"
                                                >
                                                    {tool}
                                                </span>
                                            ))}
                                            {block.tools.length > TOOLS_PREVIEW_COUNT && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleBlockExpanded(idx)}
                                                    className="inline-flex items-center rounded-full border border-blue-400/30 px-2 py-0.5 text-[11px] leading-4 text-blue-300 hover:text-blue-100 hover:bg-blue-500/10 transition-colors"
                                                >
                                                    {expandedBlocks.has(idx)
                                                        ? 'Show less'
                                                        : `+${block.tools.length - TOOLS_PREVIEW_COUNT} more`}
                                                </button>
                                            )}
                                            <span className="text-blue-400/60 text-[11px] ml-1">({formatDuration(block.durationSeconds)})</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {aggregated.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowTotals((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-300 hover:text-blue-200 transition-colors"
                        data-testid="toggle-totals-by-app-site"
                    >
                        <ChevronDown className={`w-4 h-4 text-blue-400/70 transition-transform ${showTotals ? '' : '-rotate-90'}`} />
                        Totals by App / Site
                    </button>
                    {showTotals && (
                        <div className="overflow-x-auto border border-blue-500/20 rounded-md mt-2" data-testid="table-activity-totals">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-blue-500/20 hover:bg-transparent">
                                        <TableHead className="text-blue-300">Application/Tool</TableHead>
                                        <TableHead className="text-blue-300">Browser</TableHead>
                                        <TableHead className="text-blue-300">Website URL</TableHead>
                                        <TableHead className="text-blue-300">Sessions</TableHead>
                                        <TableHead className="text-blue-300">Total Duration</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {aggregated.map((group, idx) => (
                                        <TableRow key={idx} className="border-blue-500/10">
                                            <TableCell className="text-blue-100 text-xs">{group.browserName ? '-' : group.appName}</TableCell>
                                            <TableCell className="text-blue-100 text-xs">{group.browserName || '-'}</TableCell>
                                            <TableCell className="text-blue-100 text-xs max-w-[200px] truncate" title={group.websiteUrl || ''}>{group.websiteUrl || '-'}</TableCell>
                                            <TableCell className="text-blue-100 text-xs whitespace-nowrap">{group.sessionCount}</TableCell>
                                            <TableCell className="text-blue-100 text-xs whitespace-nowrap">{formatDuration(group.totalDurationSeconds)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}