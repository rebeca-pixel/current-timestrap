/**
 * PHASE 7 — KNOWLEDGE BRAIN
 * Company Policy Documents Ingestion Script
 *
 * HOW TO RUN:
 *   npx tsx server/ingest_company_policies.ts
 *
 * WHAT IT DOES:
 *   - Chunks all 3 company policy documents into small pieces
 *   - Generates OpenAI embeddings for each chunk
 *   - Inserts into document_embeddings table
 *   - Skips duplicates (safe to run multiple times)
 *
 * PLACE THIS FILE AT: server/ingest_company_policies.ts
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { pool } from "./db";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ─── Document chunks ──────────────────────────────────────────────────────────

const documents = [

  // ── DOCUMENT 1: Government Holidays 2026 ──────────────────
  {
    source: "government_holidays_2026",
    data_type: "company_policy",
    role_access: ["employee", "manager", "admin", "hr"],
    chunks: [
      `Government Holidays 2026 - CTI (Consolidated Technics India).
The following 11 government holidays are observed in 2026:
1. New Year - January 1, 2026 - Thursday
2. Pongal - January 15, 2026 - Thursday
3. Thiruvalluvar Day - January 16, 2026 - Friday
4. Republic Day - January 26, 2026 - Monday
5. May Day - May 1, 2026 - Friday
6. Independence Day - August 15, 2026 - Saturday
7. Ganesh Chaturthi - September 14, 2026 - Monday
8. Gandhi Jayanti - October 2, 2026 - Friday
9. Ayudha Pooja - October 19, 2026 - Monday
10. Diwali - November 7, 2026 - Saturday
11. Christmas - December 25, 2026 - Friday
Employees working on any of these holidays receive double salary compensation.`,
    ],
  },

  // ── DOCUMENT 2: Leave Policy 2024 ─────────────────────────
  {
    source: "leave_policy_2024",
    data_type: "company_policy",
    role_access: ["employee", "manager", "admin", "hr"],
    chunks: [
      `Leave Policy - Concept Trunk Interiors 2024

PRIVILEGE LEAVE:
- Employees are entitled to 10 days of privilege leave per calendar year.
- Privilege leave commences only after completion of the probation period.
- Privilege leave can only be availed after obtaining confirmation from management.
- Employees may utilize up to 3 days of privilege leave at a stretch, subject to management approval.
- Request for privilege leave must be submitted at least 1 week in advance for planned leave.
- Request for privilege leave must be submitted at least 1 day in advance for unplanned leave.
- Requests must be submitted via email (hr@ctint.in) or through the leave management system.
- Any unused privilege leave cannot be carried forward to the next year.`,

      `Leave Policy - Sick Leave - Concept Trunk Interiors 2024

SICK LEAVE:
- Employees are granted 5 days of sick leave per calendar year.
- Sick leave can be utilized for personal illness or medical appointments.
- Employees must inform management via email (hr@ctint.in) or through the leave management system as soon as possible in case of illness.
- A doctor's certificate from a reputed hospital is required if absent for more than 2 consecutive days.`,

      `Leave Policy - General Guidelines - Concept Trunk Interiors 2024

GOVERNMENT HOLIDAYS:
- Employees will be provided with government holidays as per Tamil Nadu regulations.
- The list of government holidays is communicated at the beginning of each calendar year.

GENERAL GUIDELINES:
- All leave requests are subject to approval by management.
- In case of emergency or unforeseen circumstances, employees should notify immediately.
- Unauthorized absence from work may result in loss of pay.
- Special leave beyond specified allowances may be granted under exceptional circumstances at management's discretion.
- All leave requests, even those conveyed verbally, must be officially communicated through email or the leave management system for validation.
- This leave policy is subject to periodic review and may be amended by the company.

HR Contact: hr@ctint.in`,
    ],
  },

  // ── DOCUMENT 3: Work Hours & Attendance Policy 2025 ───────
  {
    source: "attendance_policy_2025",
    data_type: "company_policy",
    role_access: ["employee", "manager", "admin", "hr"],
    chunks: [
      `Employee Work Hours & Attendance Policy 2025 - Concept Trunk Interiors
Effective: April 2025
Applies to: All employees who report to the office. Does NOT apply to operational roles or work-from-home employees.

SECTION 1: OFFICE TIMINGS & BUFFER TIME

Official Shifts:
- Shift 1: 09:30 AM – 06:30 PM
- Shift 2: 10:00 AM – 07:00 PM
- Shift 3: 11:00 AM – 08:00 PM

Each shift includes a one-hour break which employees can take at their discretion.

Buffer Time: Employees must report at their designated shift start time, with a buffer period of 20 minutes.
Example: Employees in the 10:00 AM – 7:00 PM shift must arrive by 10:00 AM; excuse will be given till 10:20 AM.

Repeated late arrivals will result in salary deductions (see Section 3).`,

      `Attendance Policy 2025 - Section 2: Attendance System

SECTION 2: ATTENDANCE SYSTEM
- Biometric attendance is mandatory.
- Failure to record attendance will result in an absent mark unless manually verified by HR or the reporting manager.
- Early departures are only allowed with prior approval from the reporting manager and a copy to HR via email.
- Verbal approvals are NOT considered valid.
- Employees arriving after 4 hours from their shift start time will be marked as half-day.

SECTION 2A: 100% ATTENDANCE REWARD
- Employees who arrive before their shift start time AND leave after their shift end time every working day — without taking ANY leave (including sick leave and paid leave) — will receive a 5% bonus on their monthly salary.
- This applies only to employees with a salary not exceeding ₹25,000 per month.
- Even arriving at 10:01 AM for a 10:00 AM shift disqualifies the employee from this bonus.`,

      `Attendance Policy 2025 - Section 3: Late Arrival & Salary Deductions

SECTION 3: LATE ARRIVAL POLICY & SALARY DEDUCTIONS
- Employees are allowed up to 3 late arrivals per month without any salary deduction.
- From the 4th to the 10th late arrival: salary deduction is based on hourly wage loss.
- If late arrivals exceed 10 times in a month: a half-day salary will be deducted for EACH late arrival from the very first instance, retroactively applied to all late arrivals of that month.

Example: If an employee is late on April 2, 5, 8, 12, 15, 18, 20, 22, 25, 28 (10 times = hourly deduction), but also late on April 30 (11th instance), then ALL 11 late arrivals are recalculated as half-day deductions.

Salary deductions are rounded up to the next full hour:
- Arriving at 10:25 AM for a 10:00 AM shift = 1 hour deduction
- Arriving at 11:05 AM for a 10:00 AM shift = 2 hour deduction

Arriving after 5 hours from shift start time = half-day mark.
Leaving office without prior approval during work hours = absent mark (except emergencies approved by manager and HR).`,

      `Attendance Policy 2025 - Sections 4, 5, 6: Half-Day, Overtime, Compliance

SECTION 4: HALF-DAY POLICY
A half-day will be applied if:
- Employee arrives after 4 hours from their shift start time (e.g., after 1:00 PM for the 9:30 AM – 6:30 PM shift).
- Salary is calculated based on hours worked if the employee has not completed at least 5 hours (minimum for half-day salary).

SECTION 5: OVERTIME POLICY
- Employees are NOT encouraged to work beyond shift end times unless required for their own pending work.
- If requested by reporting manager, overtime is calculated only after 9 hours of work from punch-in time.
- Overtime must be approved by the reporting manager via email or Cliq.
- Overtime is applicable only if an employee works MORE than 1 hour beyond their scheduled shift end time at the office.
  Example: For an 8:00 PM shift end, overtime counts only if employee works past 9:00 PM at office.
- Work done until 8:59 PM will NOT be considered overtime.
- If additional work is needed before or after office hours, employees are advised to work from home where feasible.

SECTION 6: COMPLIANCE & ENFORCEMENT
- Employees must adhere to these policies to maintain discipline and professionalism.
- Any disputes regarding attendance, salary deductions, or overtime must be addressed with HR.
- HR Contact: hr@ctint.in`,
    ],
  },
];

// ─── Ingestion function ───────────────────────────────────────────────────────

async function ingestDocuments() {
  console.log("🚀 Starting Phase 7 Knowledge Brain ingestion...\n");

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const doc of documents) {
    console.log(`📄 Processing: ${doc.source} (${doc.chunks.length} chunks)`);

    for (let i = 0; i < doc.chunks.length; i++) {
      const chunk = doc.chunks[i];
      const chunkId = `${doc.source}_chunk_${i + 1}`;

      // Check if already exists
      const existing = await pool.query(
        `SELECT id FROM document_embeddings 
         WHERE metadata->>'source_db' = $1 
         AND metadata->>'chunk_id' = $2`,
        [doc.source, chunkId]
      );

      if (existing.rows.length > 0) {
        console.log(`  ⏭️  Chunk ${i + 1} already exists — skipping`);
        totalSkipped++;
        continue;
      }

      // Generate embedding
      const embeddingRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk,
      });

      const embedding = embeddingRes.data[0].embedding;
      const vectorStr = `[${embedding.join(",")}]`;

      const metadata = {
        source_db: doc.source,
        data_type: doc.data_type,
        chunk_id: chunkId,
        chunk_index: i + 1,
        total_chunks: doc.chunks.length,
        role_access: doc.role_access,
        ingested_at: new Date().toISOString(),
      };

      await pool.query(
        `INSERT INTO document_embeddings (id, content, embedding, metadata, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2::vector, $3, NOW(), NOW())`,
        [chunk, vectorStr, JSON.stringify(metadata)]
      );

      console.log(`  ✅ Chunk ${i + 1}/${doc.chunks.length} inserted`);
      totalInserted++;

      // Small delay to avoid OpenAI rate limits
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log("");
  }

  console.log("═══════════════════════════════════════");
  console.log(`✅ Ingestion complete!`);
  console.log(`   Inserted : ${totalInserted} chunks`);
  console.log(`   Skipped  : ${totalSkipped} chunks (already existed)`);
  console.log(`   Total    : ${totalInserted + totalSkipped} chunks`);
  console.log("═══════════════════════════════════════\n");

  // Verify
  const verify = await pool.query(
    `SELECT metadata->>'source_db' as source, COUNT(*) as chunks
     FROM document_embeddings
     WHERE metadata->>'data_type' = 'company_policy'
     GROUP BY metadata->>'source_db'
     ORDER BY source`
  );

  console.log("📊 Verification — policy chunks in database:");
  for (const row of verify.rows) {
    console.log(`   ${row.source}: ${row.chunks} chunks`);
  }

  await pool.end();
}

ingestDocuments().catch((err) => {
  console.error("❌ Ingestion failed:", err);
  process.exit(1);
});
