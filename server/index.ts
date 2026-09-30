// ✅ MUST be first — loads .env before any other imports
// Triggering migration restart
import "dotenv/config";

// ✅ Bypass SSL certificate validation for development (fixes SELF_SIGNED_CERT_IN_CHAIN)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { initScheduler } from "./scheduler";

// ✅ NEW IMPORT (PMS Supabase Integration)
import { getProjects, getTasks } from "./pmsSupabase";

const app = express();
const httpServer = createServer(app);

/* -------------------------------------------------------------------------- */
/*                            HTTP MODULE AUGMENTATION                         */
/* -------------------------------------------------------------------------- */
declare module "http" {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

/* -------------------------------------------------------------------------- */
/*                                   MIDDLEWARE                                */
/* -------------------------------------------------------------------------- */
app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false, limit: '50mb' }));

/* -------------------------------------------------------------------------- */
/*                                   LOGGER                                    */
/* -------------------------------------------------------------------------- */
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/* -------------------------------------------------------------------------- */
/*                             API REQUEST LOGGER                               */
/* -------------------------------------------------------------------------- */
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  let capturedJsonResponse: unknown;

  const originalResJson = res.json.bind(res);
  res.json = (body: unknown) => {
    capturedJsonResponse = body;
    return originalResJson(body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

/* -------------------------------------------------------------------------- */
/*                               SERVER BOOTSTRAP                              */
/* -------------------------------------------------------------------------- */
(async () => {
  try {
    // Safely apply any missing database schema changes
    try {
      const { runMigrations } = await import("./migrate");
      await runMigrations();
    } catch (migErr) {
      console.error("❌ Migration failed:", migErr);
    }

    // Initialize Scheduler
    initScheduler();

    // Register API routes
    try {
      await registerRoutes(httpServer, app);
    } catch (err) {
      console.error("❌ Failed to register routes (DB might be down):", err);
      // We continue to let the server start so we can see logs, although API might be broken
    }

    // ========================= NEW PMS ROUTES =========================
    // PMS Projects
    app.get("/api/pms/projects", async (req, res) => {
      try {
        const projects = await getProjects();
        res.json(projects);
      } catch (error) {
        console.error("PMS projects error:", error);
        res.status(500).json({ error: "Failed to fetch PMS projects" });
      }
    });

    // PMS Tasks
    app.get("/api/pms/tasks", async (req, res) => {
      try {
        const tasks = await getTasks();
        res.json(tasks);
      } catch (error) {
        console.error("PMS tasks error:", error);
        res.status(500).json({ error: "Failed to fetch PMS tasks" });
      }
    });
    // ==================================================================

    // Global error handler (MUST be after routes)
    app.use(
      (err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";

        res.status(status).json({ message });
        log(`ERROR ${status}: ${message}`, "error");
      }
    );

    // Serve frontend
    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
      console.log("Static file serving setup complete.");
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
      console.log("Vite setup complete.");
    }

    // ✅ WINDOWS + RENDER + REPLIT SAFE
    const port = Number(process.env.PORT) || 5000;

    httpServer.listen(port, "0.0.0.0", () => {
      log(`serving on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
})();
