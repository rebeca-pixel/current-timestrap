import "dotenv/config";
import pkg from 'pg';
const { Pool } = pkg;
import type { QueryResult } from 'pg';

// LMS Database URL from environment variables
const lmsDatabaseUrl = process.env.LMS_DATABASE_URL;

if (!lmsDatabaseUrl) {
  console.warn('⚠️ LMS_DATABASE_URL is not defined in environment variables.');
} else {
  console.log(`📡 LMS Database connection initialized (URL starts with: ${lmsDatabaseUrl.substring(0, 20)}...)`);
}

export const lmsPool = new Pool({
  connectionString: lmsDatabaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

export interface LMSHours {
  leaveHours: number;
  permissionHours: number;
  odHours: number;          // Approved OD (On-Duty) hours — separate line item
  totalLMSHours: number;
  details: {
    leaves: any[];
    permissions: any[];
  };
  // Approved OD (On-Duty) time window(s) for this employee/date, used by the
  // Plan of the Day feature to work out when the employee is exempt from
  // filling in / being marked pending-overdue for their plan. Usually a
  // single entry; an array is used in case more than one OD row applies.
  odWindows: ODWindow[];
}

export interface ODWindow {
  from: string;      // "HH:mm:ss", IST
  to: string;        // "HH:mm:ss", IST
  isFullDay: boolean; // true = the whole calendar day is exempt
  durationType: string; // 'Full Day' | 'Half Day' | 'Hourly'
}

/**
 * Plan for the Day / OD Exemption
 * -------------------------------
 * Standard half-day OD session windows, aligned to the company's 10:00 AM –
 * 7:00 PM shift. When the LMS `leaves` row for a "Half Day" OD doesn't carry
 * its own od_from_time / od_to_time (older records, or the LMS UI not
 * collecting a specific session), we fall back to the FIRST_HALF window
 * below. If the LMS row *does* carry explicit od_from_time / od_to_time
 * values, those are always preferred (see the OD-processing loop below).
 */
export const OD_HALF_DAY_WINDOWS = {
  firstHalf: { from: '10:00:00', to: '14:00:00' },  // 10:00 AM – 2:00 PM
  secondHalf: { from: '14:00:00', to: '19:00:00' }, // 2:00 PM – 7:00 PM
} as const;

// A Full Day OD exempts the employee for the entire calendar day.
export const OD_FULL_DAY_WINDOW = { from: '00:00:00', to: '23:59:59' } as const;

/**
 * Compute the number of hours between two "time without time zone" values
 * (od_from_time, od_to_time) stored on the LMS leaves table for hourly ODs.
 * Returns 0 if inputs are missing or invalid.
 */
const computeHoursBetween = (fromTime: any, toTime: any): number => {
  if (!fromTime || !toTime) return 0;
  try {
    // Postgres `time` columns come back as strings like "12:15:00"
    const toMinutes = (t: string): number => {
      const parts = t.split(':');
      const h = parseInt(parts[0] || '0', 10);
      const m = parseInt(parts[1] || '0', 10);
      const s = parseInt(parts[2] || '0', 10);
      return h * 60 + m + s / 60;
    };
    let from = toMinutes(String(fromTime));
    let to = toMinutes(String(toTime));
    if (Number.isNaN(from) || Number.isNaN(to)) return 0;
    if (to < from) to += 24 * 60; // overnight OD
    return (to - from) / 60;
  } catch {
    return 0;
  }
};

/**
 * Fetches approved leave and permission hours for multiple employees over a date range.
 * This is significantly faster for reporting.
 *
 * NOTE: Approved hourly-based OD (On-Duty) entries live in the `leaves` table
 * (leave_type = 'OD', leave_duration_type = 'Hourly') and carry od_from_time /
 * od_to_time columns. Those hours are reported as `odHours` (separate from the
 * `permissionHours` for early_exit / late_entry / personal_work / emergency
 * permissions) so the timestrap can label them correctly while still adding
 * them to the 8-hour day total so the timesheet can be submitted.
 *
 * Timezone: timestamp columns are compared in IST (Asia/Kolkata) since the
 * timestrap users operate in IST. Without this, the date was rolling back one
 * day in UTC and Mohan's hourly OD was being dropped from the day total.
 */
export const getBatchLMSHours = async (startDate: string, endDate: string): Promise<Record<string, Record<string, LMSHours>>> => {
  try {
    console.log(`🔍 Batch fetching LMS hours from ${startDate} to ${endDate}`);

    // 1. Fetch Approved Leaves for all employees in range
    //    Dates are interpreted in IST (Asia/Kolkata) to avoid off-by-one day
    //    caused by UTC conversion of timestamp columns.
    //    od_from_time / od_to_time are selected so hourly OD entries can be
    //    converted to hours below.
    const leaveQuery = `
      SELECT user_id, start_date, end_date, leave_type, leave_duration_type, status,
             od_from_time, od_to_time
      FROM leaves
      WHERE status = 'Approved'
        AND (
          ((start_date AT TIME ZONE 'Asia/Kolkata')::date <= ($2::date)
            AND (end_date AT TIME ZONE 'Asia/Kolkata')::date >= ($1::date))
        )
    `;
    const leaveResult: QueryResult = await lmsPool.query(leaveQuery, [startDate, endDate]);

    // 2. Fetch Approved Permissions for all employees in range
    //    Includes ALL permission types: 'early_exit', 'late_entry', 'personal_work',
    //    'emergency', etc. (Note: OD/On-Duty is NOT in this table — it lives in
    //    `leaves` with leave_type='OD' and is processed above.)
    //    Interpreted in IST to fix the off-by-one day bug.
    const permissionQuery = `
      SELECT user_id, total_hours, status, permission_date, permission_type
      FROM permissions
      WHERE status = 'Approved'
        AND (permission_date AT TIME ZONE 'Asia/Kolkata')::date >= ($1::date)
        AND (permission_date AT TIME ZONE 'Asia/Kolkata')::date <= ($2::date)
    `;
    const permissionResult: QueryResult = await lmsPool.query(permissionQuery, [startDate, endDate]);

    // Initialize result structure: { [empCode]: { [date]: LMSHours } }
    const result: Record<string, Record<string, LMSHours>> = {};

    // Helper to ensure path exists
    const ensurePath = (empCode: string, dStr: string) => {
      if (!result[empCode]) result[empCode] = {};
      if (!result[empCode][dStr]) {
        result[empCode][dStr] = {
          leaveHours: 0,
          permissionHours: 0,
          odHours: 0,
          totalLMSHours: 0,
          details: { leaves: [], permissions: [] },
          odWindows: []
        };
      }
    };

    // Format a Postgres `time` value ("12:15:00" or a Date) into "HH:mm:ss".
    const toTimeString = (t: any): string | null => {
      if (!t) return null;
      const str = String(t);
      // Already "HH:mm:ss" (or "HH:mm")
      const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (match) {
        const h = match[1].padStart(2, '0');
        const m = match[2];
        const s = match[3] || '00';
        return `${h}:${m}:${s}`;
      }
      return null;
    };

    // Process Leaves
    const { eachDayOfInterval, parseISO, format: dFormat } = await import('date-fns');
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const rangeDates = eachDayOfInterval({ start, end }).map(d => dFormat(d, 'yyyy-MM-dd'));

    // Convert any timestamp/date value to its "yyyy-MM-dd" key AS SEEN IN IST.
    // The SQL queries above already filter using `AT TIME ZONE 'Asia/Kolkata'`
    // for this exact reason — without it, a server running in UTC will format
    // an IST-midnight (or early-morning) timestamp as the previous calendar
    // day, silently dropping that row out of `rangeDates`/`today` matching.
    // This mirrors that same IST conversion so JS-side date keys agree with
    // what the SQL WHERE clause already selected.
    const toISTDateKey = (value: any): string => {
      const d = new Date(value);
      const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
      const istMs = utcMs + (5.5 * 60 * 60 * 1000);
      return dFormat(new Date(istMs), 'yyyy-MM-dd');
    };

    leaveResult.rows.forEach(row => {
      const empCode = row.user_id;
      const lStart = toISTDateKey(row.start_date);
      const lEnd = toISTDateKey(row.end_date);

      // Determine how many hours this leave row represents.
      // - Regular Casual/Sick/Earned leave:
      //     Full Day = 8h, Half Day = 4h
      // - OD (On-Duty):
      //     Full Day = 8h, Hourly = od_to_time - od_from_time
      //     OD hours are credited to `odHours` (separate from `permissionHours`)
      //     and ALSO added to `totalLMSHours` so they count toward the 8-hour
      //     day requirement. The row is still pushed into details.leaves.
      let hours = 0;
      const dur = (row.leave_duration_type || '').toString().trim();
      const isOD = (row.leave_type || '').toString().toUpperCase() === 'OD';

      // For OD rows, also work out the approved exemption window so the Plan
      // for the Day feature knows exactly when the employee is on OD and
      // doesn't need to fill in / get marked overdue for their plan.
      let odWindow: ODWindow | null = null;

      if (isOD) {
        const explicitFrom = toTimeString(row.od_from_time);
        const explicitTo = toTimeString(row.od_to_time);

        if (dur === 'Full Day') {
          hours = 8;
          odWindow = { ...OD_FULL_DAY_WINDOW, isFullDay: true, durationType: 'Full Day' };
        } else if (dur === 'Half Day') {
          hours = 4;
          // Prefer the LMS's own od_from_time/od_to_time if it recorded one
          // for this half-day OD row; otherwise default to the first half of
          // the shift (10:00 AM – 2:00 PM). See OD_HALF_DAY_WINDOWS above.
          if (explicitFrom && explicitTo) {
            hours = computeHoursBetween(explicitFrom, explicitTo) || 4;
            odWindow = { from: explicitFrom, to: explicitTo, isFullDay: false, durationType: 'Half Day' };
          } else {
            odWindow = { ...OD_HALF_DAY_WINDOWS.firstHalf, isFullDay: false, durationType: 'Half Day' };
          }
        } else if (dur === 'Hourly') {
          hours = computeHoursBetween(row.od_from_time, row.od_to_time);
          if (explicitFrom && explicitTo) {
            odWindow = { from: explicitFrom, to: explicitTo, isFullDay: false, durationType: 'Hourly' };
          }
        } else {
          hours = 0;
        }
      } else {
        if (dur === 'Full Day') hours = 8;
        else if (dur === 'Half Day') hours = 4;
        else hours = 0;
      }

      if (hours <= 0) return; // nothing to credit for this row

      // Filter rangeDates to see which fall within this leave
      rangeDates.forEach(dStr => {
        if (dStr >= lStart && dStr <= lEnd) {
          ensurePath(empCode, dStr);
          if (isOD) {
            // OD counts as working time → bucket under odHours so it is
            // visible as a separate "OD" line in the timestrap.
            result[empCode][dStr].odHours += hours;
            if (odWindow) result[empCode][dStr].odWindows.push(odWindow);
          } else {
            result[empCode][dStr].leaveHours += hours;
          }
          result[empCode][dStr].totalLMSHours += hours;
          result[empCode][dStr].details.leaves.push(row);
        }
      });
    });

    // Process Permissions (early_exit, late_entry, personal_work, emergency, etc.)
    permissionResult.rows.forEach(row => {
      const empCode = row.user_id;
      // Format the permission_date in IST (Asia/Kolkata) so the date key matches
      // what the user sees in the timestrap. Without this, late-evening/early-morning
      // entries would be bucketed under the wrong day in UTC.
      const dStr = toISTDateKey(row.permission_date);

      if (dStr >= startDate && dStr <= endDate) {
        ensurePath(empCode, dStr);
        const hours = parseFloat(row.total_hours) || 0;
        result[empCode][dStr].permissionHours += hours;
        result[empCode][dStr].totalLMSHours += hours;
        result[empCode][dStr].details.permissions.push(row);
      }
    });

    return result;
  } catch (error) {
    console.error('💥 Error batch fetching LMS hours:', error);
    return {};
  }
};

/**
 * Fetches approved leave and permission hours for an employee on a specific date.
 */
export const getLMSHours = async (employeeCode: string, date: string): Promise<LMSHours> => {
  try {
    const batch = await getBatchLMSHours(date, date);
    return batch[employeeCode]?.[date] || {
      leaveHours: 0,
      permissionHours: 0,
      odHours: 0,
      totalLMSHours: 0,
      details: { leaves: [], permissions: [] },
      odWindows: []
    };
  } catch (error) {
    console.error('💥 Error fetching LMS hours:', error);
    return {
      leaveHours: 0,
      permissionHours: 0,
      odHours: 0,
      totalLMSHours: 0,
      details: { leaves: [], permissions: [] },
      odWindows: []
    };
  }
};

/* -------------------------------------------------------------------------- */
/*                    Plan for the Day — OD Exemption Helpers                 */
/* -------------------------------------------------------------------------- */

export interface ODExemption {
  hasApprovedOD: boolean;
  isFullDay: boolean;
  windows: { from: string; to: string; durationType: string }[];
}

const toMinutesOfDay = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Look up an employee's approved OD (On-Duty) window(s) for a given date.
 * Used by the Plan of the Day feature to decide whether the employee is
 * currently exempt from filling in / being marked pending-overdue.
 */
export const getODExemption = async (employeeCode: string, date: string): Promise<ODExemption> => {
  const hours = await getLMSHours(employeeCode, date);
  const windows = hours.odWindows || [];
  return {
    hasApprovedOD: windows.length > 0,
    isFullDay: windows.some(w => w.isFullDay),
    windows: windows.map(w => ({ from: w.from, to: w.to, durationType: w.durationType }))
  };
};

/**
 * Is the given moment (defaults to "now", interpreted in IST) currently
 * inside one of the employee's approved OD windows for that date?
 * A Full Day OD always returns true (the whole day is exempt).
 */
export const isWithinApprovedOD = (exemption: ODExemption, atTime: Date = new Date()): boolean => {
  if (!exemption.hasApprovedOD) return false;
  if (exemption.isFullDay) return true;

  const utcNow = atTime.getTime() + (atTime.getTimezoneOffset() * 60000);
  const istNow = new Date(utcNow + (5.5 * 60 * 60 * 1000));
  const nowMinutes = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

  return exemption.windows.some(w => {
    const from = toMinutesOfDay(w.from);
    const to = toMinutesOfDay(w.to);
    // Normal same-day window, e.g. 10:00 - 13:00.
    if (to >= from) return nowMinutes >= from && nowMinutes <= to;
    // Overnight window that crosses midnight, e.g. 22:00 - 06:00: exempt
    // from `from` through end of day, and from start of day through `to`.
    return nowMinutes >= from || nowMinutes <= to;
  });
};

/**
 * The effective Plan-of-Day cutoff (in minutes-from-midnight, IST) for this
 * employee today. If an approved OD window straddles the standard cutoff,
 * the cutoff is pushed out to the end of that OD window so the employee
 * isn't marked overdue while still on approved OD. Outside of that overlap,
 * the standard cutoff applies as normal.
 */
export const getEffectivePlanCutoffMinutes = (exemption: ODExemption, standardCutoffMinutes: number): number => {
  if (!exemption.hasApprovedOD || exemption.isFullDay) return standardCutoffMinutes;

  let cutoff = standardCutoffMinutes;
  for (const w of exemption.windows) {
    const from = toMinutesOfDay(w.from);
    const to = toMinutesOfDay(w.to);
    if (to >= from) {
      // Normal same-day window.
      if (from <= cutoff && cutoff <= to && to > cutoff) {
        cutoff = to;
      }
    } else {
      // Overnight window crossing midnight, e.g. 22:00 - 06:00.
      if (cutoff <= to) {
        // Cutoff falls in the early-morning tail of the OD window.
        cutoff = Math.max(cutoff, to);
      } else if (cutoff >= from) {
        // Cutoff falls in the late-night start of the OD window, which runs
        // through the end of the calendar day.
        cutoff = 23 * 60 + 59;
      }
    }
  }
  return cutoff;
};