import type { Express, Request, Response } from "express";
import { pmsPool } from "./pmsSupabase";
import { resolvePmsUserId } from "./Pmscalendarevents";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface GoogleCalendarEventInput {
  id: string;
  title: string;
  project: string;
  date: string;
  startTime: string;
  endTime: string;
  colorIdx: number;
  source?: "plan" | "manual" | "google";
  pmsId?: string;
  googleEventId?: string;
}

interface SyncRequestBody {
  action: "sync";
  accessToken: string;
  refreshToken?: string;
  events: GoogleCalendarEventInput[];
}

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID;
}

function getGoogleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET;
}

function getGoogleRedirectUri(req: Request) {
  return process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/google/auth/callback`;
}

function buildGoogleAuthUrl(req: Request) {
  const clientId = getGoogleClientId();
  const redirectUri = getGoogleRedirectUri(req);
  const employeeCode = typeof req.query.employeeCode === "string" ? req.query.employeeCode : "";

  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured.");
  }

  // Include the employeeCode in the state payload so we know who is connecting
  const statePayload = JSON.stringify({
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    employeeCode,
  });
  const state = Buffer.from(statePayload).toString("base64url");
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
  };
}

async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to exchange Google code for tokens.");
  }

  const data = (await response.json()) as GoogleTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to refresh Google access token.");
  }

  const data = (await response.json()) as GoogleTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
}

function toGoogleDateTime(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid event time: ${date} ${time}`);
  }
  return parsed.toISOString();
}

function buildGoogleEventPayload(event: GoogleCalendarEventInput) {
  const startDateTime = toGoogleDateTime(event.date, event.startTime);
  const endDateTime = toGoogleDateTime(event.date, event.endTime);

  return {
    summary: event.title,
    description: event.project || "Scheduled via Time Strap",
    status: "confirmed", // Ensure event is not cancelled (fixes deleted events reappearing)
    start: {
      dateTime: startDateTime,
      timeZone: "UTC",
    },
    end: {
      dateTime: endDateTime,
      timeZone: "UTC",
    },
    extendedProperties: {
      private: {
        timestrapEventId: event.id,
        timestrapSource: event.source || "manual",
      },
    },
  };
}

function extractGoogleErrorMessage(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "Google Calendar request failed.";
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string; status?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
    if (parsed?.error?.status) {
      return parsed.error.status;
    }
  } catch {
    // Ignore parse failures and fall back to the raw text.
  }

  return trimmed;
}

async function googleCalendarRequest(path: string, accessToken: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = extractGoogleErrorMessage(await response.text());
    const errorWithStatus = `${message || `Google Calendar request failed: ${method} ${path}`} (Status: ${response.status})`;
    throw new Error(errorWithStatus);
  }

  return response.json() as Promise<any>;
}

function normalizeGoogleCalendarError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid authentication credentials") || normalized.includes("invalid credentials")) {
    return { status: 401, error: "Google access token is invalid or expired. Reconnect Google Calendar and try again." };
  }

  if (normalized.includes("insufficient authentication scopes")) {
    return { status: 403, error: "Google Calendar scope is missing. Reconnect Google Calendar and approve the Calendar permission." };
  }

  if (normalized.includes("api has not been used") || normalized.includes("calendar api has not been used") || normalized.includes("api not enabled") || normalized.includes("disabled")) {
    return { status: 503, error: "Google Calendar API is not enabled for this project. Enable the Google Calendar API in Google Cloud Console and retry." };
  }

  if (normalized.includes("invalid_grant") || normalized.includes("refresh token")) {
    return { status: 401, error: "Google refresh token is invalid. Disconnect and reconnect Google Calendar." };
  }

  return { status: 500, error: message || "Unable to sync Google Calendar." };
}

