process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import { getDepartmentTasks } from "./server/pmsSupabase";

async function main() {
  try {
    // Test for E0001 (Sam)
    console.log("Testing getDepartmentTasks for E0001 (Sam)...");
    const tasks = await getDepartmentTasks("presales", "E0001", "employee");
    console.log(`\n✅ Found ${tasks.length} tasks for E0001 in my-tasks view`);
    
    if (tasks.length > 0) {
      console.log("\nSample tasks:");
      tasks.slice(0, 5).forEach(t => {
        console.log(`  - ${t.task_name} (ID: ${t.id})`);
      });
    } else {
      console.log("❌ No tasks found! This is the bug.");
    }

    // Also test department view (no empCode filter)
    console.log("\n\nTesting getDepartmentTasks for department view...");
    const deptTasks = await getDepartmentTasks("presales", null as any, "employee");
    console.log(`Found ${deptTasks.length} tasks in department view`);
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main();
