async function testAPIEndpoint() {
  console.log("=== Testing /api/available-tasks Endpoint ===\n");

  const employeeId = "d3995cf8-5d57-452a-a131-d7e1a107ce83"; // Durga Devi's ID
  const apiUrl = `http://localhost:5000/api/available-tasks?employeeId=${employeeId}`;

  console.log(`Testing: ${apiUrl}\n`);

  try {
    const response = await fetch(apiUrl);
    console.log(`Status: ${response.status}`);

    const data = await response.json();

    if (response.ok) {
      console.log(`✅ Success! Got ${data.length} tasks\n`);
      if (data.length > 0) {
        console.log("Sample tasks:");
        data.slice(0, 5).forEach((task: any, idx: number) => {
          console.log(`  ${idx + 1}. ${task.task_name}`);
          console.log(`     Project: ${task.projectName} (${task.projectCode})`);
        });
      } else {
        console.log("⚠️  No tasks returned (empty array)");
      }
    } else {
      console.log(`❌ Error: ${data.error || "Unknown error"}`);
      if (data.details) {
        console.log(`   Details: ${data.details}`);
      }
    }
  } catch (error) {
    console.error(`❌ Connection error: ${error}`);
    console.log("\nMake sure the server is running on port 5000");
  }
}

testAPIEndpoint();
