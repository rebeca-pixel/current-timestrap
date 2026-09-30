
import "dotenv/config";
import express from "express";
import { createServer } from "http";
// Import PMS Supabase exactly as in server/index.ts
import { getProjects, getTasks } from "./server/pmsSupabase";
import { registerRoutes } from "./server/routes";

const app = express();
const httpServer = createServer(app);

// Mock logging
console.log = (msg, ...args) => process.stdout.write(msg + " " + args.join(" ") + "\n");
console.error = (msg, ...args) => process.stderr.write(msg + " " + args.join(" ") + "\n");

(async () => {
    console.log("Starting reproduction script with PMS import...");
    try {
        console.log("Calling registerRoutes...");
        // registerRoutes now catches its own errors, so this should not throw even if DB is down
        await registerRoutes(httpServer, app);
        console.log("registerRoutes completed successfully.");
    } catch (error) {
        console.error("registerRoutes FAILED with:", error);
    } finally {
        // Wait a bit to ensure logs are flushed and connection pools have time to settle/timeout
        setTimeout(() => process.exit(0), 1000);
    }
})();
