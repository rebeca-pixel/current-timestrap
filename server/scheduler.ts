import cron from "node-cron";
import { storage } from "./storage";
import { getTasks } from "./pmsSupabase";
import { getLMSHours } from "./lmsSupabase";
import { sendDailyPlanReminderEmail, sendEODSummaryReportEmail, sendEmail } from "./email";
import { format, subDays } from "date-fns";

/**
 * Initialize all scheduled tasks
 */
export function initScheduler() {
  console.log("[SCHEDULER] Automated alert/EOD cron jobs are disabled. Manual alert buttons must be used.");
}

/**
 * Send reminders to all employees to fill their Plan for the Day
 */
async function sendMorningReminders() {
  try {
    const employees = await storage.getEmployees();
    const activeEmployees = employees.filter(e => e.isActive && e.role !== 'admin');
    const today = format(new Date(), "yyyy-MM-dd");

    for (const emp of activeEmployees) {
      if (!emp.email) continue;
      const existingPlan = await storage.getDailyPlanByDate(emp.id, today);
      if (existingPlan) continue;

      const pendingTasks = await getTasks(undefined, undefined, emp.employeeCode);
      const taskNames = pendingTasks.map(t => t.task_name);

      await sendDailyPlanReminderEmail({
        recipients: [emp.email],
        pendingTasks: taskNames
      });
    }
  } catch (error) {
    console.error("[SCHEDULER] Morning reminders failed:", error);
  }
}

/**
 * Generic function to generate EOD report and send to admins
 */
export async function generateAndSendEODReport(dateStr: string, reportType: string) {
  try {
    console.log(`[SCHEDULER] Generating ${reportType} report for ${dateStr}`);
    const employees = await storage.getEmployees();
    const dateEntries = await storage.getTimeEntriesByDate(dateStr);
    const dailySubs = await storage.getDailySubmissionsByDate(dateStr);

    const reportData = [];
    const missingEmployees = [];

    for (const emp of employees) {
      if (emp.role === 'admin' && emp.employeeCode === 'ADMIN') continue;
      if (!emp.isActive) continue;

      const lmsData = await getLMSHours(emp.employeeCode, dateStr);
      const isFullLeave = lmsData.leaveHours >= 8;
      const isFullOD = (lmsData.odHours || 0) >= 8; // Full Day approved OD
      const isFinalSubmitted = dailySubs.some(s => s.employeeId === emp.id);
      const empEntries = dateEntries.filter(e => e.employeeId === emp.id);

      let status = "Missing";
      if (isFinalSubmitted) status = "Submitted";
      else if (isFullLeave) status = "On Leave";
      else if (isFullOD) status = "On OD"; // treated as a valid exemption, not missing
      else if (empEntries.length > 0) status = "Incomplete";

      if (status === "Missing" || status === "Incomplete") {
        missingEmployees.push(emp);

        // Only trigger in-app alerts at Noon
        if (reportType.includes("Noon")) {
          await storage.createAlert({
            employeeId: emp.id,
            type: status === "Missing" ? "missing_submission" : "late_submission",
            message: status === "Missing"
              ? `You missed your timesheet submission for ${dateStr}.`
              : `Your timesheet for ${dateStr} is incomplete and portal is now closed.`,
            date: dateStr
          });
        }
      }

      reportData.push({
        name: emp.name,
        code: emp.employeeCode,
        dept: emp.department || "N/A",
        status,
        hours: isFinalSubmitted ? dailySubs.find(s => s.employeeId === emp.id)?.totalHours : "0"
      });
    }

    const admins = employees.filter(e => e.role === 'admin' || e.role === 'hr');
    const adminEmails = admins.map(a => a.email).filter(Boolean) as string[];

    if (adminEmails.length > 0) {
      const reportRows = reportData.map(r => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 16px; border-bottom: 1px solid #f1f5f9;">
            <div style="font-weight: 700; color: #0f172a;">${r.name}</div>
            <div style="font-size: 11px; color: #64748b;">${r.code}</div>
          </td>
          <td style="padding: 16px; border-bottom: 1px solid #f1f5f9; color: #475569; font-size: 13px;">${r.dept}</td>
          <td style="padding: 16px; border-bottom: 1px solid #f1f5f9;">
            <span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; text-transform: uppercase; ${r.status === 'Submitted' ? 'background: #dcfce7; color: #166534;' :
          r.status === 'On Leave' ? 'background: #dbeafe; color: #1e40af;' :
            r.status === 'On OD' ? 'background: #ede9fe; color: #6d28d9;' :
              'background: #fee2e2; color: #991b1b;'
        }">${r.status}</span>
          </td>
          <td style="padding: 16px; border-bottom: 1px solid #f1f5f9; text-align: center; font-weight: 700; color: #0f172a;">${r.hours}h</td>
        </tr>
      `).join('');

      await sendEODSummaryReportEmail({
        recipients: adminEmails,
        date: dateStr,
        summary: {
          total: reportData.length,
          submitted: reportData.filter(r => r.status === 'Submitted').length,
          missing: missingEmployees.length,
          onLeave: reportData.filter(r => r.status === 'On Leave').length,
          onOD: reportData.filter(r => r.status === 'On OD').length
        },
        reportRows
      });
    }

    // Send closing alert email to missing employees only at Noon
    if (reportType.includes("Noon")) {
      const missingEmails = missingEmployees.map(e => e.email).filter(Boolean) as string[];
      if (missingEmails.length > 0) {
        await sendEmail({
          to: missingEmails,
          subject: `⚠️ Portal Closed: Missing Timesheet Submission - ${dateStr}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #fee2e2; border-radius: 16px; background: #ffffff;">
              <h2 style="color: #991b1b; margin-top: 0;">Timesheet Portal Closed</h2>
              <p style="color: #475569; line-height: 1.6;">Your submission for today (${dateStr}) was not completed by the 12:00 PM deadline.</p>
              <p style="color: #475569; line-height: 1.6;">Please contact your manager or HR to resolve this late submission.</p>
            </div>
          `
        });
      }
    }
  } catch (error) {
    console.error(`[SCHEDULER] ${reportType} report failed:`, error);
  }
}