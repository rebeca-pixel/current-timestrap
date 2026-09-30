import { useState, useMemo, useEffect, CSSProperties } from "react";
import {
  format, addDays, addMonths, subMonths,
  startOfWeek, startOfMonth,
  isSameDay, isSameMonth,
} from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { 
  fetchGoogleStatus, 
  disconnectGoogle as disconnectPmsGoogle,
  type GoogleStatus 
} from "@/lib/googleCalendar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalendarViewPageProps {
  user?: {
    id?: string;
    role?: string;
    employeeCode?: string;
    department?: string;
  };
}

type CalendarEventSource = "plan" | "manual" | "google";

interface Guest {
  id: string;
  name: string;
  email: string;
  isExternal: boolean;
  optional: boolean;
}

interface CalendarEvent {
  id: string;
  title: string;
  project: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  colorIdx: number;
  source?: CalendarEventSource;
  pmsId?: string;
  googleEventId?: string;
  guests?: Guest[];
  guestsCanModify?: boolean;
  guestsCanInvite?: boolean;
  guestsCanSeeGuestList?: boolean;
  description?: string;
  location?: string;
  videoLink?: string;
  allDay?: boolean;
  calendarType?: string;
  repeat?: string;
  reminders?: number[];
  visibility?: "default" | "public" | "private";
  busy?: boolean;
  projectId?: string;
}

interface ModalState {
  mode: "new" | "edit";
  event: Partial<CalendarEvent>;
}

type ViewMode = "day" | "week" | "month";

interface EventPillProps {
  event: CalendarEvent;
  onClick: (event: CalendarEvent) => void;
  style?: CSSProperties;
  compact?: boolean;
}

interface DayColumnProps {
  day: Date;
  events: CalendarEvent[];
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (event: CalendarEvent) => void;
  onEventResize?: (event: CalendarEvent, newEndTime: string) => void;
  isToday: boolean;
}

interface WeekGridProps {
  weekDays: Date[];
  events: CalendarEvent[];
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (event: CalendarEvent) => void;
  onEventResize?: (event: CalendarEvent, newEndTime: string) => void;
  today: Date;
}

interface MonthGridProps {
  monthDays: Date[];
  selectedDate: Date;
  events: CalendarEvent[];
  onDayClick: (day: Date) => void;
  today: Date;
}

interface MiniCalendarProps {
  value: Date;
  onChange: (day: Date) => void;
}

interface EventModalProps {
  event: Partial<CalendarEvent>;
  onClose: () => void;
  onSave: (evt: CalendarEvent) => void;
  onDelete: (id: string) => void;
  mode: "new" | "edit";
  user?: CalendarViewPageProps["user"];
}

interface ProjectOption {
  id: string;
  project_name: string;
  project_code?: string;
}

interface TaskOption {
  id: string;
  task_name: string;
  project_id?: string;
  project_code?: string;
}

interface EmployeeOption {
  id: string;
  name: string;
  email: string;
  department?: string;
  designation?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const guestUid = () => `gst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const normalizeProjectOption = (candidate: Partial<ProjectOption> & { project_name?: string; project_code?: string }, index: number): ProjectOption => ({
  id: candidate.id || candidate.project_code || `${candidate.project_name || "project"}-${index}`,
  project_name: candidate.project_name || "",
  project_code: candidate.project_code,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKING_HOURS: number[] = Array.from({ length: 15 }, (_, i) => i + 7);

const EVENT_COLORS = [
  { bg: "#1a73e8", light: "#e8f0fe", text: "#1a73e8" },
  { bg: "#0f9d58", light: "#e6f4ea", text: "#0f9d58" },
  { bg: "#f4b400", light: "#fef9e7", text: "#b06000" },
  { bg: "#d93025", light: "#fce8e6", text: "#c5221f" },
  { bg: "#9334e6", light: "#f3e8fd", text: "#7627bb" },
  { bg: "#00897b", light: "#e0f2f1", text: "#00695c" },
];

const CALENDAR_TYPES = [
  { key: "meeting", label: "Meetings" },
  { key: "deadline", label: "Deadlines" },
  { key: "task", label: "Tasks" },
  { key: "milestone", label: "Project milestones" },
  { key: "personal", label: "Personal" },
];

const REPEAT_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const REMINDER_OPTIONS = [
  { value: 0, label: "At time of event" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
  { value: 10080, label: "1 week before" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toMin = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

const toDurationMinutes = (startTime: string, endTime: string) => Math.max(30, toMin(endTime) - toMin(startTime));

const readStoredArray = (key: string | null): any[] => {
  if (!key || typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeEventTitle = (value?: string | null, fallback?: string | null) => {
  const trimmed = value?.trim();
  if (trimmed && trimmed !== "Untitled Task") return trimmed;
  return fallback?.trim() || "Untitled Task";
};

const isPlanTask = (task: any) => {
  return Boolean(
    task?.source === 'plan' ||
    task?.isPlanTask === true ||
    task?.description === 'Scheduled via Plan for Day' ||
    task?.problemAndIssues === 'Auto-filled from daily plan'
  );
};

const buildPlanEvent = (task: any, fallbackDate: string): CalendarEvent => {
  let initialTitle = task.title;
  if (initialTitle === "Untitled Task") initialTitle = null;

  return {
    id: task.id || task.pmsId || `planned-${Math.random().toString(36).slice(2, 8)}`,
    title: normalizeEventTitle(initialTitle || task.task_name || task.taskName || task.taskDescription, task.project || task.projectName || task.project_code),
    project: task.project || task.projectName || task.project_code || "General",
    date: task.date || fallbackDate,
    startTime: task.startTime || "09:00",
    endTime: task.endTime || "10:00",
    colorIdx: 0,
    source: "plan",
    pmsId: task.pmsId || task.taskId || undefined,
    googleEventId: task.googleEventId || undefined,
  };
};

const mergePlanEvents = (tasks: any[], fallbackDate: string) => {
  const map = new Map<string, CalendarEvent>();
  tasks.forEach((task) => {
    const event = buildPlanEvent(task, fallbackDate);
    map.set(event.id, event);
  });
  return Array.from(map.values());
};

const persistPlanUpdate = (userId: string | undefined, originalDate: string | undefined, event: CalendarEvent) => {
  if (!userId) return;

  const nextDate = event.date;
  const scheduleKey = `plan_schedule_${userId}_${nextDate}`;
  const scheduleTasks = readStoredArray(scheduleKey);
  const durationMinutes = toDurationMinutes(event.startTime, event.endTime);

  const existingSchedule = scheduleTasks.find((task: any) => task.id === event.id || task.pmsId === event.pmsId);

  const scheduleTask = {
    ...(existingSchedule || {}),
    id: event.id,
    pmsId: event.pmsId,
    task_name: event.title,
    projectName: event.project,
    startTime: event.startTime,
    endTime: event.endTime,
    durationMinutes,
    googleEventId: event.googleEventId,
    scheduleData: {
      ...((existingSchedule || {}).scheduleData || {}),
      startTime: event.startTime,
      endTime: event.endTime,
      durationMinutes,
    },
  };

  const nextScheduleTasks = scheduleTasks.some((task: any) => task.id === event.id || task.pmsId === event.pmsId)
    ? scheduleTasks.map((task: any) => (task.id === event.id || task.pmsId === event.pmsId ? scheduleTask : task))
    : [...scheduleTasks, scheduleTask];

  window.localStorage.setItem(scheduleKey, JSON.stringify(nextScheduleTasks));

  if (originalDate && originalDate !== nextDate) {
    const oldScheduleKey = `plan_schedule_${userId}_${originalDate}`;
    const oldScheduleTasks = readStoredArray(oldScheduleKey);

    window.localStorage.setItem(oldScheduleKey, JSON.stringify(oldScheduleTasks.filter((task: any) => task.id !== event.id && task.pmsId !== event.pmsId)));
  }
};

const removePlanEvent = (userId: string | undefined, date: string | undefined, event: CalendarEvent) => {
  if (!userId || !date) return;

  const scheduleKey = `plan_schedule_${userId}_${date}`;
  const scheduleTasks = readStoredArray(scheduleKey);

  window.localStorage.setItem(scheduleKey, JSON.stringify(scheduleTasks.filter((task: any) => task.id !== event.id && task.pmsId !== event.pmsId)));
};

// ─── Manual event API (backed directly by PMS's calendar_events table) ───────
// employeeCode (not Timestrap's internal user.id) is what PMS's calendar_events
// actually resolves against — see server/pmsCalendarEvents.ts for why.

const toApiEventBody = (employeeCode: string, event: Partial<CalendarEvent>) => ({
  employeeCode,
  title: event.title,
  project: event.project,
  date: event.date,
  endDate: event.endDate || event.date,
  startTime: event.startTime,
  endTime: event.endTime,
  colorIdx: event.colorIdx,
  description: event.description,
  location: event.location,
  videoLink: event.videoLink,
  allDay: event.allDay,
  calendarType: event.calendarType || "meeting",
  repeat: event.repeat || "none",
  reminders: event.reminders,
  visibility: event.visibility || "default",
  busy: event.busy !== false,
  guests: event.guests || [],
  guestsCanModify: event.guestsCanModify || false,
  guestsCanInvite: event.guestsCanInvite !== false,
  guestsCanSeeGuestList: event.guestsCanSeeGuestList !== false,
  projectId: event.projectId,
  taskId: event.pmsId,
});

const fromApiEvent = (row: any): CalendarEvent => ({
  id: row.id,
  title: row.title,
  project: row.project || "",
  date: row.date,
  endDate: row.endDate || row.date,
  startTime: row.startTime,
  endTime: row.endTime,
  colorIdx: row.colorIdx ?? 0,
  source: row.source === "plan" ? "plan" : "manual",
  googleEventId: row.googleEventId || undefined,
  description: row.description || "",
  location: row.location || "",
  videoLink: row.videoLink || "",
  allDay: !!row.allDay,
  calendarType: row.calendarType || "meeting",
  repeat: row.repeat || "none",
  reminders: Array.isArray(row.reminders) ? row.reminders : [30],
  visibility: row.visibility || "default",
  busy: row.busy !== false,
  projectId: row.projectId,
  pmsId: row.pmsId || row.taskId,
  guests: Array.isArray(row.guests) ? row.guests : [],
});

const fetchManualEvents = async (employeeCode: string, date: string): Promise<CalendarEvent[]> => {
  const res = await fetch(`/api/calendar-events?employeeCode=${encodeURIComponent(employeeCode)}&date=${encodeURIComponent(date)}`);
  if (!res.ok) throw new Error("Failed to load calendar events");
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map(fromApiEvent) : [];
};

const createManualEvent = async (employeeCode: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> => {
  const res = await fetch("/api/calendar-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toApiEventBody(employeeCode, event)),
  });
  if (!res.ok) throw new Error("Failed to create calendar event");
  return fromApiEvent(await res.json());
};

const updateManualEvent = async (employeeCode: string, id: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> => {
  const res = await fetch(`/api/calendar-events/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toApiEventBody(employeeCode, event)),
  });
  if (!res.ok) throw new Error("Failed to update calendar event");
  return fromApiEvent(await res.json());
};

