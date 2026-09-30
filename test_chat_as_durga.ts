process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import { runRAGChat } from "./server/rag/ragChat";

async function main() {
  const message = "What are my assigned tasks?";
  const history = [];
  const userContext = {
    employeeId: "d3995cf8-5d57-452a-a131-d7e1a107ce83",
    employeeCode: "E0048",
    role: "employee",
    department: "Software"
  };

  console.log(`Asking RAG Chat as Durga Devi (E0048): "${message}"\n`);
  console.log("=== CHAT RESPONSE ===");

  await runRAGChat(
    message,
    history,
    userContext,
    (chunk) => {
      if (chunk.type === "text" && chunk.content) {
        process.stdout.write(chunk.content);
      } else if (chunk.type === "interactive_daily_plan") {
        console.log("\n[Interactive daily plan component received]");
      } else if (chunk.type === "action_executed") {
        console.log(`\n[Action Executed: ${chunk.action} - Status: ${chunk.status}]`);
      }
    }
  );

  console.log("\n=====================");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nChat run error:", err);
    process.exit(1);
  });
