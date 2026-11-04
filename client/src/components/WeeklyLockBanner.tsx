import { Lock } from 'lucide-react';
import { WEEKLY_LOCK_MESSAGE } from '@shared/weeklyLock';

// Shown whenever the selected date belongs to a locked (closed) Sunday–Saturday week.
export default function WeeklyLockBanner({ weekStart, weekEnd }: { weekStart?: string; weekEnd?: string }) {
    return (
        <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            data-testid="banner-weekly-lock"
        >
            <Lock className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
            <div>
                <p className="text-sm font-semibold text-red-200">{WEEKLY_LOCK_MESSAGE}</p>
                <p className="text-xs text-red-100/70 mt-1">
                    {weekStart && weekEnd ? `The week of ${weekStart} to ${weekEnd} (Sunday–Saturday) is locked. ` : ''}
                    Timesheets for this week can no longer be submitted or modified. Please contact your Admin if you need access.
                </p>
            </div>
        </div>
    );
}