const deleteManualEvent = async (employeeCode: string, id: string): Promise<void> => {
  const res = await fetch(`/api/calendar-events/${encodeURIComponent(id)}?employeeCode=${encodeURIComponent(employeeCode)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete calendar event");
};

// ─── Guests API (Timestrap-owned table, separate from PMS) ──────────────────

const fetchEventGuests = async (
  employeeCode: string,
  eventId: string
): Promise<{ guests: Guest[]; guestsCanModify: boolean; guestsCanInvite: boolean; guestsCanSeeGuestList: boolean }> => {
  const res = await fetch(`/api/calendar-events/${encodeURIComponent(eventId)}/guests?employeeCode=${encodeURIComponent(employeeCode)}`);
  if (!res.ok) return { guests: [], guestsCanModify: false, guestsCanInvite: true, guestsCanSeeGuestList: true };
  return res.json();
};

const saveEventGuests = async (
  employeeCode: string,
  eventId: string,
  payload: { guests: Guest[]; guestsCanModify: boolean; guestsCanInvite: boolean; guestsCanSeeGuestList: boolean }
): Promise<void> => {
  await fetch(`/api/calendar-events/${encodeURIComponent(eventId)}/guests`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeCode, ...payload }),
  });
};

const deleteEventGuests = async (employeeCode: string, eventId: string): Promise<void> => {
  try {
    await fetch(`/api/calendar-events/${encodeURIComponent(eventId)}/guests?employeeCode=${encodeURIComponent(employeeCode)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.error("Failed to delete event guests:", err);
  }
};

const formatLastSynced = (isoString: string | null): string => {
  if (!isoString) return "Synced by PMS — no sync yet";
  const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 60000));
  if (minutesAgo < 1) return "Last synced just now";
  if (minutesAgo < 60) return `Last synced ${minutesAgo}m ago`;
  const hoursAgo = Math.round(minutesAgo / 60);
  return `Last synced ${hoursAgo}h ago`;
};

const syncPlanEventToPms = async (employeeCode: string | undefined, event: CalendarEvent) => {
  if (!employeeCode || !event.pmsId) return;
  try {
    await fetch("/api/calendar-events/plan-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...event,
        employeeCode,
        taskId: event.pmsId, // The backend expects `taskId` (which corresponds to `pmsId` in frontend)
      }),
    });
  } catch (err) {
    console.error("Failed to sync plan event to PMS:", err);
  }
};

