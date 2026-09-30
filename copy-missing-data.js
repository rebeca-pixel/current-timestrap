"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pg_1 = require("pg");
// Note: Pool is already destructured from pg
// Source database connection (your original database)
const sourcePool = new pg_1.Pool({
    connectionString: process.env.SOURCE_DATABASE_URL || process.env.PMS_DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});
// Target database connection (Supabase)
const targetPool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});
const results = [];
async function copyData() {
    try {
        console.log("🚀 Starting data migration to Supabase...\n");
        // ==================== ORGANISATIONS ====================
        await migrateTable("organisations", `SELECT id, name, gst_id, main_address, branch_address, created_at FROM organisations`, `INSERT INTO organisations (id, name, gst_id, main_address, branch_address, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`);
        // ==================== DEPARTMENTS ====================
        await migrateTable("departments", `SELECT id, name, code, leader, parent_department_id, organisation_id, created_at FROM departments`, `INSERT INTO departments (id, name, code, leader, parent_department_id, organisation_id, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`);
        // ==================== GROUPS ====================
        await migrateTable("groups", `SELECT id, name, parent_department, group_leader, organisation_id, created_at FROM groups`, `INSERT INTO groups (id, name, parent_department, group_leader, organisation_id, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`);
        // ==================== EMPLOYEES ====================
        await migrateTable("employees", `SELECT id, employee_code, name, email, password, role, department, group_name, line_manager_id, organisation_id, is_active, created_at FROM employees`, `INSERT INTO employees (id, employee_code, name, email, password, role, department, group_name, line_manager_id, organisation_id, is_active, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING`);
        // ==================== MANAGERS ====================
        await migrateTable("managers", `SELECT id, name, employee_code, email, department FROM managers`, `INSERT INTO managers (id, name, employee_code, email, department) 
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`);
        // ==================== PROJECTS ====================
        await migrateTable("projects", `SELECT project_code, project_name, description, status, start_date, end_date FROM projects`, `INSERT INTO projects (project_code, project_name, description, status, start_date, end_date) 
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (project_code) DO NOTHING`);
        // ==================== TASKS ====================
        await migrateTable("tasks", `SELECT id, project_code, task_name, created_at FROM tasks`, `INSERT INTO tasks (id, project_code, task_name, created_at) 
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`);
        // ==================== SUBTASKS ====================
        await migrateTable("subtasks", `SELECT id, task_id, subtask_name, created_at FROM subtasks`, `INSERT INTO subtasks (id, task_id, subtask_name, created_at) 
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`);
        // ==================== TIME ENTRIES ====================
        await migrateTable("time_entries", `SELECT id, employee_id, employee_code, employee_name, date, project_name, task_description, 
              problem_and_issues, quantify, achievements, scope_of_improvements, tools_used, 
              start_time, end_time, total_hours, percentage_complete, status, approved_by, 
              approved_at, manager_approved_by, manager_approved_at, rejection_reason, 
              approval_comment, submitted_at FROM time_entries`, `INSERT INTO time_entries (id, employee_id, employee_code, employee_name, date, project_name, 
              task_description, problem_and_issues, quantify, achievements, scope_of_improvements, 
              tools_used, start_time, end_time, total_hours, percentage_complete, status, approved_by, 
              approved_at, manager_approved_by, manager_approved_at, rejection_reason, 
              approval_comment, submitted_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24) 
       ON CONFLICT (id) DO NOTHING`);
        // ==================== PRINT SUMMARY ====================
        printSummary();
    }
    catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }
    finally {
        await sourcePool.end();
        await targetPool.end();
    }
}
async function migrateTable(tableName, selectQuery, insertQuery) {
    try {
        console.log(`\n📋 Migrating table: ${tableName}`);
        // Get source data
        const sourceResult = await sourcePool.query(selectQuery);
        const sourceCount = sourceResult.rows.length;
        console.log(`   ✅ Found ${sourceCount} records in source database`);
        if (sourceCount === 0) {
            results.push({
                table: tableName,
                sourceCount: 0,
                targetBeforeCount: 0,
                targetAfterCount: 0,
                inserted: 0,
                errors: [],
            });
            console.log(`   ⚠️  No data to migrate`);
            return;
        }
        // Get count before insertion
        const beforeCount = await getTargetCount(tableName);
        console.log(`   📊 Target table had ${beforeCount} records before migration`);
        // Insert data
        let inserted = 0;
        const errors = [];
        for (const row of sourceResult.rows) {
            try {
                const values = Object.values(row);
                const params = values.map((_, i) => `$${i + 1}`).join(", ");
                const query = insertQuery.replace("($1, $2, ...)", `(${params})`);
                await targetPool.query(insertQuery, values);
                inserted++;
            }
            catch (err) {
                errors.push(`Row error: ${err.message}`);
            }
        }
        // Get count after insertion
        const afterCount = await getTargetCount(tableName);
        const newlyInserted = afterCount - beforeCount;
        console.log(`   ✨ Successfully inserted ${newlyInserted} records`);
        if (newlyInserted < inserted) {
            console.log(`   ⚠️  ${inserted - newlyInserted} records were duplicates or had conflicts`);
        }
        results.push({
            table: tableName,
            sourceCount,
            targetBeforeCount: beforeCount,
            targetAfterCount: afterCount,
            inserted: newlyInserted,
            errors,
        });
    }
    catch (error) {
        console.error(`   ❌ Error migrating ${tableName}:`, error.message);
        results.push({
            table: tableName,
            sourceCount: 0,
            targetBeforeCount: 0,
            targetAfterCount: 0,
            inserted: 0,
            errors: [error.message],
        });
    }
}
async function getTargetCount(tableName) {
    try {
        const result = await targetPool.query(`SELECT COUNT(*) FROM ${tableName}`);
        return parseInt(result.rows[0].count, 10);
    }
    catch {
        return 0;
    }
}
function printSummary() {
    console.log("\n");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                    📊 MIGRATION SUMMARY");
    console.log("═══════════════════════════════════════════════════════════════\n");
    let totalSourceRecords = 0;
    let totalInserted = 0;
    let totalErrors = 0;
    results.forEach((result) => {
        totalSourceRecords += result.sourceCount;
        totalInserted += result.inserted;
        totalErrors += result.errors.length;
        console.log(`📌 ${result.table.toUpperCase()}`);
        console.log(`   Source Records:     ${result.sourceCount}`);
        console.log(`   Target Before:      ${result.targetBeforeCount}`);
        console.log(`   Target After:       ${result.targetAfterCount}`);
        console.log(`   Newly Inserted:     ${result.inserted}`);
        if (result.errors.length > 0) {
            console.log(`   ❌ Errors:          ${result.errors.length}`);
        }
        console.log();
    });
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`✅ Total Source Records:     ${totalSourceRecords}`);
    console.log(`✅ Total Records Inserted:   ${totalInserted}`);
    console.log(`❌ Total Errors:             ${totalErrors}`);
    console.log("═══════════════════════════════════════════════════════════════\n");
    if (totalErrors === 0) {
        console.log("🎉 Migration completed successfully!\n");
    }
    else {
        console.log("⚠️  Migration completed with some errors. Check the logs above.\n");
    }
}
copyData();
