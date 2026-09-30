
import 'dotenv/config';
import { pmsPool, updateProjectProgress, getProjects } from '../server/pmsSupabase';

async function verifyPmsSync() {
    console.log("🚀 Starting PMS Sync Verification...");

    try {
        // 1. Fetch projects to find a target
        console.log("📋 Fetching projects...");
        const projects = await getProjects();

        if (projects.length === 0) {
            console.error("❌ No projects found to test.");
            return;
        }

        // Pick the first project
        const testProject = projects[0];
        console.log(`🎯 Selected Test Project: ${testProject.project_name} (ID: ${testProject.id}, Code: ${testProject.project_code})`);

        const originalProgress = testProject.progress_percentage || 0;
        console.log(`ℹ️ Original Progress: ${originalProgress}%`);

        // 2. Update Progress to a specific test value
        const testValue = 99;
        console.log(`Testing update to ${testValue}%...`);

        const success = await updateProjectProgress(testProject.id, testValue);

        if (!success) {
            console.error("❌ Link update failed according to function return.");
        } else {
            console.log("✅ Function returned success.");
        }

        // 3. Verify the update
        console.log("🕵️ Verifying update in database...");
        const updatedProjects = await getProjects();
        const verifiedProject = updatedProjects.find(p => p.id === testProject.id);

        if (verifiedProject?.progress_percentage === testValue) {
            console.log("✅ VERIFICATION SUCCESS: Project progress updated correctly in PMS!");
        } else {
            console.error(`❌ VERIFICATION FAILED: Expected ${testValue}%, got ${verifiedProject?.progress_percentage}%`);
        }

        // 4. Revert
        console.log(`Reverting progress back to ${originalProgress}%...`);
        await updateProjectProgress(testProject.id, originalProgress);
        console.log("✅ Revert complete.");

    } catch (error) {
        console.error("💥 Unexpected error:", error);
    } finally {
        await pmsPool.end();
    }
}

verifyPmsSync();