const removePlanEventFromPms = async (employeeCode: string | undefined, taskId: string | undefined) => {
  if (!employeeCode || !taskId) return;
  try {
    await fetch(`/api/calendar-events/plan-sync/${encodeURIComponent(taskId)}?employeeCode=${encodeURIComponent(employeeCode)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.error("Failed to remove synced plan event from PMS:", err);
  }
};

const fmtHour = (h: number): string => {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
};

const getIsLightMode = (): boolean => {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("style")?.includes("invert") ?? false;
};

// ─── Components ───────────────────────────────────────────────────────────────

function EventPill({ event, onClick, style, compact = false, onDragStart, onDragEnd, onResizeStart }: EventPillProps & { onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; onResizeStart?: (e: React.MouseEvent) => void }) {
  const c = EVENT_COLORS[event.colorIdx ?? 0];
  const dur = toMin(event.endTime) - toMin(event.startTime);
  return (
    <div
      draggable
      onClick={() => onClick(event)}
      onDragStart={(e) => {
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("application/json", JSON.stringify(event));
        onDragStart?.(e);
      }}
      onDragEnd={() => onDragEnd?.()}
      style={{
        background: c.bg, color: "#fff", borderRadius: 6,
        padding: compact ? "2px 6px" : "4px 8px",
        cursor: "grab", overflow: "hidden", userSelect: "none",
        fontSize: 12, lineHeight: 1.3, boxSizing: "border-box", position: "relative", ...style,
      }}
      onMouseDown={(e) => e.currentTarget.style.cursor = "grabbing"}
      onMouseUp={(e) => e.currentTarget.style.cursor = "grab"}
    >
      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {event.title}
      </div>
      {!compact && dur > 30 && (
        <div style={{ opacity: 0.85, fontSize: 11, marginTop: 1 }}>
          {event.startTime} – {event.endTime}
        </div>
      )}
      {onResizeStart && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onResizeStart(e);
          }}
          title="Drag to extend or shorten"
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, height: 6,
            cursor: "ns-resize",
          }}
        />
      )}
    </div>
  );
}

const SNAP_MIN = 15; // resize snapping granularity, in minutes
const MIN_EVENT_MIN = 15; // shortest an event can be resized down to

function DayColumn({ day, events, onSlotClick, onEventClick, onEventResize, onDragStart, onDragEnd, onEventDrop }: DayColumnProps & { onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; onEventDrop?: (event: CalendarEvent, targetHour: number) => void }) {
  const SLOT_H = 48;
  const START_HOUR = 7;
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startY: number; startMin: number; origEndMin: number; deltaMin: number } | null>(null);

  // Track the in-progress resize with mousemove/mouseup on the window, so the
  // drag keeps working even if the cursor leaves the event pill.
  useEffect(() => {
    if (!resizing) return;

    const handleMove = (e: MouseEvent) => {
      const deltaPx = e.clientY - resizing.startY;
      const rawDeltaMin = (deltaPx / SLOT_H) * 60;
      const snapped = Math.round(rawDeltaMin / SNAP_MIN) * SNAP_MIN;
      setResizing((r) => (r ? { ...r, deltaMin: snapped } : r));
    };

    const handleUp = () => {
      setResizing((r) => {
        if (r && onEventResize) {
          const evt = events.find((e) => e.id === r.id);
          if (evt) {
            const proposedEnd = r.origEndMin + r.deltaMin;
            const clampedEnd = Math.max(r.startMin + MIN_EVENT_MIN, Math.min(23 * 60 + 59, proposedEnd));
            const newEndTime = `${String(Math.floor(clampedEnd / 60)).padStart(2, "0")}:${String(clampedEnd % 60).padStart(2, "0")}`;
            onEventResize(evt, newEndTime);
          }
        }
        return null;
      });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing, onEventResize, events]);

  return (
    <div style={{ flex: 1, minWidth: 0, position: "relative", borderLeft: "1px solid #e0e0e0" }}>
      {WORKING_HOURS.map((hour) => (
        <div
          key={hour}
          onClick={() => onSlotClick(day, hour)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = "move";
            setDragOverHour(hour);
            (e.currentTarget as HTMLDivElement).style.background = "#e8f0ff";
          }}
          onDragLeave={(e) => {
            setDragOverHour(null);
            (e.currentTarget as HTMLDivElement).style.background = getIsLightMode() ? "#070600" : "#f8f9ff";
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverHour(null);
            (e.currentTarget as HTMLDivElement).style.background = "";
            try {
              const data = e.dataTransfer!.getData("application/json");
              console.log(`Drop event at hour ${hour}, data length: ${data.length}`);
              const draggedEvent = JSON.parse(data) as CalendarEvent;
              console.log(`Parsed dragged event:`, draggedEvent);
              if (draggedEvent && onEventDrop) {
                console.log(`Calling onEventDrop with event ${draggedEvent.id} to hour ${hour}`);
                onEventDrop(draggedEvent, hour);
              } else {
                console.log(`Missing draggedEvent or onEventDrop callback`);
              }
            } catch (err) {
              console.error("Drop failed:", err);
            }
          }}
          style={{ height: SLOT_H, borderBottom: "1px solid #f0f0f0", boxSizing: "border-box", cursor: "pointer", background: dragOverHour === hour ? "#e8f0ff" : "" }}
          onMouseEnter={(e) => { if (dragOverHour !== hour) (e.currentTarget as HTMLDivElement).style.background = getIsLightMode() ? "#070600" : "#f8f9ff"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = dragOverHour === hour ? "#e8f0ff" : ""; }}
        />
      ))}
      {(() => {
        // ── Column layout algorithm (Google Calendar-style side-by-side) ──
        // 1. Build a list of event rects with their time ranges
        type EvtRect = { evt: CalendarEvent; startMin: number; endMin: number };
        const rects: EvtRect[] = events
          .map((evt) => {
            const startMin = toMin(evt.startTime);
            const baseEndMin = Math.max(startMin + 15, toMin(evt.endTime));
            const isResizingThis = resizing?.id === evt.id;
            const endMin = isResizingThis
              ? Math.max(startMin + MIN_EVENT_MIN, Math.min(23 * 60 + 59, baseEndMin + resizing.deltaMin))
              : baseEndMin;
            return { evt, startMin, endMin };
          })
          .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

        // 2. Group overlapping events into clusters
        type Cluster = { rects: EvtRect[]; columns: Map<string, number>; maxCol: number };
        const clusters: Cluster[] = [];
        for (const rect of rects) {
          // Try to add to the last cluster if it overlaps
          const last = clusters[clusters.length - 1];
          if (last && last.rects.some((r) => r.startMin < rect.endMin && rect.startMin < r.endMin)) {
            last.rects.push(rect);
          } else {
            clusters.push({ rects: [rect], columns: new Map(), maxCol: 0 });
          }
        }

        // 3. Assign columns within each cluster
        for (const cluster of clusters) {
          const columnEnds: number[] = []; // tracks the end-time of each column
          for (const rect of cluster.rects) {
            // Find the first column where this event fits (i.e., doesn't overlap)
            let placed = false;
            for (let col = 0; col < columnEnds.length; col++) {
              if (columnEnds[col] <= rect.startMin) {
                columnEnds[col] = rect.endMin;
                cluster.columns.set(rect.evt.id, col);
                placed = true;
                break;
              }
            }
            if (!placed) {
              cluster.columns.set(rect.evt.id, columnEnds.length);
              columnEnds.push(rect.endMin);
            }
          }
          cluster.maxCol = columnEnds.length;
        }

        // 4. Build a lookup from event id → { col, totalCols }
        const layout = new Map<string, { col: number; totalCols: number }>();
        for (const cluster of clusters) {
          for (const rect of cluster.rects) {
            layout.set(rect.evt.id, {
              col: cluster.columns.get(rect.evt.id) || 0,
              totalCols: cluster.maxCol,
            });
          }
        }

        // 5. Render with computed widths and positions
        return rects.map(({ evt, startMin, endMin }) => {
          const isResizingThis = resizing?.id === evt.id;
          const topOffset = ((startMin - START_HOUR * 60) / 60) * SLOT_H;
          const height = Math.max(20, ((endMin - startMin) / 60) * SLOT_H - 2);
          const { col, totalCols } = layout.get(evt.id) || { col: 0, totalCols: 1 };
          const widthPercent = 100 / totalCols;
          const leftPercent = col * widthPercent;

          return (
            <EventPill
              key={evt.id}
              event={evt}
              onClick={onEventClick}
              compact={false}
              onDragStart={isResizingThis ? undefined : onDragStart}
              onDragEnd={() => onDragEnd?.()}
              onResizeStart={onEventResize ? (e) => setResizing({ id: evt.id, startY: e.clientY, startMin, origEndMin: endMin, deltaMin: 0 }) : undefined}
              style={{
                position: "absolute",
                left: `calc(${leftPercent}% + 1px)`,
                width: `calc(${widthPercent}% - 3px)`,
                top: topOffset,
                height,
                zIndex: isResizingThis ? 20 : 1,
              }}
            />
          );
        });
      })()}
    </div>
  );
}

function WeekGrid({ weekDays, events, onSlotClick, onEventClick, onEventResize, today }: WeekGridProps) {
  const SLOT_H = 48;
  return (
    <div style={{ display: "flex", flex: 1, overflow: "auto", position: "relative" }}>
      <div style={{ width: 56, flexShrink: 0 }}>
        <div style={{ height: 20 }} />
        {WORKING_HOURS.map((h) => (
          <div key={h} style={{ height: SLOT_H, boxSizing: "border-box", paddingRight: 8, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 11, color: "#70757a", marginTop: -6 }}>{fmtHour(h)}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", borderBottom: "1px solid #e0e0e0", height: 20 }}>
          {weekDays.map((day) => {
            const dayIsToday = isSameDay(day, today);
            return (
              <div key={day.toISOString()} style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 4, borderLeft: "1px solid #e0e0e0" }}>
                <span style={{ fontSize: 11, color: dayIsToday ? "#1a73e8" : "#70757a" }}>{format(day, "EEE").toUpperCase()}</span>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: dayIsToday ? "#1a73e8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: dayIsToday ? 700 : 400, color: dayIsToday ? "#fff" : "#3c4043" }}>{format(day, "d")}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", flex: 1 }}>
          {weekDays.map((day) => {
            const dayStr = format(day, "yyyy-MM-dd");
            const dayEvts = events.filter((e) => e.date === dayStr);
            return (
              <DayColumn
                key={day.toISOString()}
                day={day}
                events={dayEvts}
                onSlotClick={onSlotClick}
                onEventClick={onEventClick}
                onEventResize={onEventResize}
                isToday={isSameDay(day, today)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ monthDays, selectedDate, events, onDayClick, today }: MonthGridProps) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid #e0e0e0" }}>
        {DAYS.map((d) => (
          <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 500, color: "#70757a" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "minmax(90px, 1fr)" }}>
        {monthDays.map((day) => {
          const dayStr = format(day, "yyyy-MM-dd");
          const dayEvts = events.filter((e) => e.date === dayStr);
          const inMonth = isSameMonth(day, selectedDate);
          const dayIsToday = isSameDay(day, today);
          const isSel = isSameDay(day, selectedDate);
          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              style={{ border: "1px solid #f0f0f0", padding: "4px 6px", cursor: "pointer", overflow: "hidden", background: isSel ? "#e8f0fe" : (getIsLightMode() ? "#000000" : "white") }}
              onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = getIsLightMode() ? "#090A0C" : "#fafafa"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isSel ? "#e8f0fe" : (getIsLightMode() ? "#000000" : "white"); }}
            >
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 2 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: dayIsToday ? "#1a73e8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 12, color: dayIsToday ? "#fff" : inMonth ? "#3c4043" : "#b0b0b0", fontWeight: dayIsToday ? 700 : 400 }}>
                    {format(day, "d")}
                  </span>
                </div>
              </div>
              {dayEvts.slice(0, 3).map((evt) => (
                <EventPill key={evt.id} event={evt} onClick={() => { }} style={{ marginBottom: 2 }} compact />
              ))}
              {dayEvts.length > 3 && <div style={{ fontSize: 11, color: "#1a73e8", paddingLeft: 2 }}>+{dayEvts.length - 3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar({ value, onChange }: MiniCalendarProps) {
  const [month, setMonth] = useState<Date>(new Date(value));
  const monthStart = startOfMonth(month);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(calStart, i));
  const today = new Date();

  return (
    <div style={{ padding: "8px 12px", userSelect: "none" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <button onClick={() => setMonth(subMonths(month, 1))} style={{ background: "none", border: "none", cursor: "pointer", color: "#70757a", fontSize: 16, padding: "2px 6px" }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#3c4043" }}>{format(month, "MMMM yyyy")}</span>
        <button onClick={() => setMonth(addMonths(month, 1))} style={{ background: "none", border: "none", cursor: "pointer", color: "#70757a", fontSize: 16, padding: "2px 6px" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 28px)", gap: 0, justifyContent: "center" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: "#70757a", height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>{d}</div>
        ))}
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          const isSel = isSameDay(day, value);
          const inMonth = isSameMonth(day, month);
          return (
            <div
              key={day.toISOString()}
              onClick={() => { onChange(day); setMonth(day); }}
              style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 12,
                background: isSel ? "#1a73e8" : isToday ? "#e8f0fe" : "transparent",
                color: isSel ? "#fff" : isToday ? "#1a73e8" : inMonth ? "#3c4043" : "#c5c5c5",
                fontWeight: isSel || isToday ? 600 : 400,
              }}
            >{format(day, "d")}</div>
          );
        })}
      </div>
    </div>
  );
}

function EventModal({ event, onClose, onSave, onDelete, mode, user }: EventModalProps) {
  const [title, setTitle] = useState<string>(event?.title === "Untitled Task" ? "" : (event?.title || ""));
  const [project, setProject] = useState<string>(event?.project || "");
  const [date, setDate] = useState<string>(event?.date || format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState<string>(event?.endDate || event?.date || format(new Date(), "yyyy-MM-dd"));
  const [start, setStart] = useState<string>(event?.startTime || "09:00");
  const [end, setEnd] = useState<string>(event?.endTime || "10:00");
  const [colorIdx, setColorIdx] = useState<number>(event?.colorIdx ?? 0);
  const [calendarType, setCalendarType] = useState<string>(event?.calendarType || "meeting");
  const [description, setDescription] = useState<string>(event?.description || "");
  const [location, setLocation] = useState<string>(event?.location || "");
  const [videoLink, setVideoLink] = useState<string>(event?.videoLink || "");
  const [allDay, setAllDay] = useState<boolean>(event?.allDay ?? false);
  const [repeat, setRepeat] = useState<string>(event?.repeat || "none");
  const [reminders, setReminders] = useState<number[]>(event?.reminders || [30]);
  const [visibility, setVisibility] = useState<"default" | "public" | "private">(event?.visibility || "default");
  const [busy, setBusy] = useState<boolean>(event?.busy ?? true);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedProjectCode, setSelectedProjectCode] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>(event?.pmsId || "");
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [loadingTasks, setLoadingTasks] = useState<boolean>(false);

  const [guests, setGuests] = useState<Guest[]>(event?.guests || []);
  const [guestsCanModify, setGuestsCanModify] = useState<boolean>(event?.guestsCanModify ?? false);
  const [guestsCanInvite, setGuestsCanInvite] = useState<boolean>(event?.guestsCanInvite ?? true);
  const [guestsCanSeeGuestList, setGuestsCanSeeGuestList] = useState<boolean>(event?.guestsCanSeeGuestList ?? true);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [guestSearch, setGuestSearch] = useState<string>("");
  const [externalEmail, setExternalEmail] = useState<string>("");
  const [showGuestPicker, setShowGuestPicker] = useState<boolean>(false);

  const dur = Math.max(0, toMin(end) - toMin(start));

  const toggleReminder = (value: number) => {
    setReminders((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value].sort((a, b) => a - b)));
  };

  // Load the team directory once (for the "add guest" search) and, in edit
  // mode, the guests already saved against this event.
  useEffect(() => {
    let isMounted = true;

    fetch("/api/employees")
      .then((r) => r.json())
      .then((data) => isMounted && setEmployees(Array.isArray(data) ? data : []))
      .catch(() => isMounted && setEmployees([]));

    const eventKey = event?.pmsId || event?.id;
    if (mode === "edit" && eventKey && user?.employeeCode) {
      fetchEventGuests(user.employeeCode, eventKey)
        .then((data) => {
          if (!isMounted) return;
          setGuests(data.guests);
          setGuestsCanModify(data.guestsCanModify);
          setGuestsCanInvite(data.guestsCanInvite);
          setGuestsCanSeeGuestList(data.guestsCanSeeGuestList);
        })
        .catch(() => undefined);
    }

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addGuest = (guest: Guest) => {
    setGuests((prev) => (prev.some((g) => g.email.toLowerCase() === guest.email.toLowerCase()) ? prev : [...prev, guest]));
  };

  const removeGuest = (id: string) => setGuests((prev) => prev.filter((g) => g.id !== id));

  const toggleGuestOptional = (id: string) =>
    setGuests((prev) => prev.map((g) => (g.id === id ? { ...g, optional: !g.optional } : g)));

  const addExternalEmail = () => {
    const email = externalEmail.trim();
    if (!EMAIL_RE.test(email)) return;
    addGuest({ id: guestUid(), name: email, email, isExternal: true, optional: false });
    setExternalEmail("");
  };

  const availableEmployees = employees.filter(
    (e) =>
      !guests.some((g) => g.email.toLowerCase() === (e.email || "").toLowerCase()) &&
      (e.name || "").toLowerCase().includes(guestSearch.toLowerCase())
  );

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let isMounted = true;
    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const params = new URLSearchParams({
          userRole: user.role || "",
          userEmpCode: user.employeeCode || "",
          userDepartment: user.department || "",
        });

        const response = await fetch(`/api/projects?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Unable to load projects");
        }

        const data = await response.json();
        if (!isMounted) return;

        const nextProjects = Array.isArray(data)
          ? data.map((candidate: Partial<ProjectOption> & { project_name?: string; project_code?: string }, index: number) =>
            normalizeProjectOption(candidate, index)
          )
          : [];
        setProjects(nextProjects);
      } catch {
        if (isMounted) {
          setProjects([]);
          setSelectedProjectId("");
          setSelectedProjectCode("");
        }
      } finally {
        if (isMounted) {
          setLoadingProjects(false);
        }
      }
    };

    loadProjects();

    return () => {
      isMounted = false;
    };
  }, [user?.department, user?.employeeCode, user?.id, user?.role]);

  useEffect(() => {
    const matchedProject = projects.find((candidate) => candidate.project_name === project || candidate.project_code === project);
    if (matchedProject) {
      setSelectedProjectId(matchedProject.id);
      setSelectedProjectCode(matchedProject.project_code || "");
      return;
    }

    setSelectedProjectId("");
    setSelectedProjectCode("");
  }, [project, projects]);

  useEffect(() => {
    if (!selectedProjectCode) {
      setTasks([]);
      setSelectedTaskId("");
      return;
    }

    let isMounted = true;
    const loadTasks = async () => {
      setLoadingTasks(true);
      try {
        const params = new URLSearchParams({
          projectId: selectedProjectCode,
          userDepartment: user?.department || "",
          userEmpCode: user?.employeeCode || "",
          userRole: user?.role || "",
        });

        const response = await fetch(`/api/tasks?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Unable to load tasks");
        }

        const data = await response.json();
        if (!isMounted) return;

        const nextTasks = Array.isArray(data) ? data : [];
        setTasks(nextTasks);

        if (event?.pmsId && nextTasks.some((task) => task.id === event.pmsId)) {
          setSelectedTaskId(event.pmsId);
        } else if (nextTasks.length > 0 && !selectedTaskId) {
          setSelectedTaskId("");
        }
      } catch {
        if (isMounted) {
          setTasks([]);
        }
      } finally {
        if (isMounted) {
          setLoadingTasks(false);
        }
      }
    };

    loadTasks();

    return () => {
      isMounted = false;
    };
  }, [event?.pmsId, selectedProjectCode, selectedTaskId, user?.department, user?.employeeCode]);

  const handleProjectChange = (nextProject: string) => {
    setProject(nextProject);

    const matchedProject = projects.find((candidate) => candidate.project_name === nextProject || candidate.project_code === nextProject);
    if (matchedProject) {
      setSelectedProjectId(matchedProject.id);
      setSelectedProjectCode(matchedProject.project_code || "");
      setProject(matchedProject.project_name);
      setSelectedTaskId("");
      return;
    }

    setSelectedProjectId("");
    setSelectedProjectCode("");
    setTasks([]);
    setSelectedTaskId("");
  };

  const handleTaskChange = (nextTaskId: string) => {
    setSelectedTaskId(nextTaskId);
    const selectedTask = tasks.find((task) => task.id === nextTaskId);
    if (selectedTask) {
      setTitle(selectedTask.task_name);
      const matchedProject = projects.find((candidate) =>
        candidate.id === selectedTask.project_id || candidate.project_code === selectedTask.project_code
      );
      setProject(matchedProject?.project_name || project);
    }
  };

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: getIsLightMode() ? "#000000" : "#fff",
          borderRadius: 16,
          width: "min(860px, 95vw)",
          maxWidth: "95vw",
          maxHeight: "86vh",
          overflowY: "auto",
          overflowX: "hidden",
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.22)",
          scrollbarWidth: "thin",
        }}
      >
        <div style={{ background: EVENT_COLORS[colorIdx].bg, padding: "16px 20px 12px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selectedTask ? "Task title" : "Add title"}
              style={{ background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.5)", color: "#fff", fontSize: 22, fontWeight: 400, outline: "none", width: "100%", marginRight: 12, paddingBottom: 4 }}
            />
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {EVENT_COLORS.map((c, i) => (
              <div key={i} onClick={() => setColorIdx(i)} style={{ width: 20, height: 20, borderRadius: "50%", background: c.bg, border: i === colorIdx ? "2px solid white" : "2px solid transparent", cursor: "pointer" }} />
            ))}
          </div>
        </div>
        <div style={{ padding: "16px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>TYPE</label>
              <select
                value={calendarType}
                onChange={(e) => setCalendarType(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", background: getIsLightMode() ? "#000000" : "#fff" }}
              >
                {CALENDAR_TYPES.map((type) => (
                  <option key={type.key} value={type.key}>{type.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {EVENT_COLORS.map((c, i) => (
                <div key={i} onClick={() => setColorIdx(i)} style={{ width: 20, height: 20, borderRadius: "50%", background: c.bg, border: i === colorIdx ? "2px solid #1a73e8" : "2px solid transparent", cursor: "pointer" }} />
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3c4043", cursor: "pointer", marginLeft: 6 }}>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              <span>All day</span>
            </label>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>PROJECT</label>
            <input
              value={project}
              onChange={(e) => handleProjectChange(e.target.value)}
              list="calendar-project-options"
              placeholder="Select or type a project"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 12px", fontSize: 14, outline: "none" }}
            />
            <datalist id="calendar-project-options">
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.project_name} />
              ))}
            </datalist>
            {loadingProjects && (
              <div style={{ fontSize: 12, color: "#70757a", marginTop: 6 }}>Loading projects…</div>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>TASK</label>
            <select
              value={selectedTaskId}
              onChange={(e) => handleTaskChange(e.target.value)}
              disabled={!selectedProjectId || loadingTasks}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 12px", fontSize: 14, outline: "none", background: getIsLightMode() ? "#000000" : "#fff" }}
            >
              <option value="">{selectedProjectId ? "Select a task (optional)" : "Choose a project to load tasks"}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>{task.task_name}</option>
              ))}
            </select>
            {loadingTasks && (
              <div style={{ fontSize: 12, color: "#70757a", marginTop: 6 }}>Loading tasks…</div>
            )}
            {!selectedProjectId && (
              <div style={{ fontSize: 12, color: "#70757a", marginTop: 6 }}>Pick a project to see available tasks.</div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>DATE</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            </div>
            {!allDay && (
              <div>
                <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>START</label>
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>END DATE</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            </div>
            {!allDay && (
              <div>
                <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>END</label>
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 170 }}>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>REPEAT</label>
              <select value={repeat} onChange={(e) => setRepeat(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", background: getIsLightMode() ? "#000000" : "#fff" }}>
                {REPEAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>LOCATION</label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>VIDEO LINK</label>
            <input value={videoLink} onChange={(e) => setVideoLink(e.target.value)} placeholder="Add video conference link" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>DESCRIPTION</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add description" rows={3} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", resize: "vertical" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>BUSY / FREE</label>
              <select value={busy ? "busy" : "free"} onChange={(e) => setBusy(e.target.value === "busy")} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", background: getIsLightMode() ? "#000000" : "#fff" }}>
                <option value="busy">Busy</option>
                <option value="free">Free</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>VISIBILITY</label>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as "default" | "public" | "private")} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", background: getIsLightMode() ? "#000000" : "#fff" }}>
                <option value="default">Default</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 8 }}>GUESTS</label>

            {guests.length === 0 && (
              <div style={{ fontSize: 12, color: "#9aa0a6", marginBottom: 8 }}>No guests added yet.</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8, maxHeight: 140, overflowY: "auto" }}>
              {guests.map((g) => (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #e0e0e0", borderRadius: 6, padding: "6px 8px" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e8f0fe", color: "#1a73e8", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {(g.name || g.email).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: "#70757a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.email}</div>
                  </div>
                  {g.isExternal && (
                    <span style={{ fontSize: 9, color: "#5f6368", border: "1px solid #dadce0", borderRadius: 4, padding: "1px 4px" }}>external</span>
                  )}
                  <button type="button" onClick={() => toggleGuestOptional(g.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#70757a" }}>
                    {g.optional ? "Optional" : "Required"}
                  </button>
                  <button type="button" onClick={() => removeGuest(g.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9aa0a6", fontSize: 14, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>

            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setShowGuestPicker((v) => !v)}
                style={{ width: "100%", padding: "7px 10px", border: "1px solid #dadce0", borderRadius: 6, background: getIsLightMode() ? "#000000" : "#fff", cursor: "pointer", fontSize: 13, color: "#3c4043" }}
              >
                + Add guests
              </button>
              {showGuestPicker && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: getIsLightMode() ? "#000000" : "#fff", border: "1px solid #e0e0e0", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", zIndex: 10, padding: 8 }}>
                  <input
                    value={guestSearch}
                    onChange={(e) => setGuestSearch(e.target.value)}
                    placeholder="Search team members…"
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "6px 10px", fontSize: 13, outline: "none", marginBottom: 6 }}
                  />
                  <div style={{ maxHeight: 140, overflowY: "auto" }}>
                    {availableEmployees.length === 0 && (
                      <div style={{ fontSize: 12, color: "#9aa0a6", padding: "4px 2px" }}>No matching team members.</div>
                    )}
                    {availableEmployees.slice(0, 30).map((emp) => (
                      <div
                        key={emp.id}
                        onClick={() =>
                          addGuest({ id: guestUid(), name: emp.name, email: emp.email || "", isExternal: false, optional: false })
                        }
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", cursor: "pointer", borderRadius: 4 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontSize: 12 }}>{emp.name}</div>
                        <div style={{ fontSize: 11, color: "#9aa0a6" }}>{emp.designation || emp.department}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, borderTop: "1px solid #f0f0f0", paddingTop: 6 }}>
                    <input
                      value={externalEmail}
                      onChange={(e) => setExternalEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addExternalEmail()}
                      placeholder="Invite by email…"
                      style={{ flex: 1, boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "6px 10px", fontSize: 13, outline: "none" }}
                    />
                    <button
                      type="button"
                      onClick={addExternalEmail}
                      disabled={!EMAIL_RE.test(externalEmail.trim())}
                      style={{ padding: "6px 12px", border: "none", borderRadius: 6, background: "#1a73e8", color: "#fff", fontSize: 12, cursor: EMAIL_RE.test(externalEmail.trim()) ? "pointer" : "not-allowed", opacity: EMAIL_RE.test(externalEmail.trim()) ? 1 : 0.5 }}
                    >
                      Invite
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#3c4043", cursor: "pointer" }}>
                <input type="checkbox" checked={guestsCanModify} onChange={(e) => setGuestsCanModify(e.target.checked)} /> Guests can modify event
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#3c4043", cursor: "pointer" }}>
                <input type="checkbox" checked={guestsCanInvite} onChange={(e) => setGuestsCanInvite(e.target.checked)} /> Guests can invite others
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#3c4043", cursor: "pointer" }}>
                <input type="checkbox" checked={guestsCanSeeGuestList} onChange={(e) => setGuestsCanSeeGuestList(e.target.checked)} /> Guests can see guest list
              </label>
            </div>
          </div>

          <div style={{ marginTop: 10, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 6 }}>NOTIFICATIONS</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {reminders.map((item) => (
                <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid #e0e0e0", borderRadius: 999, padding: "4px 8px", fontSize: 11, color: "#3c4043" }}>
                  {REMINDER_OPTIONS.find((option) => option.value === item)?.label || `${item} min before`}
                  <button type="button" onClick={() => toggleReminder(item)} style={{ background: "none", border: "none", cursor: "pointer", color: "#70757a", fontSize: 12 }}>×</button>
                </span>
              ))}
            </div>
            <select
              value=""
              onChange={(e) => toggleReminder(Number(e.target.value))}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", background: getIsLightMode() ? "#000000" : "#fff" }}
            >
              <option value="">Add a notification</option>
              {REMINDER_OPTIONS.filter((option) => !reminders.includes(option.value)).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            {mode === "edit" && event.id ? (
              <button onClick={() => onDelete(event.id!)} style={{ background: "none", border: "none", color: "#d93025", cursor: "pointer", fontSize: 13, padding: "8px 0" }}>Delete event</button>
            ) : <div />}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ padding: "8px 20px", border: "1px solid #dadce0", borderRadius: 6, background: getIsLightMode() ? "#000000" : "white", cursor: "pointer", fontSize: 14, color: "#3c4043" }}>Cancel</button>
              <button
                onClick={() => onSave({
                  id: event?.id || String(Date.now()),
                  title, project, projectId: selectedProjectId, date, endDate, startTime: start, endTime: end, colorIdx,
                  source: event?.source || "manual",
                  pmsId: selectedTask?.id || event?.pmsId,
                  guests, guestsCanModify, guestsCanInvite, guestsCanSeeGuestList,
                  description,
                  location,
                  videoLink,
                  allDay,
                  calendarType,
                  repeat,
                  reminders,
                  visibility,
                  busy,
                })}
                style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#1a73e8", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 500 }}
              >Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CalendarViewPage({ user }: CalendarViewPageProps) {
  const { toast } = useToast();
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [googleConnected, setGoogleConnected] = useState<boolean>(false);
  const [googleStatus, setGoogleStatus] = useState<string>("Not connected");
  const [googleLastSyncedAt, setGoogleLastSyncedAt] = useState<string | null>(null);
  const [draggedEvent, setDraggedEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;

    let isMounted = true;
    const targetDate = format(selectedDate, "yyyy-MM-dd");

    // PMS's calendar_events table is the single source of truth for this
    // calendar: manual ("meeting") events AND plan-of-the-day ("task") rows,
    // including breaks and ad-hoc entries, all live there once the plan is
    // submitted (see the plan-sync block in /api/daily-plans). We no longer
    // merge in the old `plan_schedule_*` / `pendingTasks_*` localStorage
    // fallbacks — that data can go stale and disagrees with what PMS shows.
    const loadEvents = async () => {
      try {
        let manualEvents: CalendarEvent[] = [];
        try {
          if (user.employeeCode) {
            manualEvents = (await fetchManualEvents(user.employeeCode, targetDate)).map((event) => ({
              ...event,
              title: normalizeEventTitle(event.title, event.project),
            }));
          }
        } catch (err) {
          console.error("Failed to load calendar events from PMS:", err);
          return; // keep whatever was previously loaded rather than clearing on a transient error
        }

        if (!isMounted) return;
        setEvents(manualEvents);
      } catch (err) {
        console.error("Failed to load events for calendar:", err);
      }
    };

    loadEvents();

    // Poll so edits made on the PMS side (or from another device/tab) show
    // up here without requiring a manual page refresh.
    const intervalId = window.setInterval(loadEvents, 15000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [selectedDate, user?.id, user?.employeeCode]);

  const refreshGoogleStatus = async () => {
    if (!user?.id) {
      setGoogleConnected(false);
      setGoogleStatus("Not connected");
      setGoogleLastSyncedAt(null);
      return;
    }
    try {
      const status = await fetchGoogleStatus(user.employeeCode);
      setGoogleConnected(status.connected);
      setGoogleStatus(status.connected ? `Connected${status.googleEmail ? ` (${status.googleEmail})` : ""}` : "Not connected");
      setGoogleLastSyncedAt(status.lastSyncedAt || null);
    } catch (err) {
      console.error("Failed to load Google Calendar status:", err);
      setGoogleStatus("Unable to load Google Calendar status");
    }
  };

  useEffect(() => {
    refreshGoogleStatus();
  }, [user?.id]);

  const weekDays = useMemo<Date[]>(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

  const monthDays = useMemo<Date[]>(() => {
    const monthStart = startOfMonth(selectedDate);
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

  const filteredEvents = useMemo<CalendarEvent[]>(() => {
    if (!searchTerm.trim()) return events;
    const kw = searchTerm.toLowerCase();
    return events.filter((e) => `${e.title} ${e.project}`.toLowerCase().includes(kw));
  }, [events, searchTerm]);

  const navigate = (dir: number): void => {
    if (viewMode === "day") setSelectedDate((d) => addDays(d, dir));
    else if (viewMode === "week") setSelectedDate((d) => addDays(d, dir * 7));
    else setSelectedDate((d) => (dir > 0 ? addMonths(d, 1) : subMonths(d, 1)));
  };

  const openNew = (date: Date, hour: number): void => {
    const dateStr = format(date, "yyyy-MM-dd");
    const slotStartMin = hour * 60;
    const slotEndMin = (hour + 1) * 60;

    // Find events on the same day that overlap with or end within this slot
    const dayEvents = events.filter((e) => e.date === dateStr);

    // Find the latest event end-time that falls within or overlaps the clicked slot.
    // An event overlaps this slot if it starts before the slot ends AND ends after
    // the slot starts (i.e., it occupies any portion of this hour).
    let smartStartMin = slotStartMin;
    for (const evt of dayEvents) {
      const evtStart = toMin(evt.startTime);
      const evtEnd = toMin(evt.endTime);
      // Event overlaps this slot if it starts before slot end AND ends after slot start
      if (evtStart < slotEndMin && evtEnd > slotStartMin) {
        // The new event should start after this event ends
        if (evtEnd > smartStartMin && evtEnd <= slotEndMin) {
          smartStartMin = evtEnd;
        }
      }
    }

    // Calculate end time: default 30 minutes, capped at slot boundary or +60m
    const defaultDurationMin = 30;
    const smartEndMin = Math.min(23 * 60 + 59, smartStartMin + defaultDurationMin);

    const startTime = `${String(Math.floor(smartStartMin / 60)).padStart(2, "0")}:${String(smartStartMin % 60).padStart(2, "0")}`;
    const endTime = `${String(Math.floor(smartEndMin / 60)).padStart(2, "0")}:${String(smartEndMin % 60).padStart(2, "0")}`;

    setModal({
      mode: "new",
      event: {
        date: dateStr,
        startTime,
        endTime,
        colorIdx: 0,
        source: "manual",
      },
    });
  };

  const openEdit = (event: CalendarEvent): void => {
    setModal({ mode: "edit", event });
  };

  const syncEventToTimeEntry = async (event: CalendarEvent) => {
    if (!user?.id) return;
    try {
      await fetch('/api/time-entries/sync-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: user.id, event })
      });
    } catch (err) {
      console.error("Failed to sync event to time entries:", err);
    }
  };

  const handleEventDrop = (draggedEvent: CalendarEvent, targetHour: number): void => {
    console.log(`handleEventDrop called with event:`, draggedEvent, `targetHour:`, targetHour);
    console.log(`Dragged event has googleEventId: ${draggedEvent.googleEventId}`);
    if (!draggedEvent || !draggedEvent.id) {
      console.log(`Missing event or event ID`);
      return;
    }

    const durationMinutes = toMin(draggedEvent.endTime) - toMin(draggedEvent.startTime);
    const newStartMinutes = targetHour * 60;
    const newEndMinutes = Math.min(23 * 60 + 59, newStartMinutes + durationMinutes);

    const newStartTime = `${String(targetHour).padStart(2, '0')}:00`;
    const newEndHours = Math.floor(newEndMinutes / 60);
    const newEndMins = newEndMinutes % 60;
    const newEndTime = `${String(newEndHours).padStart(2, '0')}:${String(newEndMins).padStart(2, '0')}`;

    const updatedEvent = {
      ...draggedEvent,
      startTime: newStartTime,
      endTime: newEndTime,
    };

    console.log(`Updated event:`, updatedEvent);
    console.log(`Updated event has googleEventId: ${updatedEvent.googleEventId}`);
    const updatedEvents = events.map((e) => (e.id === draggedEvent.id ? updatedEvent : e));
    setEvents(updatedEvents);
    setDraggedEvent(null);

    if (updatedEvent.source === "manual") {
      if (user?.employeeCode) {
        updateManualEvent(user.employeeCode, updatedEvent.id, updatedEvent).catch((err) =>
          console.error("Failed to persist dragged event to PMS:", err)
        );
      }
    } else if (updatedEvent.source === "plan") {
      console.log(`Persisting plan update with googleEventId: ${updatedEvent.googleEventId}`);
      persistPlanUpdate(user?.id, updatedEvent.date, updatedEvent);
      syncPlanEventToPms(user?.employeeCode, updatedEvent);
    }

    syncEventToTimeEntry(updatedEvent);

    toast({
      title: "✅ Event Moved",
      description: `${updatedEvent.title} moved to ${newStartTime}–${newEndTime}`,
    });
    console.log(`Event drop completed`);
  };

  // Dragging the bottom edge of an event pill to extend/shorten its duration.
  const handleEventResize = (targetEvent: CalendarEvent, newEndTime: string): void => {
    if (!targetEvent || !targetEvent.id) return;
    if (newEndTime === targetEvent.endTime) return;

    const updatedEvent = { ...targetEvent, endTime: newEndTime };
    setEvents((prev) => prev.map((e) => (e.id === targetEvent.id ? updatedEvent : e)));

    if (updatedEvent.source === "manual") {
      if (user?.employeeCode) {
        updateManualEvent(user.employeeCode, updatedEvent.id, updatedEvent).catch((err) =>
          console.error("Failed to persist resized event to PMS:", err)
        );
      }
    } else if (updatedEvent.source === "plan") {
      persistPlanUpdate(user?.id, updatedEvent.date, updatedEvent);
      syncPlanEventToPms(user?.employeeCode, updatedEvent);
    }

    syncEventToTimeEntry(updatedEvent);

    toast({
      title: "✅ Duration updated",
      description: `${updatedEvent.title} now ends at ${newEndTime}`,
    });
  };

  // Google Calendar is owned by PMS. Connecting has to happen on PMS's
  // server (it holds the OAuth secret), so this just sends the user there.
  // After they come back, poll our own read-only status a few times to
  const connectGoogleCalendar = async () => {
    if (!user?.employeeCode) {
      setGoogleStatus("Sign in to connect Google Calendar.");
      return;
    }

    try {
      // Open a blank popup immediately to prevent popup blockers
      const popup = window.open("about:blank", "google-calendar", "width=520,height=700");
      if (!popup) {
        setGoogleStatus("Popup blocked. Please allow popups and try again.");
        return;
      }

      setGoogleStatus("Waiting for Google authorization...");

      // Fetch the actual OAuth URL from Timestrap backend
      const res = await fetch(`/api/google/auth/url?employeeCode=${encodeURIComponent(user.employeeCode)}`);
      if (!res.ok) {
        throw new Error("Failed to get Google Auth URL");
      }
      const data = await res.json();
      
      // Redirect the popup to Google
      popup.location.href = data.url;

      const poll = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(poll);
          refreshGoogleStatus();
        }
      }, 1000);
    } catch (err) {
      setGoogleStatus(err instanceof Error ? err.message : "Unable to connect Google Calendar.");
    }
  };

  const disconnectGoogleCalendar = async () => {
    try {
      await disconnectPmsGoogle(user?.employeeCode);
      setGoogleConnected(false);
      setGoogleStatus("Not connected");
      setGoogleLastSyncedAt(null);
    } catch (err) {
      toast({
        title: "❌ Disconnect failed",
        description: err instanceof Error ? err.message : "Unable to disconnect Google Calendar.",
        variant: "destructive",
      });
    }
  };

  const saveEvent = async (evt: CalendarEvent): Promise<void> => {
    const existingEvent = events.find((event) => event.id === evt.id);
    const normalizedTitle = normalizeEventTitle(evt.title, evt.project);
    const nextEvent = existingEvent
      ? { ...evt, title: normalizedTitle, googleEventId: existingEvent.googleEventId, source: evt.source || existingEvent.source }
      : { ...evt, title: normalizedTitle };

    if (nextEvent.source === "manual") {
      if (!user?.employeeCode) {
        setModal(null);
        return;
      }
      try {
        const saved = existingEvent
          ? await updateManualEvent(user.employeeCode, nextEvent.id, nextEvent)
          : await createManualEvent(user.employeeCode, nextEvent);
        setEvents((prev) =>
          existingEvent ? prev.map((event) => (event.id === saved.id ? saved : event)) : [...prev, saved]
        );
        syncEventToTimeEntry(saved);
        saveEventGuests(user.employeeCode, saved.id, {
          guests: nextEvent.guests || [],
          guestsCanModify: !!nextEvent.guestsCanModify,
          guestsCanInvite: nextEvent.guestsCanInvite !== false,
          guestsCanSeeGuestList: nextEvent.guestsCanSeeGuestList !== false,
        }).catch((err) => console.error("Failed to save guests:", err));
      } catch (err) {
        toast({
          title: "❌ Save failed",
          description: err instanceof Error ? err.message : "Unable to save event.",
          variant: "destructive",
        });
      }
      setModal(null);
      return;
    }

    const nextEvents = existingEvent
      ? events.map((event) => (event.id === evt.id ? nextEvent : event))
      : [...events, nextEvent];

    setEvents(nextEvents);

    if (nextEvent.source === "plan") {
      persistPlanUpdate(user?.id, existingEvent?.date, nextEvent);
      syncPlanEventToPms(user?.employeeCode, nextEvent);
      if (user?.employeeCode) {
        const guestKey = nextEvent.pmsId || nextEvent.id;
        saveEventGuests(user.employeeCode, guestKey, {
          guests: nextEvent.guests || [],
          guestsCanModify: !!nextEvent.guestsCanModify,
          guestsCanInvite: nextEvent.guestsCanInvite !== false,
          guestsCanSeeGuestList: nextEvent.guestsCanSeeGuestList !== false,
        }).catch((err) => console.error("Failed to save guests:", err));
      }
    }

    syncEventToTimeEntry(nextEvent);

    setModal(null);
  };

  const deleteEvent = async (id: string): Promise<void> => {
    const target = events.find((event) => event.id === id);

    if (!target) {
      setEvents((prev) => prev.filter((event) => event.id !== id));
      setModal(null);
      return;
    }

    if (target.source === "manual") {
      if (user?.employeeCode) {
        try {
          await deleteManualEvent(user.employeeCode, id);
        } catch (err) {
          toast({
            title: "❌ Delete failed",
            description: err instanceof Error ? err.message : "Unable to delete event.",
            variant: "destructive",
          });
        }
        deleteEventGuests(user.employeeCode, id);
      }
      setEvents((prev) => prev.filter((event) => event.id !== id));
      setModal(null);
      return;
    }

    const nextEvents = events.filter((event) => event.id !== id);
    setEvents(nextEvents);

    if (target.source === "plan") {
      removePlanEvent(user?.id, target.date, target);
      removePlanEventFromPms(user?.employeeCode, target.pmsId);
      if (user?.employeeCode) deleteEventGuests(user.employeeCode, target.pmsId || target.id);
    }

    setModal(null);
  };

  const headerLabel =
    viewMode === "month"
      ? format(selectedDate, "MMMM yyyy")
      : viewMode === "week"
        ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], isSameMonth(weekDays[0], weekDays[6]) ? "d, yyyy" : "MMM d, yyyy")}`
        : format(selectedDate, "EEEE, MMMM d, yyyy");

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Google Sans', Roboto, sans-serif", background: getIsLightMode() ? "#000000" : "#fff", color: "#3c4043", overflow: "hidden" }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="calendar-left-panel" style={{ width: 256, borderRight: "1px solid #e0e0e0", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
          <div style={{ padding: "12px 16px" }}>
            <button
              onClick={() => openNew(today, 9)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px 10px 14px", border: "none", borderRadius: 24, background: getIsLightMode() ? "#000000" : "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", cursor: "pointer", fontSize: 14, color: "#3c4043", fontWeight: 500 }}
            >
              <span style={{ fontSize: 22, color: "#1a73e8", fontWeight: 300, lineHeight: 1 }}>+</span>
              Create
            </button>
          </div>

          <MiniCalendar value={selectedDate} onChange={setSelectedDate} />

          <div style={{ padding: "8px 16px" }}>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search events…"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 20, padding: "7px 14px", fontSize: 13, outline: "none", color: "#3c4043" }}
            />
          </div>

          <div style={{ padding: "8px 16px", borderTop: "1px solid #e0e0e0", marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#70757a", marginBottom: 8, letterSpacing: "0.05em" }}>GOOGLE CALENDAR</div>
            <div style={{ fontSize: 12, color: "#3c4043", marginBottom: 8, lineHeight: 1.4 }}>{googleStatus}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={googleConnected ? disconnectGoogleCalendar : connectGoogleCalendar}
                disabled={!user?.id}
                style={{
                  border: "1px solid #dadce0",
                  borderRadius: 6,
                  background: googleConnected ? (getIsLightMode() ? "#000000" : "#fff") : "#1a73e8",
                  color: googleConnected ? "#3c4043" : "#fff",
                  padding: "8px 12px",
                  cursor: user?.id ? "pointer" : "not-allowed",
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: user?.id ? 1 : 0.7,
                }}
              >
                {googleConnected ? "Disconnect Google" : "Connect Google Calendar"}
              </button>
              {googleConnected && (
                <div style={{ fontSize: 12, color: "#70757a", padding: "4px 0" }}>
                  {formatLastSynced(googleLastSyncedAt)}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: "8px 16px", borderTop: "1px solid #e0e0e0", marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#70757a", marginBottom: 8, letterSpacing: "0.05em" }}>MY CALENDARS</div>
            {["Work", "Personal", "Meetings", "Deadlines"].map((cal, i) => (
              <div key={cal} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: EVENT_COLORS[i].bg }} />
                {cal}
              </div>
            ))}
          </div>

          <div style={{ padding: "8px 16px 16px", borderTop: "1px solid #e0e0e0", marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#70757a", marginBottom: 8, letterSpacing: "0.05em" }}>UPCOMING</div>
            {filteredEvents.slice(0, 5).map((evt) => (
              <div key={evt.id} onClick={() => openEdit(evt)} style={{ padding: "6px 0", borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: EVENT_COLORS[evt.colorIdx ?? 0].bg, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.title}</span>
                </div>
                <div style={{ fontSize: 11, color: "#70757a", marginTop: 2, paddingLeft: 14 }}>{evt.date} · {evt.startTime}–{evt.endTime}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <div className="calendar-header-bar" style={{ display: "flex", alignItems: "center", height: 56, padding: "0 16px", borderBottom: "1px solid #e0e0e0", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen((o) => !o)} style={{ background: "none", border: "none", cursor: "pointer", color: "#5f6368", fontSize: 20, padding: "6px", borderRadius: "50%", display: "flex" }}>☰</button>

          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1a73e8", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>📅</span>
            </div>
            <span style={{ fontSize: 18, color: "#3c4043", fontWeight: 400 }}>Calendar</span>
          </div>

          <button onClick={() => setSelectedDate(today)} style={{ marginLeft: 16, padding: "6px 14px", border: "1px solid #dadce0", borderRadius: 6, background: getIsLightMode() ? "#000000" : "#fff", cursor: "pointer", fontSize: 13, color: "#3c4043" }}>Today</button>
          <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", cursor: "pointer", color: "#5f6368", fontSize: 20, padding: "4px 6px" }}>‹</button>
          <button onClick={() => navigate(1)} style={{ background: "none", border: "none", cursor: "pointer", color: "#5f6368", fontSize: 20, padding: "4px 6px" }}>›</button>

          <h2 style={{ fontSize: 20, fontWeight: 400, color: "#3c4043", margin: 0, flex: 1 }}>{headerLabel}</h2>

          <div style={{ display: "flex", border: "1px solid #dadce0", borderRadius: 6, overflow: "hidden" }}>
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "6px 14px", border: "none", cursor: "pointer", fontSize: 13,
                  background: viewMode === mode ? "#e8f0fe" : (getIsLightMode() ? "#000000" : "#fff"),
                  color: viewMode === mode ? "#1a73e8" : "#3c4043",
                  fontWeight: viewMode === mode ? 600 : 400,
                  borderRight: mode !== "month" ? "1px solid #dadce0" : "none",
                }}
              >{mode.charAt(0).toUpperCase() + mode.slice(1)}</button>
            ))}
          </div>
        </div>

        {/* Calendar body */}
        <div className="calendar-main-grid" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {viewMode === "week" && (
            <WeekGrid weekDays={weekDays} events={filteredEvents} onSlotClick={openNew} onEventClick={openEdit} onEventResize={handleEventResize} today={today} />
          )}

          {viewMode === "day" && (
            <div style={{ display: "flex", flex: 1, overflow: "auto" }}>
              <div style={{ width: 56, flexShrink: 0 }}>
                <div style={{ height: 40 }} />
                {WORKING_HOURS.map((h) => (
                  <div key={h} style={{ height: 48, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 8 }}>
                    <span style={{ fontSize: 11, color: "#70757a", marginTop: -6 }}>{fmtHour(h)}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ height: 40, borderBottom: "1px solid #e0e0e0", display: "flex", alignItems: "center", paddingLeft: 16, gap: 8 }}>
                  <span style={{ fontSize: 13, color: isSameDay(selectedDate, today) ? "#1a73e8" : "#70757a" }}>{format(selectedDate, "EEE").toUpperCase()}</span>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: isSameDay(selectedDate, today) ? "#1a73e8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontWeight: isSameDay(selectedDate, today) ? 700 : 400, color: isSameDay(selectedDate, today) ? "#fff" : "#3c4043" }}>{format(selectedDate, "d")}</span>
                  </div>
                </div>
                <DayColumn
                  day={selectedDate}
                  events={filteredEvents.filter((e) => e.date === format(selectedDate, "yyyy-MM-dd"))}
                  onSlotClick={openNew}
                  onEventClick={openEdit}
                  onEventDrop={handleEventDrop}
                  onEventResize={handleEventResize}
                  isToday={isSameDay(selectedDate, today)}
                />
              </div>
            </div>
          )}

          {viewMode === "month" && (
            <MonthGrid monthDays={monthDays} selectedDate={selectedDate} events={filteredEvents} onDayClick={setSelectedDate} today={today} />
          )}
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <EventModal
          event={modal.event}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onSave={saveEvent}
          onDelete={deleteEvent}
          user={user}
        />
      )}
    </div>
  );
}