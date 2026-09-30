import "dotenv/config";
// Bypass TLS authorization warning
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { runCoordinator } from "./server/rag/coordinator";

async function main() {
  console.log("=== STARTING LOCAL CHAT RUNNER ===");
  await runCoordinator({
    message: "show submitted and not submitted timesheets for Durga Devi E0048 in june 2026",
    userContext: {
      employeeId: "d3995cf8-5d57-452a-a131-d7e1a107ce83", // Durga Devi's ID
      employeeCode: "E0001", // Admin
      role: "admin",
      department: "Software",
      employeeName: "Samprakash",
      baseUrl: "http://localhost:5003"
    },
    history: [],
    onChunk: (chunk) => {
      if (chunk.type === "text") {
        process.stdout.write(chunk.content);
      } else if (chunk.type === "action_executed") {
        console.log(`\n[Action Executed: ${chunk.action} - ${chunk.status}]`);
      } else if (chunk.type === "action_start") {
        console.log(`\n[Action Starting: ${chunk.action}]`);
      }
    }
  });
  console.log("\n=== CHAT RUNNER COMPLETE ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Runner failed:", err);
  process.exit(1);
});