function buildCallbackPage(tokenPayload: unknown) {
  const payload = JSON.stringify(tokenPayload);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Google Calendar Connection</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
      .card { padding: 24px 28px; border-radius: 16px; background: #ffffff; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.15); max-width: 440px; text-align: center; }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 20px; color: #475569; line-height: 1.5; }
      .badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: #e8f0fe; color: #1a73e8; padding: 8px 14px; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">Google Calendar</div>
      <h1>Connection complete</h1>
      <p>You can close this window and return to Time Strap. The calendar connection is being saved.</p>
    </div>
    <script>
      window.opener?.postMessage(${payload}, window.location.origin);
      window.close();
    </script>
  </body>
</html>`;
}

export function registerGoogleCalendarRoutes(app: Express) {
  app.get("/api/google/auth/url", async (req: Request, res: Response) => {
    try {
      const result = buildGoogleAuthUrl(req);
      res.json({ url: result.url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create Google auth URL.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/google/auth/refresh", async (req: Request, res: Response) => {
    try {
      const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : null;
      if (!refreshToken) {
        return res.status(400).json({ error: "Refresh token is required." });
      }

      const tokens = await refreshGoogleAccessToken(refreshToken);
      res.json(tokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh token.";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/google/auth/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const errorParam = typeof req.query.error === "string" ? req.query.error : null;

    console.log("[google-callback] Received callback. code present:", !!code, "error:", errorParam);

    if (errorParam) {
      return res.status(400).send(`Google denied access: ${errorParam}`);
    }

    if (!code) {
      return res.status(400).send("Missing Google authorization code.");
    }

    try {
      const redirectUri = getGoogleRedirectUri(req);
      console.log("[google-callback] Using redirectUri:", redirectUri);
      const tokens = await exchangeCodeForTokens(code, redirectUri);
      console.log("[google-callback] Tokens obtained. accessToken present:", !!tokens.accessToken, "refreshToken present:", !!tokens.refreshToken);
      
      let employeeCode = "";
      const stateStr = typeof req.query.state === "string" ? req.query.state : "";
      if (stateStr) {
        try {
          const decoded = Buffer.from(stateStr, "base64url").toString("utf8");
          const parsed = JSON.parse(decoded);
          employeeCode = parsed.employeeCode || "";
        } catch(e) {
          console.error("[google-callback] Failed to decode state:", e);
        }
      }

      console.log("[google-callback] Decoded employeeCode:", employeeCode || "(none)");

      if (employeeCode) {
        const pmsUserId = await resolvePmsUserId(employeeCode);
        console.log("[google-callback] Resolved pmsUserId:", pmsUserId || "(not found)");

        if (pmsUserId) {
          // Fetch user info from Google to get the email
          const userinfoResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokens.accessToken}` }
          });
          let googleEmail = "unknown@google.com";
          if (userinfoResp.ok) {
            const userinfo = await userinfoResp.json();
            googleEmail = userinfo.email || googleEmail;
          } else {
            console.error("[google-callback] userinfo fetch failed:", userinfoResp.status, await userinfoResp.text());
          }

          console.log("[google-callback] Google email:", googleEmail, " — saving to PMS DB...");

          const expiryDate = new Date(tokens.expiresAt).toISOString();

          await pmsPool.query(`
            INSERT INTO google_calendar_accounts (
              user_id, google_email, access_token, refresh_token, token_expiry, connected_at
            ) VALUES (
              $1, $2, $3, $4, $5, NOW()
            ) ON CONFLICT (user_id) DO UPDATE SET
              google_email = EXCLUDED.google_email,
              access_token = EXCLUDED.access_token,
              refresh_token = COALESCE(EXCLUDED.refresh_token, google_calendar_accounts.refresh_token),
              token_expiry = EXCLUDED.token_expiry,
              connected_at = NOW()
          `, [pmsUserId, googleEmail, tokens.accessToken, tokens.refreshToken, expiryDate]);

          console.log("[google-callback] ✅ Saved to PMS DB successfully for userId:", pmsUserId);
        } else {
          console.warn("[google-callback] ⚠️ Could not resolve pmsUserId for employeeCode:", employeeCode, "— tokens NOT saved to PMS.");
        }
      } else {
        console.warn("[google-callback] ⚠️ No employeeCode in state — tokens NOT saved to PMS DB.");
      }

      res.send(buildCallbackPage({
        type: "GOOGLE_CALENDAR_CONNECTED",
        tokens,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to complete Google authentication.";
      console.error("[google-callback] ❌ Error:", message);
      res.status(500).send(message);
    }
  });

  app.post("/api/google/calendar/events", async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<SyncRequestBody>;
      const accessToken = typeof body.accessToken === "string" ? body.accessToken : null;
      const refreshToken = typeof body.refreshToken === "string" && body.refreshToken.trim() ? body.refreshToken.trim() : null;
      const events = Array.isArray(body.events) ? body.events : [];

      if (!accessToken) {
        return res.status(400).json({ error: "Access token is required." });
      }

      if (body.action !== "sync") {
        return res.status(400).json({ error: "Unsupported Google Calendar action." });
      }

      let effectiveAccessToken: string;
      try {
        effectiveAccessToken = refreshToken
          ? (await refreshGoogleAccessToken(refreshToken)).accessToken
          : accessToken;
      } catch (refreshError) {
        const refreshErrorMsg = refreshError instanceof Error ? refreshError.message : "Unknown error";
        if (refreshErrorMsg.includes("invalid_grant")) {
          console.error("[google-calendar] Invalid or expired refresh token. User needs to re-authenticate.");
          return res.status(401).json({
            error: "Your Google Calendar connection has expired. Please disconnect and reconnect your Google Calendar account.",
            code: "AUTH_EXPIRED"
          });
        }
        throw refreshError;
      }

      const synced = [] as Array<{ id: string; googleEventId: string }>;
      const failed = [] as Array<{ id: string; error: string }>;

      for (const event of events) {
        try {
          const payload = buildGoogleEventPayload(event);
          let needsToCreate = !event.googleEventId; // Flag to track if we need to create

          if (event.googleEventId) {
            try {
              // Try to update existing event
              console.log(`[google-calendar] 🔄 PATCH request for ${event.id}: googleEventId=${event.googleEventId}`);
              console.log(`[google-calendar] PATCH payload:`, JSON.stringify(payload, null, 2));

              const updated = await googleCalendarRequest(
                `/calendars/primary/events/${encodeURIComponent(event.googleEventId)}`,
                effectiveAccessToken,
                "PATCH",
                payload
              );

              console.log(`[google-calendar] ✅ PATCH response for ${event.id}:`, JSON.stringify(updated, null, 2));
              synced.push({ id: event.id, googleEventId: updated.id });
              console.log(`[google-calendar] ✅ Updated event ${event.id} (googleEventId: ${event.googleEventId}) -> ${updated.id}`);
              needsToCreate = false; // Successfully patched, don't create
            } catch (error) {
              // If event not found (404), treat it as deleted and create as new
              const errorMsg = error instanceof Error ? error.message : "";
              console.log(`[google-calendar] ❌ PATCH error for ${event.id}: ${errorMsg}`);
              if (errorMsg.includes("404") || errorMsg.toLowerCase().includes("not found")) {
                console.log(`[google-calendar] ⚠️ Event ${event.id} was deleted from Google Calendar (old googleEventId: ${event.googleEventId}). Will recreate as new event.`);
                needsToCreate = true; // PATCH failed with 404, so create as new
              } else {
                // Re-throw other errors
                console.error(`[google-calendar] PATCH failed with unexpected error:`, error);
                throw error;
              }
            }
          }

          // Create as new event (either no googleEventId or PATCH failed with 404)
          if (needsToCreate) {
            try {
              console.log(`[google-calendar] 📝 Creating new event for ${event.id}...`);
              console.log(`[google-calendar] POST payload for ${event.id}:`, JSON.stringify(payload, null, 2));
              const created = await googleCalendarRequest("/calendars/primary/events", effectiveAccessToken, "POST", payload);
              console.log(`[google-calendar] POST response for ${event.id}:`, JSON.stringify(created, null, 2));

              if (!created || !created.id) {
                console.error(`[google-calendar] POST response missing event id for ${event.id}. Response:`, created);
                failed.push({ id: event.id, error: "Google Calendar returned empty response" });
              } else {
                synced.push({ id: event.id, googleEventId: created.id });
                console.log(`[google-calendar] ✅ Created new event ${event.id} (new googleEventId: ${created.id})`);
              }
            } catch (createError) {
              const createErrorMsg = createError instanceof Error ? createError.message : "Unknown error";
              console.error(`[google-calendar] ❌ Failed to create event ${event.id}: ${createErrorMsg}`);
              failed.push({ id: event.id, error: createErrorMsg });
            }
          }
        } catch (eventError) {
          const eventErrorMsg = eventError instanceof Error ? eventError.message : "Unknown error";
          console.error(`[google-calendar] Error processing event ${event.id}: ${eventErrorMsg}`);
          failed.push({ id: event.id, error: eventErrorMsg });
        }
      }

      console.log(`[google-calendar] Sync complete: ${synced.length} succeeded, ${failed.length} failed`);
      if (failed.length > 0) {
        console.error(`[google-calendar] Failed events:`, failed);
      }

      res.json({ success: true, synced, failed });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync Google Calendar.";
      const normalized = normalizeGoogleCalendarError(message);
      console.error("[google-calendar] sync failed", normalized);
      res.status(normalized.status).json({ error: normalized.error });
    }
  });
}
