import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { detectBrowserTimeZone } from '@shared/submissionRestriction';
import { evaluateWeeklyLock, WEEKLY_LOCK_MESSAGE } from '@shared/weeklyLock';

export const WEEKLY_LOCK_QUERY_KEY = '/api/settings/weekly-submission-lock';

// Weekly submission lock for one work date (YYYY-MM-DD). The admin switch is read from the server
// (default OFF until the server says otherwise); the server enforces the same rule on every write.
export function useWeeklyLock(workDate: string) {
    const { data } = useQuery<{ enabled: boolean }>({
        queryKey: [WEEKLY_LOCK_QUERY_KEY],
        staleTime: 0,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
    });
    const enabled = data?.enabled === true;

    // Re-evaluate every minute so a page left open over Saturday → Sunday locks by itself.
    const [tick, setTick] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setTick(Date.now()), 60_000);
        return () => clearInterval(id);
    }, []);

    const result = useMemo(
        () => evaluateWeeklyLock({ workDate, now: new Date(tick), timeZone: detectBrowserTimeZone(), enabled }),
        [workDate, tick, enabled],
    );
    return { enabled, locked: result.locked, message: result.message ?? WEEKLY_LOCK_MESSAGE, result };
}