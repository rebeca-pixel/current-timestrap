// client/src/lib/googleCalendar.ts
//
// Google Calendar connection is now owned entirely by PMS. This module
// no longer stores tokens in localStorage or pushes events to Google
// directly — it just reads read-only status from Timestrap's own
// /api/google/status endpoint (which reads PMS's DB directly) and links
// out to PMS's server to start/manage the actual OAuth connection, since
// only PMS's server holds the Google OAuth client secret.

export interface GoogleStatus {
  connected: boolean;
  googleEmail?: string;
  lastSyncedAt?: string | null;
}

export async function fetchGoogleStatus(employeeCode?: string): Promise<GoogleStatus> {
  if (!employeeCode) return { connected: false };

  const response = await fetch(`/api/google/status?employeeCode=${encodeURIComponent(employeeCode)}`);
  if (!response.ok) {
    throw new Error("Unable to fetch Google Calendar status.");
  }
  return (await response.json()) as GoogleStatus;
}

export async function disconnectGoogle(employeeCode?: string): Promise<void> {
  if (!employeeCode) return;

  const response = await fetch("/api/google/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeCode }),
  });

  if (!response.ok) {
    throw new Error("Unable to disconnect Google Calendar.");
  }
}
