import "dotenv/config";
import { runRAGChat } from "./server/rag/ragChat";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function testChat(userCode: string, userRole: string, userId: string, message: string) {
  console.log(`\n========================================`);
  console.log(`TESTING AS: Code=${userCode}, Role=${userRole}, ID=${userId}`);
  console.log(`MESSAGE: "${message}"`);
  console.log(`========================================`);

  const history: any[] = [];
  const userContext = {
    employeeId: userId,
    employeeCode: userCode,
    role: userRole,
    department: userRole === "hr" ? "HR & Admin" : "IT Support",
    employeeName: userRole === "hr" ? "Pushpa" : "Naveen",
    baseUrl: "http://localhost:5003"
  };

  await runRAGChat(
    message,
    history,
    userContext,
    (chunk) => {
      if (chunk.type === "text" && chunk.content) {
        process.stdout.write(chunk.content);
      } else if (chunk.type === "action_executed") {
        console.log(`\n[Action: ${chunk.action} - Status: ${chunk.status}]`);
      }
    }
  );
  console.log("\n========================================\n");
}

async function main() {
  // Test as Pushpa (HR) - she should succeed
  await testChat(
    "E0049",
    "hr",
    "e00cfbb1-d47f-453c-8c13-0f38ed743099",
    "Mohan's code is E0041. Give me his timesheet report for may 2026 in excel"
  );

  // Test as S.Naveen Kumar (Employee) - he should get access denied
  await testChat(
    "E0053",
    "employee",
    "2746b875-444f-4f74-94a6-16c98808c102",
    "Mohan's code is E0041. Give me his timesheet report for may 2026 in excel"
  );

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
