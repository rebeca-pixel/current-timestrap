// Resend email integration for Time Strap
import { Resend } from "resend";
import "dotenv/config";
import { format } from "date-fns";
import { TimeEntry } from "@shared/schema";
import PDFDocument from "pdfkit";

/* ============================
   CONFIGURATION
============================ */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Time Strap <noreply@resend.dev>";
const SENDER_EMAILS = process.env.SENDER_EMAIL || "tharakesh@ctint.in,sp@ctint.in,rebeca@ctint.in";

console.log("[EMAIL CONFIG] RESEND_API_KEY:", RESEND_API_KEY ? "✓ Present" : "✗ Missing");
console.log("[EMAIL CONFIG] FROM_EMAIL:", FROM_EMAIL);
console.log("[EMAIL CONFIG] SENDER_EMAILS:", SENDER_EMAILS);

if (!RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY not found in environment variables");
}

const resend = new Resend(RESEND_API_KEY);

/* ============================
   NOTIFICATION RECIPIENTS
============================ */

// Parse sender emails from comma-separated string
const NOTIFICATION_RECIPIENTS = SENDER_EMAILS.split(",").map((email: string) => email.trim());
console.log("[EMAIL CONFIG] Recipients:", NOTIFICATION_RECIPIENTS);

/* ============================
   HELPERS / TEMPLATES
============================ */

function formatDateSafe(dVal: any): string {
  if (!dVal) return '—';
  try {
    const d = new Date(dVal);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN');
  } catch {
    return '—';
  }
}

/**
 * Format a value for the Timeline column in email templates.
 * - HH:MM time strings (e.g. "14:20") → "2:20 pm"
 * - null/undefined/empty → "—"
 * - Calendar date strings (e.g. "2026-06-19") → "19/6/2026" (last-resort fallback)
 */
function formatTimelineSafe(val: any): string {
  if (!val) return '—';
  if (typeof val === 'string') {
    // HH:MM or HH:MM:SS — format as 12-hour time
    const timeMatch = val.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2];
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${hours}:${minutes} ${ampm}`;
    }
    // ISO datetime or calendar date — display as local date only (last resort)
    try {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('en-IN');
    } catch { /* ignore */ }
  }
  return '—';
}

function parseDurationSafe(duration: any): number {
  if (!duration) return 0;
  const str = String(duration).trim();
  const hMatch = str.match(/(\d+)h/);
  const mMatch = str.match(/(\d+)m/);
  if (hMatch || mMatch) {
    return (hMatch ? parseInt(hMatch[1], 10) : 0) * 60 + (mMatch ? parseInt(mMatch[1], 10) : 0);
  }
  const colonMatch = str.match(/^(\d+):(\d+)$/);
  if (colonMatch) {
    return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
  }
  const numeric = Number(str);
  if (!isNaN(numeric)) return Math.round(numeric * 60);
  return 0;
}

function deriveMinutesFromTimesSafe(startTime: any, endTime: any): number {
  if (!startTime || !endTime) return 0;
  const s = String(startTime).match(/^(\d{1,2}):(\d{2})/);
  const e = String(endTime).match(/^(\d{1,2}):(\d{2})/);
  if (!s || !e) return 0;
  const diff = (parseInt(e[1], 10) * 60 + parseInt(e[2], 10)) - (parseInt(s[1], 10) * 60 + parseInt(s[2], 10));
  return diff > 0 ? diff : 0;
}

function formatHrsSafe(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function generateTaskTable(tasks: any[]) {
  return `
    <table style="width:100%; border-collapse: collapse; margin-top: 20px; font-size: 13px;">
      <thead>
        <tr style="background-color: #1e293b; color: #ffffff;">
          <th style="padding: 10px; border: 1px solid #334155; text-align: left;">Project / Task</th>
          <th style="padding: 10px; border: 1px solid #334155; text-align: center;">Timeline</th>
          <th style="padding: 10px; border: 1px solid #334155; text-align: center;">Hrs</th>
          <th style="padding: 10px; border: 1px solid #334155; text-align: center;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${tasks.map(task => {
    const progress = task.percentageComplete !== undefined ? `${task.percentageComplete}%` : '—';
    const progressColor = task.percentageComplete === 100 ? '#16a34a' : (task.percentageComplete || 0) > 0 ? '#2563eb' : '#64748b';
    const startDate = formatTimelineSafe(task.startTime || task.start_time);
    const endDate = formatTimelineSafe(task.endTime || task.end_time);

    // Fall back to computing Hrs from start/end time whenever the stored
    // totalHours is missing or doesn't parse (e.g. drafts auto-created via
    // Plan-for-Day/calendar sync with a blank total_hours), so the email
    // never shows a blank duration for a task that clearly has real times.
    const storedMinutes = parseDurationSafe(task.totalHours);
    const minutes = storedMinutes > 0
      ? storedMinutes
      : deriveMinutesFromTimesSafe(task.startTime || task.start_time, task.endTime || task.end_time);
    const hrsDisplay = minutes > 0 ? formatHrsSafe(minutes) : (task.totalHours || '—');

    return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px; border: 1px solid #e2e8f0;">
              <div><strong>${task.projectName || '—'}</strong></div>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${task.taskDescription || '—'}</div>
              <div style="margin-top: 4px;"><span style="color:${progressColor}; font-weight:bold;">Progress: ${progress}</span></div>
            </td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap; font-size: 11px; color: #475569;">
              <div>S: ${startDate}</div>
              <div style="margin-top:2px;">E: ${endDate}</div>
            </td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold;">${hrsDisplay}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">
               <span style="padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; 
                ${task.status === 'approved' ? 'background: #dcfce7; color: #166534;' :
        task.status === 'rejected' ? 'background: #fee2e2; color: #991b1b;' :
          'background: #dbeafe; color: #1e40af;'}">
                ${(task.status || 'PENDING').toUpperCase()}
              </span>
            </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;
}

/* ============================
   PDF GENERATION
============================ */

/**
 * Generates a neat professional PDF buffer for the site report
 */
async function generateSiteReportPDF(data: {
  employeeName: string;
  projectName: string;
  date: string;
  workCategory: string;
  startTime: string;
  endTime: string;
  duration: string;
  workDone: string;
  issuesFaced?: string;
  materialsUsed?: string;
  laborCount: number;
  laborDetails?: string;
  sqftCovered?: string;
  laborData?: { name: string; inTime: string; outTime: string }[];
  location?: { lat: string; lng: string };
  attachments?: { fileName: string; fileUrl: string; fileType?: string }[];
}): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `Site Report - ${data.projectName} - ${data.date}`,
          Author: 'Time Strap PMS',
        }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Brand Colors
      const blue = '#3b82f6';
      const darkBlue = '#0f172a';
      const lightGray = '#f8fafc';
      const borderGray = '#e2e8f0';
      const textDark = '#1e293b';
      const textMuted = '#64748b';

      // --- HEADER ---
      doc.rect(0, 0, 595.28, 120).fill(darkBlue);
      doc.fillColor(blue).fontSize(22).text('SITE PROGRESS REPORT', 50, 45, { characterSpacing: 1 });
      doc.fillColor('#94a3b8').fontSize(12).text(`${data.projectName.toUpperCase()}  |  ${data.date}`, 50, 75);

      // --- INFO GRID ---
      let currentY = 150;
      doc.fillColor(textMuted).fontSize(9).text('REPORTED BY', 50, currentY);
      doc.fillColor(textMuted).fontSize(9).text('WORKING HOURS', 300, currentY);

      doc.fillColor(textDark).fontSize(11).text(data.employeeName, 50, currentY + 15);
      doc.fillColor(textDark).fontSize(11).text(`${data.startTime} - ${data.endTime} (${data.duration})`, 300, currentY + 15);

      currentY += 45;
      doc.fillColor(textMuted).fontSize(9).text('CATEGORY', 50, currentY);
      doc.fillColor(textMuted).fontSize(9).text('WORK OUTPUT', 300, currentY);

      doc.fillColor(textDark).fontSize(11).text(data.workCategory, 50, currentY + 15);
      doc.fillColor(textDark).fontSize(11).text(data.sqftCovered || 'N/A', 300, currentY + 15);

      // Separator
      currentY += 45;
      doc.moveTo(50, currentY).lineTo(545, currentY).strokeColor(borderGray).stroke();
      currentY += 30;

      // --- ACCOMPLISHMENTS ---
      doc.fillColor(blue).fontSize(14).text('Daily Accomplishments', 50, currentY);
      currentY += 20;
      doc.fillColor(textDark).fontSize(10).text(data.workDone, 50, currentY, { width: 495, align: 'justify', lineGap: 2 });

      currentY = doc.y + 30;

      // --- LABOR LOG ---
      if (data.laborData && data.laborData.length > 0) {
        if (currentY > 700) { doc.addPage(); currentY = 50; }
        doc.fillColor('#8b5cf6').fontSize(14).text(`Labor Attendance Log (${data.laborCount} Total)`, 50, currentY);
        currentY += 25;

        // Table Header
        doc.rect(50, currentY, 495, 20).fill('#e2e8f0');
        doc.fillColor('#475569').fontSize(8).text('LABOUR NAME', 60, currentY + 6);
        doc.text('IN TIME', 300, currentY + 6);
        doc.text('OUT TIME', 450, currentY + 6);
        currentY += 20;

        doc.fillColor(textDark).fontSize(9);
        for (const l of data.laborData) {
          if (currentY > 750) { doc.addPage(); currentY = 50; }
          doc.text(l.name || 'Anonymous', 60, currentY + 6);
          doc.text(l.inTime || '--:--', 300, currentY + 6);
          doc.text(l.outTime || '--:--', 450, currentY + 6);
          doc.moveTo(50, currentY + 20).lineTo(545, currentY + 20).strokeColor('#f1f5f9').stroke();
          currentY += 20;
        }
        currentY += 10;
      } else if (data.laborDetails) {
        if (currentY > 700) { doc.addPage(); currentY = 50; }
        doc.fillColor('#8b5cf6').fontSize(14).text('Labor Details', 50, currentY);
        currentY += 20;
        doc.fillColor(textDark).fontSize(10).text(data.laborDetails, 50, currentY, { width: 495 });
        currentY = doc.y + 30;
      }

      // --- MATERIALS ---
      if (data.materialsUsed) {
        if (currentY > 700) { doc.addPage(); currentY = 50; }
        doc.fillColor('#10b981').fontSize(14).text('Materials Consumed', 50, currentY);
        currentY += 20;
        doc.fillColor(textDark).fontSize(10).text(data.materialsUsed, 50, currentY, { width: 495 });
        currentY = doc.y + 30;
      }

      // --- CHALLENGES ---
      if (data.issuesFaced) {
        if (currentY > 700) { doc.addPage(); currentY = 50; }
        doc.fillColor('#ef4444').fontSize(14).text('Challenges & Bottlenecks', 50, currentY);
        currentY += 20;
        doc.rect(50, currentY, 495, 40).fill('#fff1f2').stroke('#fecaca');
        doc.fillColor('#991b1b').fontSize(10).text(data.issuesFaced, 60, currentY + 10, { width: 475 });
        currentY = doc.y + 30;
      }

      // --- PHOTOS ---
      const images = data.attachments?.filter(a => a.fileType?.startsWith('image/') || a.fileUrl?.startsWith('data:image/')) || [];
      if (images.length > 0) {
        doc.addPage();
        doc.fillColor(darkBlue).fontSize(18).text('SITE EVIDENCE PHOTOS', 50, 50);
        currentY = 100;

        for (const img of images) {
          try {
            if (currentY > 550) { doc.addPage(); currentY = 50; }

            let imgBuffer: Buffer;
            if (img.fileUrl.startsWith('data:')) {
              const base64Data = img.fileUrl.split(';base64,').pop()!;
              imgBuffer = Buffer.from(base64Data, 'base64');
            } else {
              // Internal public URL or external URL
              const response = await fetch(img.fileUrl);
              const arrayBuffer = await response.arrayBuffer();
              imgBuffer = Buffer.from(arrayBuffer);
            }

            // Draw image with max width/height to fit
            doc.image(imgBuffer, 50, currentY, { width: 495, height: 250, fit: [495, 250] });
            currentY += 260;
            doc.fillColor(textMuted).fontSize(8).text(img.fileName, 50, currentY);
            currentY += 30;
          } catch (e) {
            console.error('Failed to add image to PDF:', img.fileName, e);
            doc.fillColor('#ef4444').fontSize(8).text(`[Failed to load image: ${img.fileName}]`, 50, currentY);
            currentY += 20;
          }
        }
      }

      // Footer
      doc.fontSize(8).fillColor(textMuted).text('Automated professional site report via Time Strap PMS.', 50, 780, { align: 'center' });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Helper to get a human-readable address from lat/lng
 */
async function getAddressFromCoords(lat?: string, lng?: string): Promise<string | undefined> {
  if (!lat || !lng) return undefined;
  try {
    // Using Nominatim (OpenStreetMap) for basic reverse geocoding
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
      headers: { 'User-Agent': 'TimeStrap-PMS-Reporter' }
    });
    const data = await response.json();
    if (data && data.display_name) {
      // Return a shortened version (e.g., City, Suburb)
      const parts = data.display_name.split(',');
      if (parts.length > 3) {
        return `${parts[0].trim()}, ${parts[1].trim()}, ${parts[2].trim()}`;
      }
      return data.display_name;
    }
  } catch (err) {
    console.error('[GEOCODE] Failed to resolve address:', err);
  }
  return undefined;
}

// 1. Grouped submission summary email
export async function sendTimesheetSummaryEmail(data: {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  date: string;
  totalHours: string;
  taskHours?: string;
  lmsHours?: string;
  tasks: TimeEntry[];
  status: string; // usually 'pending'
}) {
  try {
    const { employeeName, employeeCode, date, totalHours, taskHours, lmsHours, tasks } = data;
    const taskTable = generateTaskTable(tasks);

    const result = await sendEmail({
      to: NOTIFICATION_RECIPIENTS,
      subject: `Timesheet Submission Summary - ${employeeName} (${employeeCode}) - ${date}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin:0 auto;">
        <div style="background:#0f172a;padding:20px;text-align:center;">
          <h1 style="color:#3b82f6;margin:0;">Time Strap</h1>
          <p style="color:#94a3b8;">Timesheet Summary</p>
        </div>
        <div style="padding:30px;background:#f8fafc;">
          <h2 style="color:#0f172a;margin-top:0;">New Timesheet Submission</h2>
          <p><strong>Employee:</strong> ${employeeName} (${employeeCode})</p>
          <p><strong>Date:</strong> ${date}</p>
          <p><strong>Total Hours:</strong> <span style="font-size: 1.25rem; font-weight: bold; color: #3b82f6;">${totalHours}</span></p>
          ${taskHours ? `<p style="font-size: 12px; color: #64748b; margin-bottom: 2px;">• Task Work: ${taskHours}</p>` : ''}
          ${lmsHours ? `<p style="font-size: 12px; color: #64748b; margin-top: 2px;">• LMS Approved: ${lmsHours}</p>` : ''}
          ${taskTable}
        </div>
        <div style="background:#1e293b;padding:15px;text-align:center;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">Automated email from Time Strap System</p>
        </div>
      </div>
      `
    });
    return result;
  } catch (err) {
    console.error("[SUMMARY EMAIL ERROR]", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 2. Grouped approval/rejection email
export async function sendApprovalSummaryEmail(data: {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  date: string;
  tasks: TimeEntry[];
  status: "manager_approved" | "approved" | "rejected";
  approverName?: string;
  rejectionReason?: string;
  recipients?: string[];
}) {
  try {
    const { employeeName, employeeCode, date, tasks, status, approverName, rejectionReason, recipients } = data;
    const taskTable = generateTaskTable(tasks);

    let statusText = '';
    let color = '';
    if (status === 'manager_approved') {
      statusText = 'Manager Approved';
      color = '#3b82f6';
    } else if (status === 'approved') {
      statusText = 'Final Approved';
      color = '#22c55e';
    } else {
      statusText = 'Rejected';
      color = '#ef4444';
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width:800px; margin:0 auto; background-color:#0f172a; color:#ffffff;">
        <div style="padding:20px;text-align:center;">
          <h1>Time Strap</h1>
          <p>Status Update: <span style="color:${color}; font-weight:bold;">${statusText}</span></p>
        </div>
        <div style="padding:30px; background:#1e293b; color:#e2e8f0;">
          <p><strong>Employee:</strong> ${employeeName} (${employeeCode})</p>
          <p><strong>Date:</strong> ${date}</p>
          ${approverName ? `<p><strong>Approved By:</strong> ${approverName}</p>` : ''}
          ${rejectionReason ? `<p><strong>Reason:</strong> ${rejectionReason}</p>` : ''}
          ${taskTable}
        </div>
        <div style="background:#0f172a;padding:15px;text-align:center;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">Automated email from Time Strap System</p>
        </div>
      </div>
    `;

    const result = await sendEmail({
      to: recipients || NOTIFICATION_RECIPIENTS,
      subject: `Timesheet ${statusText} - ${employeeName} (${employeeCode}) - ${date}`,
      html
    });
    return result;
  } catch (err) {
    console.error("[APPROVAL SUMMARY EMAIL ERROR]", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 3. Site Report Email
export async function sendSiteReportEmail(data: {
  employeeName: string;
  projectName: string;
  date: string;
  workCategory: string;
  startTime: string;
  endTime: string;
  duration: string;
  workDone: string;
  issuesFaced?: string;
  materialsUsed?: string;
  laborCount: number;
  laborDetails?: string;
  sqftCovered?: string;
  laborData?: { name: string; inTime: string; outTime: string }[];
  location?: { lat: string; lng: string };
  attachments?: { fileName: string; fileUrl: string; fileType?: string }[];
  recipients: string[];
}) {
  try {
    const {
      employeeName, projectName, date, workCategory,
      startTime, endTime, duration, workDone,
      issuesFaced, materialsUsed, laborCount, laborDetails,
      sqftCovered, laborData,
      location, attachments, recipients
    } = data;

    // Separate images from other files
    const imageAttachments = attachments?.filter(a => a.fileType?.startsWith('image/') || a.fileUrl?.startsWith('data:image/')) || [];
    const otherAttachments = attachments?.filter(a => !(a.fileType?.startsWith('image/') || a.fileUrl?.startsWith('data:image/'))) || [];

    const locationName = await getAddressFromCoords(location?.lat, location?.lng);

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 800px; margin: 0 auto; color: #334155; line-height: 1.6;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 40px 30px; border-radius: 16px 16px 0 0; text-align: center;">
          <h1 style="color: #3b82f6; margin: 0; font-size: 28px; letter-spacing: -0.5px;">Site Progress Report</h1>
          <p style="color: #94a3b8; margin: 10px 0 0 0; font-size: 16px;">${projectName} | ${date}</p>
        </div>

        <!-- Meta Grid -->
        <div style="padding: 30px; background: #ffffff; border: 1px solid #e2e8f0; border-top: none;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; width: 50%;">
                <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold; display: block;">Reported By</span>
                <span style="font-size: 15px; color: #0f172a; font-weight: 500;">${employeeName}</span>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; width: 50%;">
                <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold; display: block;">Working Hours</span>
                <span style="font-size: 15px; color: #0f172a; font-weight: 500;">
                  ${startTime} - ${endTime} (${duration})
                  ${locationName ? `<br /><span style="font-size: 11px; color: #3b82f6; font-weight: 600;">📍 ${locationName}</span>` : ''}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9;">
                <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold; display: block;">Category</span>
                <span style="font-size: 15px; color: #0f172a; font-weight: 500;">${workCategory}</span>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9;">
                <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold; display: block;">Work Output</span>
                <span style="font-size: 15px; color: #0f172a; font-weight: 500;">${sqftCovered || 'N/A'}</span>
              </td>
            </tr>
          </table>

          <!-- Main Content -->
          <div style="margin-top: 30px;">
            <h3 style="color: #0f172a; font-size: 18px; margin-bottom: 12px; border-left: 4px solid #3b82f6; padding-left: 12px;">Daily Accomplishments</h3>
            <div style="background: #f8fafc; padding: 20px; border-radius: 12px; color: #334155; font-size: 15px; white-space: pre-wrap;">${workDone}</div>
          </div>

          ${(laborData && laborData.length > 0) ? `
          <div style="margin-top: 25px;">
            <h3 style="color: #0f172a; font-size: 18px; margin-bottom: 12px; border-left: 4px solid #8b5cf6; padding-left: 12px;">Individual Attendance Log (${laborCount} Total)</h3>
            <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 12px; overflow: hidden;">
              <thead>
                <tr style="background: #e2e8f0; text-align: left;">
                  <th style="padding: 12px; font-size: 12px; color: #475569; text-transform: uppercase;">Labour Name</th>
                  <th style="padding: 12px; font-size: 12px; color: #475569; text-transform: uppercase;">In Time</th>
                  <th style="padding: 12px; font-size: 12px; color: #475569; text-transform: uppercase;">Out Time</th>
                </tr>
              </thead>
              <tbody>
                ${laborData.map(l => `
                  <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; font-size: 14px; color: #1e293b;">${l.name || 'Anonymous'}</td>
                    <td style="padding: 12px; font-size: 14px; color: #475569;">${l.inTime || '--:--'}</td>
                    <td style="padding: 12px; font-size: 14px; color: #475569;">${l.outTime || '--:--'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : laborDetails ? `
          <div style="margin-top: 25px;">
            <h3 style="color: #0f172a; font-size: 18px; margin-bottom: 12px; border-left: 4px solid #8b5cf6; padding-left: 12px;">Labor Breakdown</h3>
            <div style="background: #f8fafc; padding: 20px; border-radius: 12px; color: #334155; font-size: 15px; white-space: pre-wrap;">${laborDetails}</div>
          </div>
          ` : ''}

          ${materialsUsed ? `
          <div style="margin-top: 25px;">
            <h3 style="color: #0f172a; font-size: 18px; margin-bottom: 12px; border-left: 4px solid #10b981; padding-left: 12px;">Materials Consumed</h3>
            <div style="background: #f8fafc; padding: 20px; border-radius: 12px; color: #334155; font-size: 15px; white-space: pre-wrap;">${materialsUsed}</div>
          </div>
          ` : ''}

          ${issuesFaced ? `
          <div style="margin-top: 25px;">
            <h3 style="color: #0f172a; font-size: 18px; margin-bottom: 12px; border-left: 4px solid #ef4444; padding-left: 12px;">Challenges & Bottlenecks</h3>
            <div style="background: #fff1f2; padding: 20px; border-radius: 12px; color: #991b1b; font-size: 15px; white-space: pre-wrap;">${issuesFaced}</div>
          </div>
          ` : ''}

          ${imageAttachments.length > 0 ? `
          <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 25px;">
            <h3 style="color: #0f172a; font-size: 16px; margin-bottom: 15px; border-left: 4px solid #6366f1; padding-left: 12px;">📷 Site Evidence Photos (${imageAttachments.length})</h3>
            ${imageAttachments.map(a => `
              <div style="margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <img src="${a.fileUrl}" alt="${a.fileName}" style="width: 100%; max-width: 700px; height: auto; display: block;" />
                <div style="padding: 8px 12px; background: #f8fafc; font-size: 12px; color: #64748b;">${a.fileName}</div>
              </div>
            `).join('')}
          </div>
          ` : ''}

          ${otherAttachments.length > 0 ? `
          <div style="margin-top: 20px;">
            <h3 style="color: #0f172a; font-size: 16px; margin-bottom: 15px;">📎 Other Documents</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 10px;">
              ${otherAttachments.map(a => `
                <span style="display: inline-block; padding: 8px 16px; background: #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; font-weight: 500; margin: 4px;">
                  📄 ${a.fileName}
                </span>
              `).join('')}
            </div>
          </div>
          ` : ''}

          ${locationName ? `
          <div style="margin-top: 30px; padding: 15px; background: #f1f5f9; border-radius: 12px; text-align: center;">
            <span style="font-size: 12px; color: #64748b;">📍 GPS Verified Location: <strong>${locationName}</strong></span>
          </div>
          ` : location ? `
          <div style="margin-top: 30px; padding: 15px; background: #f1f5f9; border-radius: 12px; text-align: center;">
            <span style="font-size: 12px; color: #64748b;">📍 GPS Verified Location: <strong>${location.lat}, ${location.lng}</strong></span>
          </div>
          ` : ''}
        </div>

        <!-- Footer -->
        <div style="padding: 30px; text-align: center; border-radius: 0 0 16px 16px;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">Automated professional site report via Time Strap PMS.</p>
        </div>
      </div>
    `;

    const pdfBuffer = await generateSiteReportPDF({ ...data, location: location ? { lat: location.lat, lng: location.lng } : undefined });
    const fileName = `Site_Report_${projectName.replace(/\s+/g, '_')}_${date}.pdf`;

    // Process image attachments to be sent as actual files
    const imageFiles = imageAttachments.map(a => ({
      filename: a.fileName,
      content: a.fileUrl.startsWith('data:')
        ? Buffer.from(a.fileUrl.split(';base64,').pop()!, 'base64')
        : undefined,
      path: a.fileUrl.startsWith('http') ? a.fileUrl : undefined
    }));

    const { data: result, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients.length > 0 ? recipients : NOTIFICATION_RECIPIENTS,
      subject: `[Site Report] ${projectName} - ${date} - ${workCategory}`,
      html,
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer,
        },
        ...imageFiles.filter(f => f.content || f.path) // only include if we have content or path
      ]
    });

    if (error) {
      console.error("[SITE REPORT EMAIL ERROR]", error);
      return { success: false, error };
    }
    console.log("[SITE REPORT EMAIL] sent:", result?.id);
    return { success: true, result };
  } catch (err) {
    console.error("[SITE REPORT EMAIL ERROR]", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ============================
   EMAIL VALIDATION UTILITIES
============================ */

/**
 * Validates email format
 */
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  // RFC 5322 simplified regex pattern
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim()) && email.length <= 254;
}

/**
 * Filters and validates email list
 */
function validateEmailList(emails: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const email of emails) {
    if (isValidEmail(email)) {
      valid.push(email.trim().toLowerCase());
    } else {
      invalid.push(email);
    }
  }

  return { valid, invalid };
}

/* ============================
   GENERIC EMAIL SENDER
============================ */

/**
 * Generic email sender with validation and retry logic
 */
export async function sendEmail(data: {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  maxRetries?: number;
}) {
  const { to = [], cc = [], subject, html, maxRetries = 2 } = data;

  // Validate recipients
  const { valid: validTo, invalid: invalidTo } = validateEmailList(to);
  const { valid: validCc, invalid: invalidCc } = validateEmailList(cc);

  if (validTo.length === 0) {
    const errorMsg = `[EMAIL ERROR] No valid recipient emails. Invalid: ${invalidTo.join(', ')}`;
    console.error(errorMsg);
    return {
      success: false,
      error: "No valid recipient emails provided",
      details: { invalidRecipients: invalidTo }
    };
  }

  if (invalidTo.length > 0) {
    console.warn(`[EMAIL WARNING] Skipping invalid recipient emails:`, invalidTo);
  }
  if (invalidCc.length > 0) {
    console.warn(`[EMAIL WARNING] Skipping invalid CC emails:`, invalidCc);
  }

  let lastError: any = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      attempt++;
      console.log(`[EMAIL] Attempt ${attempt}/${maxRetries + 1}: Sending email with subject: "${subject}" to ${validTo.length} recipient(s)`);

      const { data: result, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: validTo,
        cc: validCc.length > 0 ? validCc : undefined,
        subject,
        html
      });

      if (error) {
        lastError = error;
        console.error(`[EMAIL ERROR] Attempt ${attempt}: ${error.message || error}`);

        if (attempt <= maxRetries) {
          const waitTime = 1000 * Math.pow(2, attempt - 1); // exponential backoff
          console.log(`[EMAIL] Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        return {
          success: false,
          error: error.message || "Email send failed",
          details: { attempt, totalAttempts: maxRetries + 1, error }
        };
      }

      console.log(`[EMAIL SUCCESS] Email ID: ${result?.id} | Recipients: ${validTo.join(', ')} | Subject: "${subject}"`);
      return {
        success: true,
        result,
        details: {
          emailId: result?.id,
          recipientCount: validTo.length,
          ccCount: validCc.length,
          attempt
        }
      };
    } catch (err: any) {
      lastError = err;
      console.error(`[EMAIL ERROR] Attempt ${attempt}: ${err.message || err}`);

      if (attempt <= maxRetries) {
        const waitTime = 1000 * Math.pow(2, attempt - 1);
        console.log(`[EMAIL] Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      return {
        success: false,
        error: err.message || "Email send failed",
        details: { attempt, totalAttempts: maxRetries + 1, error: err }
      };
    }
  }

  return {
    success: false,
    error: lastError?.message || "Email send failed after retries",
    details: { attempt, totalAttempts: maxRetries + 1, lastError }
  };
}

export async function sendDeviationNotificationEmail(data: {
  employeeName: string;
  employeeCode: string;
  taskName: string;
  projectName: string;
  reason: string;
}) {
  const { employeeName, employeeCode, taskName, projectName, reason } = data;
  const date = new Date().toLocaleDateString('en-IN');
  const subject = `[Deviation Approval Required] ${employeeName} (${employeeCode}) - ${projectName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
      <h2 style="color: #d97706; border-bottom: 2px solid #fcd34d; padding-bottom: 10px;">⚠️ Deviation Approval Request</h2>
      <p><strong>Employee:</strong> ${employeeName} (${employeeCode})</p>
      <p><strong>Date:</strong> ${date}</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <div style="background-color: #fffbeb; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b;">
        <p style="margin: 0;"><strong>Task:</strong> ${taskName}</p>
        <p style="margin: 5px 0 0 0;"><strong>Project:</strong> ${projectName}</p>
        <p style="margin: 15px 0 0 0;"><strong>Reason for Deviation:</strong></p>
        <p style="background: white; padding: 10px; border: 1px solid #fde68a; border-radius: 4px; font-style: italic;">"${reason}"</p>
      </div>
      <p style="margin-top: 20px;">This task was not part of the initial "Plan for the Day" and requires your approval.</p>
      <div style="margin-top: 30px; text-align: center;">
        <a href="${process.env.APP_URL || 'http://localhost:5000'}/approvals"
           style="background-color: #2563eb; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
           Review in Approval Page →
        </a>
      </div>
    </div>
  `;

  console.log("[DEVIATION EMAIL] Sending to:", NOTIFICATION_RECIPIENTS);
  return await sendEmail({ to: NOTIFICATION_RECIPIENTS, subject, html });
}

export async function sendDailyPlanSubmittedEmail(data: {
  employeeName: string;
  employeeCode: string;
  selectedTasks: { task_name: string; projectName?: string; start_date?: string; end_date?: string; startTime?: string; endTime?: string; start_time?: string; end_time?: string; scheduleData?: any; progress?: number; isOverdue?: boolean }[];
  unselectedTasks: { taskName: string; reason: string; newDueDate: string; start_date?: string; end_date?: string; progress?: number; isOverdue?: boolean }[];
}) {
  const { employeeName, employeeCode, selectedTasks, unselectedTasks } = data;
  const date = new Date().toLocaleDateString('en-IN');
  const subject = `[Daily Plan Submitted] ${employeeName} (${employeeCode}) - ${date}`;

  const overdueSelectedTasks = selectedTasks.filter(t => t.isOverdue);
  const onTrackSelectedTasks = selectedTasks.filter(t => !t.isOverdue);
  const overdueUnselectedTasks = unselectedTasks.filter(t => t.isOverdue);
  const onTrackUnselectedTasks = unselectedTasks.filter(t => !t.isOverdue);

  const generateTaskRow = (t: any, isUnselected: boolean = false) => {
    const progress = t.progress !== undefined ? `${t.progress}%` : '0%';
    const progressColor = t.progress === 100 ? '#16a34a' : t.progress && t.progress > 0 ? '#2563eb' : '#64748b';

    if (isUnselected) {
      // Deferred tasks: no Timeline column — timeslots are irrelevant for postponed tasks
      return `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-weight:500;">${t.taskName}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-style:italic;color:#64748b;">${t.reason}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-weight:bold;color:${progressColor};text-align:center;">${progress}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:bold;color:#d97706;">${new Date(t.newDueDate).toLocaleDateString('en-IN')}</td>
      </tr>`;
    }

    // Selected tasks: show the actual scheduled time from scheduleData (set by user in plan UI)
    const taskStart = formatTimelineSafe(t.startTime || t.scheduleData?.startTime || t.start_time);
    const taskEnd = formatTimelineSafe(t.endTime || t.scheduleData?.endTime || t.end_time);
    return `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-weight:500;">${t.task_name}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#475569;">${t.projectName || '—'}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-weight:bold;color:${progressColor};text-align:center;">${progress}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;white-space:nowrap;font-size:12px;text-align:center;">
        <div><span style="color:#94a3b8">Start:</span> ${taskStart}</div>
        <div><span style="color:#94a3b8">End:</span> ${taskEnd}</div>
      </td>
    </tr>`;
  };

  const renderTable = (rows: string, isUnselected: boolean = false, isOverdue: boolean = false) => {
    if (!rows) return '';
    return `
      <div style="margin-top: 15px; border-radius: 8px; overflow: hidden; border: 1px solid ${isOverdue ? '#fca5a5' : '#e2e8f0'};">
        <div style="background: ${isOverdue ? '#fef2f2' : (isUnselected ? '#fffbeb' : '#f0fdf4')}; padding: 10px 15px; border-bottom: 1px solid ${isOverdue ? '#fca5a5' : '#e2e8f0'}; font-weight: bold; color: ${isOverdue ? '#dc2626' : (isUnselected ? '#d97706' : '#16a34a')}; display: flex; align-items: center; justify-content: space-between;">
          ${isOverdue ? '⚠️ OVERDUE TASKS' : '✅ ON-TRACK TASKS'}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#ffffff;">
          <thead>
            <tr style="background:#f8fafc; border-bottom: 2px solid #e2e8f0;">
              <th style="padding:12px 8px;text-align:left;color:#475569;font-weight:600;">Task</th>
              ${isUnselected
        ? '<th style="padding:12px 8px;text-align:left;color:#475569;font-weight:600;">Reason</th>'
        : '<th style="padding:12px 8px;text-align:left;color:#475569;font-weight:600;">Project</th>'}
              <th style="padding:12px 8px;text-align:center;color:#475569;font-weight:600;">Progress</th>
              ${isUnselected ? '' : '<th style="padding:12px 8px;text-align:center;color:#475569;font-weight:600;">Timeline</th>'}
              ${isUnselected ? '<th style="padding:12px 8px;text-align:center;color:#475569;font-weight:600;">Next Target</th>' : ''}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fafafa;">
      <div style="background: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px; border-left: 4px solid #2563eb;">
        <h2 style="color: #1e3a8a; margin-top: 0; margin-bottom: 8px;">📋 Daily Plan Submitted</h2>
        <p style="margin: 4px 0; color: #475569;"><strong>Employee:</strong> <span style="color:#0f172a;">${employeeName} (${employeeCode})</span></p>
        <p style="margin: 4px 0; color: #475569;"><strong>Date:</strong> <span style="color:#0f172a;">${date}</span></p>
      </div>

      <h3 style="color: #0f172a; margin-top: 24px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">🎯 Selected Tasks (${selectedTasks.length})</h3>
      ${selectedTasks.length === 0 ? '<p style="color:#64748b; font-style:italic; text-align:center; padding: 15px;">No tasks selected.</p>' : ''}
      ${renderTable(overdueSelectedTasks.map(t => generateTaskRow(t)).join(''), false, true)}
      ${renderTable(onTrackSelectedTasks.map(t => generateTaskRow(t)).join(''), false, false)}

      ${unselectedTasks.length > 0 ? `
      <h3 style="color: #0f172a; margin-top: 32px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">⏭️ Tasks Not Selected (${unselectedTasks.length}) — Requires Review</h3>
      ${renderTable(overdueUnselectedTasks.map(t => generateTaskRow(t, true)).join(''), true, true)}
      ${renderTable(onTrackUnselectedTasks.map(t => generateTaskRow(t, true)).join(''), true, false)}
      ` : ''}
      
      <div style="margin-top: 30px; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
        Auto-generated by Time Strap
      </div>
    </div>
  `;

  console.log("[DAILY PLAN EMAIL] Sending to:", NOTIFICATION_RECIPIENTS);
  return await sendEmail({ to: NOTIFICATION_RECIPIENTS, subject, html });
}

export async function sendDailyPlanReminderEmail(data: { recipients: string[], pendingTasks?: string[] }) {
  try {
    const { recipients = [], pendingTasks = [] } = data;

    // Validate recipients
    const { valid: validRecipients, invalid: invalidRecipients } = validateEmailList(recipients);

    if (validRecipients.length === 0) {
      console.error(`[REMINDER EMAIL] No valid recipients. Invalid: ${invalidRecipients.join(', ')}`);
      return {
        success: false,
        error: "No valid recipient emails",
        details: { invalidRecipients }
      };
    }

    const currentDate = format(new Date(), 'MMMM dd, yyyy');
    const subject = `Action Required: Submit Your Plan for the Day - ${currentDate}`;

    // Safely construct task list HTML
    let taskListHtml = '';
    if (Array.isArray(pendingTasks) && pendingTasks.length > 0) {
      try {
        const validTasks = pendingTasks
          .filter((t: any) => t && typeof t === 'string')
          .slice(0, 10);

        if (validTasks.length > 0) {
          taskListHtml = `
            <div style="margin: 24px 0; padding: 16px; background: linear-gradient(135deg, #fef3c7 0%, #fef08a 100%); border-left: 4px solid #f59e0b; border-radius: 8px;">
              <p style="margin-top: 0; font-weight: 700; color: #92400e; font-size: 14px;">📋 Assigned Tasks Pending Review:</p>
              <ul style="margin-bottom: 0; padding-left: 20px; color: #78350f; line-height: 1.8;">
                ${validTasks.slice(0, 5).map((t: string) => `<li style="margin-bottom: 6px;">${String(t).substring(0, 100)}</li>`).join('')}
                ${validTasks.length > 5 ? `<li style="margin-top: 8px; font-style: italic; color: #b45309;">...and ${validTasks.length - 5} more task(s)</li>` : ''}
              </ul>
            </div>
          `;
        }
      } catch (taskErr) {
        console.warn(`[REMINDER EMAIL] Error constructing task list HTML:`, taskErr);
        taskListHtml = '';
      }
    }

    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e40af 0%, #0f172a 100%); padding: 32px 24px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Plan for the Day</h1>
            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Submission Window: 9:00 AM - 12:00 Noon</p>
          </div>

          <!-- Main Content -->
          <div style="padding: 32px 24px;">
            <p style="margin-top: 0; font-size: 16px; color: #374151; line-height: 1.6;">
              Dear Team Member,
            </p>
            
            <p style="font-size: 16px; color: #374151; line-height: 1.6;">
              This is a reminder to submit your <strong>Plan for the Day</strong> for <strong>${currentDate}</strong>.
            </p>

            <p style="font-size: 14px; color: #6b7280; line-height: 1.6; margin-bottom: 8px;">
              <strong>⏰ Important Timeline:</strong>
            </p>
            <ul style="list-style: none; padding: 0; margin: 0 0 24px 0; color: #374151; font-size: 14px;">
              <li style="padding: 8px 0; padding-left: 20px; position: relative;">
                <span style="position: absolute; left: 0;">📌</span>
                <strong>Submission Period:</strong> 9:00 AM - 12:00 Noon
              </li>
              <li style="padding: 8px 0; padding-left: 20px; position: relative;">
                <span style="position: absolute; left: 0;">🔒</span>
                <strong>Portal Closes:</strong> 12:00 Noon
              </li>
              <li style="padding: 8px 0; padding-left: 20px; position: relative;">
                <span style="position: absolute; left: 0;">⚠️</span>
                <strong>Deadline:</strong> No submissions accepted after 12:00 Noon
              </li>
            </ul>

            ${taskListHtml}

            <!-- CTA Button -->
            <div style="margin: 32px 0; text-align: center;">
              <a href="${appUrl}/plan-for-today" 
                 style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); transition: transform 0.2s;">
                 Submit Your Plan Now →
              </a>
            </div>

            <!-- Instruction -->
            <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="margin: 0; color: #065f46; font-size: 13px; line-height: 1.6;">
                <strong>How to proceed:</strong> Click the button above or log in to the Time Strap portal to submit your plan for today. Include all planned tasks, estimated hours, and any relevant project information.
              </p>
            </div>

            <!-- Footer Info -->
            <p style="font-size: 13px; color: #9ca3af; margin-top: 24px; line-height: 1.6;">
              If you have any questions or require assistance, please contact your manager or the HR department immediately.
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f3f4f6; padding: 20px 24px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">
              Time Strap - Automated System
            </p>
            <p style="margin: 6px 0 0 0; font-size: 11px; color: #9ca3af;">
              This is an automated message. Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    console.log(`[REMINDER EMAIL] Sending reminder to ${validRecipients.length} valid recipient(s)`);
    if (invalidRecipients.length > 0) {
      console.warn(`[REMINDER EMAIL] Skipped invalid recipients: ${invalidRecipients.join(', ')}`);
    }

    const result = await sendEmail({ to: validRecipients, subject, html, maxRetries: 2 });

    if (result.success) {
      console.log(`[REMINDER EMAIL] ✓ Successfully sent to ${result.details?.recipientCount} recipients`);
    } else {
      console.error(`[REMINDER EMAIL] ✗ Failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[REMINDER EMAIL] Uncaught error:`, err);
    return {
      success: false,
      error: `Email send error: ${errorMsg}`,
      details: { originalError: err }
    };
  }
}

/* ============================
   PORTAL CLOSED NOTIFICATION EMAIL
   Sent at 12:00 Noon when submission window closes
============================ */
export async function sendPortalClosedNotificationEmail(data: {
  recipients: string[];
  missedSubmissionType: 'daily_plan' | 'timesheet' | 'both';
  date: string;
}) {
  const { recipients = [], missedSubmissionType, date } = data;

  // Validate recipients
  const { valid: validRecipients, invalid: invalidRecipients } = validateEmailList(recipients);

  if (validRecipients.length === 0) {
    console.error(`[PORTAL CLOSED EMAIL] No valid recipients. Invalid: ${invalidRecipients.join(', ')}`);
    return {
      success: false,
      error: "No valid recipient emails",
      details: { invalidRecipients }
    };
  }

  const subject = `Submission Deadline Passed - Action Required - ${date}`;

  const missingItemsText =
    missedSubmissionType === 'daily_plan' ? 'Plan for the Day'
      : missedSubmissionType === 'timesheet' ? 'Timesheet'
        : 'Plan for the Day and Timesheet';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        
        <!-- Header - Alert -->
        <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 32px 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">⏰ Submission Portal Closed</h1>
          <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Date: ${date}</p>
        </div>

        <!-- Main Content -->
        <div style="padding: 32px 24px;">
          <p style="margin-top: 0; font-size: 16px; color: #374151; line-height: 1.6;">
            Dear Team Member,
          </p>
          
          <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #7f1d1d; font-weight: 600; font-size: 15px;">
              ⚠️ The submission portal has been closed at 12:00 Noon (Noon).
            </p>
          </div>

          <p style="font-size: 15px; color: #374151; line-height: 1.6; margin: 20px 0;">
            <strong>Missing Submission:</strong> <span style="color: #dc2626; font-weight: 600;">${missingItemsText}</span>
          </p>

          <p style="font-size: 15px; color: #374151; line-height: 1.6;">
            Your submission for <strong>${date}</strong> was not completed before the deadline. This may impact your attendance and compliance records.
          </p>

          <!-- Action Required Box -->
          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0; color: #92400e; font-weight: 600; font-size: 14px; line-height: 1.6;">
              <strong>🔔 Action Required:</strong><br/>
              Please contact your <strong>HR Department</strong> or <strong>Manager</strong> immediately to resolve this missed submission. They will guide you on the next steps.
            </p>
          </div>

          <!-- Contact Information -->
          <div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 16px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0; color: #0c4a6e; font-weight: 600; font-size: 14px;">📞 Contact Information:</p>
            <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #0c4a6e; font-size: 14px; line-height: 1.8;">
              <li>HR Department - Please respond as soon as possible</li>
              <li>Your Direct Manager - Can provide context for late submission</li>
            </ul>
          </div>

          <!-- Important Notes -->
          <p style="font-size: 13px; color: #6b7280; margin-top: 24px; line-height: 1.6;">
            <strong>Important:</strong> Missed submissions may result in:
          </p>
          <ul style="list-style: none; padding: 0; margin: 0 0 24px 0; color: #6b7280; font-size: 13px;">
            <li style="padding: 6px 0; padding-left: 20px; position: relative;">
              <span style="position: absolute; left: 0;">•</span>
              Attendance mark adjustments
            </li>
            <li style="padding: 6px 0; padding-left: 20px; position: relative;">
              <span style="position: absolute; left: 0;">•</span>
              Compliance record updates
            </li>
            <li style="padding: 6px 0; padding-left: 20px; position: relative;">
              <span style="position: absolute; left: 0;">•</span>
              Managerial review and follow-up
            </li>
          </ul>

          <p style="font-size: 13px; color: #9ca3af; margin-top: 24px; line-height: 1.6;">
            <strong>Submission Reminder:</strong> The portal will reopen tomorrow at 9:00 AM. Please ensure timely submissions going forward.
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f3f4f6; padding: 20px 24px; border-top: 1px solid #e5e7eb; text-align: center;">
          <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">
            Time Strap - Automated System
          </p>
          <p style="margin: 6px 0 0 0; font-size: 11px; color: #9ca3af;">
            This is an automated alert message. Please contact HR if you have questions.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  console.log(`[PORTAL CLOSED EMAIL] Sending portal closure notification to ${validRecipients.length} recipient(s)`);
  if (invalidRecipients.length > 0) {
    console.warn(`[PORTAL CLOSED EMAIL] Skipped invalid recipients: ${invalidRecipients.join(', ')}`);
  }

  const result = await sendEmail({ to: validRecipients, subject, html, maxRetries: 2 });

  if (result.success) {
    console.log(`[PORTAL CLOSED EMAIL] ✓ Successfully sent to ${result.details?.recipientCount} recipients`);
  } else {
    console.error(`[PORTAL CLOSED EMAIL] ✗ Failed: ${result.error}`);
  }

  return result;
}

export async function sendEODSummaryReportEmail(data: {
  recipients: string[],
  date: string,
  summary: { total: number, submitted: number, missing: number, onLeave: number, onOD?: number },
  reportRows: string
}) {
  const { recipients = [], date, summary, reportRows } = data;

  // Validate recipients
  const { valid: validRecipients, invalid: invalidRecipients } = validateEmailList(recipients);

  if (validRecipients.length === 0) {
    console.error(`[EOD REPORT EMAIL] No valid recipients. Invalid: ${invalidRecipients.join(', ')}`);
    return {
      success: false,
      error: "No valid recipient emails for EOD report",
      details: { invalidRecipients }
    };
  }

  const subject = `📊 EOD Summary Report - ${date}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 800px; margin: 0 auto; color: #1e293b; background-color: #f8fafc; padding: 40px; border-radius: 24px;">
      <div style="margin-bottom: 32px;">
        <h2 style="color: #0f172a; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.025em;">Daily EOD Summary</h2>
        <p style="color: #64748b; font-size: 16px; margin-top: 4px;">Status report for ${date}</p>
      </div>

      <div style="display: flex; gap: 16px; margin-bottom: 32px;">
        <div style="flex: 1; background: white; padding: 16px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase;">Total</p>
          <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 800; color: #0f172a;">${summary.total}</p>
        </div>
        <div style="flex: 1; background: white; padding: 16px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase;">Submitted</p>
          <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 800; color: #16a34a;">${summary.submitted}</p>
        </div>
        <div style="flex: 1; background: white; padding: 16px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase;">Missing</p>
          <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 800; color: #ef4444;">${summary.missing}</p>
        </div>
        <div style="flex: 1; background: white; padding: 16px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase;">On Leave</p>
          <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 800; color: #2563eb;">${summary.onLeave}</p>
        </div>
        <div style="flex: 1; background: white; padding: 16px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase;">On OD</p>
          <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 800; color: #6d28d9;">${summary.onOD ?? 0}</p>
        </div>
      </div>
      
      <div style="background: white; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left;">
              <th style="padding: 16px; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">Employee</th>
              <th style="padding: 16px; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">Department</th>
              <th style="padding: 16px; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">Status</th>
              <th style="padding: 16px; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; text-align: center;">Hours</th>
            </tr>
          </thead>
          <tbody>
            ${reportRows}
          </tbody>
        </table>
      </div>
      
      <div style="margin-top: 32px; text-align: center; color: #94a3b8; font-size: 12px;">
        <p>This report was automatically generated by the Time Strap Scheduler.</p>
      </div>
    </div>
  `;

  console.log(`[EOD REPORT EMAIL] Sending EOD report to ${validRecipients.length} valid recipient(s) for date: ${date}`);
  if (invalidRecipients.length > 0) {
    console.warn(`[EOD REPORT EMAIL] Skipped invalid recipients: ${invalidRecipients.join(', ')}`);
  }

  const result = await sendEmail({ to: validRecipients, subject, html, maxRetries: 2 });

  if (result.success) {
    console.log(`[EOD REPORT EMAIL] ✓ Successfully sent to ${result.details?.recipientCount} recipients`);
  } else {
    console.error(`[EOD REPORT EMAIL] ✗ Failed: ${result.error}`);
  }

  return result;
}

export async function sendTaskPostponementEmail(data: {
  recipients: string[];
  taskName: string;
  postponedByDetails: string;
  reason: string;
  newDueDate: string;
  previousDueDate: string;
}) {
  const { recipients, taskName, postponedByDetails, reason, newDueDate, previousDueDate } = data;
  const subject = `Task Deadline Extended: ${taskName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <h2 style="color: #2563eb; border-bottom: 2px solid #bfdbfe; padding-bottom: 12px; margin-top: 0;">📅 Task Deadline Extended</h2>
      <p style="color: #334155; font-size: 15px; margin-bottom: 20px;">A task deadline has been postponed. Below are the details of the extension:</p>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>
          <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; font-weight: 600; background-color: #f8fafc; width: 35%; color: #475569;">Task</td>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; color: #0f172a; font-weight: 500;">${taskName}</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; font-weight: 600; background-color: #f8fafc; color: #475569;">Postponed By</td>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; color: #0f172a;">${postponedByDetails}</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; font-weight: 600; background-color: #f8fafc; color: #475569;">Reason</td>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; font-style: italic; color: #ea580c; background-color: #fff7ed;">"${reason}"</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; font-weight: 600; background-color: #f8fafc; color: #475569;">New Due Date</td>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; font-weight: bold; color: #16a34a; background-color: #f0fdf4;">${newDueDate}</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; font-weight: 600; background-color: #f8fafc; color: #475569;">Previous Due Date</td>
            <td style="padding: 14px 16px; border: 1px solid #e2e8f0; color: #64748b; text-decoration: line-through;">${previousDueDate}</td>
          </tr>
        </tbody>
      </table>
      
      <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #f1f5f9; text-align: center; color: #94a3b8; font-size: 13px;">
        <p>This is an automated notification from the Time Strap System.</p>
      </div>
    </div>
  `;

  console.log(`[POSTPONEMENT EMAIL] Sending to: ${recipients.length} recipients`);
  return await sendEmail({ to: recipients, subject, html });
}

/* ============================
   TIMESHEET CONFIRMATION EMAIL
   Sent to the employee after they submit their timesheet
============================ */
export async function sendTimesheetConfirmationEmail(data: {
  employeeName: string;
  employeeCode: string;
  employeeEmail: string;
  date: string;
  totalHours: string;
  tasks: any[];
}) {
  const { employeeName, employeeCode, employeeEmail, date, totalHours, tasks } = data;
  const subject = `✅ Timesheet Submitted – ${date}`;
  const taskTable = generateTaskTable(tasks);

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);padding:32px 30px;text-align:center;">
        <h1 style="color:#3b82f6;margin:0;font-size:26px;letter-spacing:-0.5px;">⏱ Time Strap</h1>
        <p style="color:#93c5fd;margin:8px 0 0;font-size:15px;">Timesheet Submission Confirmed</p>
      </div>

      <!-- Body -->
      <div style="padding:30px;background:#ffffff;">
        <p style="margin:0 0 20px;font-size:15px;color:#334155;">
          Hi <strong>${employeeName}</strong>, your timesheet for <strong>${date}</strong> has been successfully submitted and is pending approval.
        </p>

        <!-- Summary Card -->
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;color:#475569;font-size:13px;width:150px;">Employee</td>
              <td style="padding:4px 0;color:#0f172a;font-weight:600;">${employeeName} (${employeeCode})</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#475569;font-size:13px;">Date</td>
              <td style="padding:4px 0;color:#0f172a;font-weight:600;">${date}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#475569;font-size:13px;">Total Hours</td>
              <td style="padding:4px 0;color:#2563eb;font-weight:700;font-size:16px;">${totalHours}</td>
            </tr>
          </table>
        </div>

        <!-- Task Table -->
        <h3 style="color:#0f172a;margin:0 0 12px;font-size:15px;border-left:4px solid #3b82f6;padding-left:10px;">Tasks Submitted (${tasks.length})</h3>
        ${taskTable}

        <!-- What's Next -->
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin-top:24px;">
          <p style="margin:0;font-size:13px;color:#92400e;">
            <strong>⏳ What's next?</strong> Your timesheet is now with your reporting manager for approval. You will receive a notification once it is reviewed.
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:18px 30px;background:#f1f5f9;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#64748b;">Automated notification from <strong>Time Strap</strong> — Do not reply to this email.</p>
      </div>
    </div>
  `;

  console.log(`[TIMESHEET CONFIRM EMAIL] Sending to: ${employeeEmail}`);
  return await sendEmail({ to: [employeeEmail], subject, html });
}

/* ============================
   DAILY PLAN CONFIRMATION EMAIL
   Sent to the employee after they submit their Plan for the Day
============================ */
export async function sendDailyPlanConfirmationEmail(data: {
  employeeName: string;
  employeeCode: string;
  employeeEmail: string;
  date: string;
  selectedTasks: { task_name: string; projectName?: string; start_date?: string; end_date?: string; startTime?: string; endTime?: string; start_time?: string; end_time?: string; scheduleData?: any; progress?: number; isOverdue?: boolean }[];
  unselectedTasks: { taskName: string; reason: string; newDueDate: string; start_date?: string; end_date?: string; progress?: number; isOverdue?: boolean }[];
}) {
  const { employeeName, employeeCode, employeeEmail, date, selectedTasks, unselectedTasks } = data;
  const subject = `📋 Plan for the Day Submitted – ${date}`;

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
  const progressBar = (pct: number = 0) => {
    const color = pct === 100 ? '#16a34a' : pct > 0 ? '#2563eb' : '#94a3b8';
    return `<div style="background:#e2e8f0;border-radius:20px;height:6px;width:80px;display:inline-block;vertical-align:middle;">
      <div style="background:${color};height:6px;border-radius:20px;width:${pct}%;"></div>
    </div> <span style="color:${color};font-weight:700;font-size:12px;">${pct}%</span>`;
  };

  const selectedRows = selectedTasks.map(t => {
    // Read actual scheduled times from scheduleData (set by user), fall back to bare startTime/endTime
    const tStart = formatTimelineSafe(t.startTime || t.scheduleData?.startTime || t.start_time);
    const tEnd = formatTimelineSafe(t.endTime || t.scheduleData?.endTime || t.end_time);
    return `
    <tr style="${t.isOverdue ? 'background:#fff7ed;' : ''}">
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;">
        ${t.isOverdue ? '<span style="color:#ef4444;font-size:11px;font-weight:bold;">⚠ OVERDUE </span>' : ''}
        <strong>${t.task_name}</strong>
      </td>
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;">${t.projectName || '—'}</td>
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap;font-size:12px;">
        <div><span style="color:#94a3b8;">Start:</span> ${tStart}</div>
        <div><span style="color:#94a3b8;">End:</span> ${tEnd}</div>
      </td>
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${progressBar(t.progress || 0)}</td>
    </tr>`;
  }).join('');

  // Deferred tasks: Timeline column removed — timeslots are irrelevant for postponed tasks
  const unselectedRows = unselectedTasks.map(t => `
    <tr style="${t.isOverdue ? 'background:#fff7ed;' : ''}">
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;">
        ${t.isOverdue ? '<span style="color:#ef4444;font-size:11px;font-weight:bold;">⚠ OVERDUE </span>' : ''}
        <strong>${t.taskName}</strong>
      </td>
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;font-style:italic;color:#64748b;font-size:13px;">${t.reason}</td>
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${progressBar(t.progress || 0)}</td>
      <td style="padding:10px 10px;border-bottom:1px solid #e2e8f0;color:#d97706;font-weight:bold;font-size:12px;">${formatDate(t.newDueDate)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);padding:32px 30px;text-align:center;">
        <h1 style="color:#3b82f6;margin:0;font-size:26px;">⏱ Time Strap</h1>
        <p style="color:#93c5fd;margin:8px 0 0;font-size:15px;">Plan for the Day — Confirmed</p>
      </div>

      <div style="padding:30px;background:#ffffff;">
        <p style="font-size:15px;color:#334155;margin:0 0 20px;">
          Hi <strong>${employeeName}</strong> 👋, your <strong>Plan for the Day</strong> on <strong>${date}</strong> has been successfully submitted.
        </p>

        <!-- Summary Card -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0;font-size:13px;color:#166534;">
            ✅ <strong>${selectedTasks.length}</strong> task(s) planned for today &nbsp;|&nbsp;
            <span style="color:#92400e;">⏭ <strong>${unselectedTasks.length}</strong> task(s) deferred</span>
          </p>
        </div>

        ${selectedTasks.length > 0 ? `
        <!-- Selected Tasks -->
        <h3 style="color:#0f172a;margin:0 0 10px;font-size:15px;border-left:4px solid #16a34a;padding-left:10px;">🎯 Today's Selected Tasks (${selectedTasks.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
          <thead>
            <tr style="background:#1e293b;color:#fff;">
              <th style="padding:10px;text-align:left;">Task</th>
              <th style="padding:10px;text-align:left;">Project</th>
              <th style="padding:10px;text-align:center;">Timeline</th>
              <th style="padding:10px;text-align:center;">Progress</th>
            </tr>
          </thead>
          <tbody>${selectedRows}</tbody>
        </table>` : ''}

        ${unselectedTasks.length > 0 ? `
        <!-- Deferred Tasks -->
        <h3 style="color:#0f172a;margin:0 0 10px;font-size:15px;border-left:4px solid #f59e0b;padding-left:10px;">⏭ Deferred Tasks (${unselectedTasks.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
          <thead>
            <tr style="background:#78350f;color:#fff;">
              <th style="padding:10px;text-align:left;">Task</th>
              <th style="padding:10px;text-align:left;">Reason</th>
              <th style="padding:10px;text-align:center;">Progress</th>
              <th style="padding:10px;text-align:center;">Next Target</th>
            </tr>
          </thead>
          <tbody>${unselectedRows}</tbody>
        </table>` : ''}

        <div style="background:#f1f5f9;border-radius:10px;padding:14px 18px;">
          <p style="margin:0;font-size:13px;color:#475569;">
            💡 <strong>Tip:</strong> Your reporting manager will review your plan. Make sure to log your timesheet before end of day.
          </p>
        </div>
      </div>

      <div style="padding:18px 30px;background:#f1f5f9;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#64748b;">Automated notification from <strong>Time Strap</strong> — Do not reply.</p>
      </div>
    </div>
  `;

  console.log(`[DAILY PLAN CONFIRM EMAIL] Sending to: ${employeeEmail}`);
  return await sendEmail({ to: [employeeEmail], subject, html });
}

/* ============================
   MISSED SUBMISSION — ADMIN/HR NOTIFICATION
   Sent at end of day to Admins & HR listing employees who
   did not submit their timesheet or daily plan
============================ */
export async function sendMissedSubmissionAdminEmail(data: {
  adminRecipients: string[];
  date: string;
  missedTimesheet: { employeeName: string; employeeCode: string; department?: string }[];
  missedDailyPlan: { employeeName: string; employeeCode: string; department?: string }[];
}) {
  const { adminRecipients, date, missedTimesheet, missedDailyPlan } = data;
  if (adminRecipients.length === 0) return { success: false, error: 'No recipients' };

  const subject = `🚨 End-of-Day Report: Missed Submissions — ${date}`;

  const buildTable = (employees: { employeeName: string; employeeCode: string; department?: string }[], label: string) => {
    if (employees.length === 0) return `<p style="color:#16a34a;font-size:13px;">✅ All employees submitted on time.</p>`;
    return `
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #fca5a5;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#7f1d1d;color:#fff;">
            <th style="padding:10px 12px;text-align:left;">#</th>
            <th style="padding:10px 12px;text-align:left;">Employee</th>
            <th style="padding:10px 12px;text-align:left;">Code</th>
            <th style="padding:10px 12px;text-align:left;">Department</th>
          </tr>
        </thead>
        <tbody>
          ${employees.map((e, i) => `
            <tr style="background:${i % 2 === 0 ? '#fff5f5' : '#ffffff'};">
              <td style="padding:10px 12px;border-bottom:1px solid #fecaca;">${i + 1}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #fecaca;font-weight:600;color:#0f172a;">${e.employeeName}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #fecaca;color:#64748b;">${e.employeeCode}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #fecaca;color:#64748b;">${e.department || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  };

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#7f1d1d 0%,#991b1b 100%);padding:30px;text-align:center;">
        <h1 style="color:#fca5a5;margin:0;font-size:24px;">🚨 End-of-Day Submission Report</h1>
        <p style="color:#fecaca;margin:8px 0 0;font-size:14px;">${date} — Action Required</p>
      </div>

      <div style="padding:28px;background:#ffffff;">
        <p style="font-size:15px;color:#334155;margin:0 0 24px;">
          This is an automated end-of-day report. The following employees <strong>have not submitted</strong> their required records today.
        </p>

        <!-- Missed Timesheets -->
        <h3 style="color:#991b1b;margin:0 0 12px;font-size:16px;border-left:4px solid #ef4444;padding-left:10px;">
          ⏱ Missed Timesheet Submissions (${missedTimesheet.length})
        </h3>
        ${buildTable(missedTimesheet, 'Timesheet')}

        <br/>

        <!-- Missed Daily Plans -->
        <h3 style="color:#92400e;margin:16px 0 12px;font-size:16px;border-left:4px solid #f59e0b;padding-left:10px;">
          📋 Missed Plan for the Day Submissions (${missedDailyPlan.length})
        </h3>
        ${buildTable(missedDailyPlan, 'Daily Plan')}

        <!-- Action Note -->
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:18px 22px;margin-top:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#7f1d1d;font-weight:700;">⚠ Please take the following actions:</p>
          <ul style="margin:0;padding-left:20px;font-size:13px;color:#991b1b;line-height:1.8;">
            <li>Contact each listed employee's Reporting Manager immediately.</li>
            <li>Missing submissions may result in <strong>LOP (Loss of Pay)</strong> as per company policy.</li>
            <li>Verify if any submissions are in draft or pending state in the system.</li>
          </ul>
        </div>
      </div>

      <div style="padding:18px 28px;background:#f1f5f9;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#64748b;">Automated End-of-Day Report from <strong>Time Strap</strong></p>
      </div>
    </div>
  `;

  console.log(`[MISSED SUBMISSION ADMIN EMAIL] Sending to ${adminRecipients.length} admin/HR recipients`);
  return await sendEmail({ to: adminRecipients, subject, html });
}

/* ============================
   LOP WARNING EMAIL
   Sent to individual employees who missed their submission
============================ */
export async function sendLOPWarningEmail(data: {
  employeeName: string;
  employeeEmail: string;
  employeeCode: string;
  date: string;
  missedItems: ('timesheet' | 'daily_plan')[];
  cc?: string[];
}) {
  const { employeeName, employeeEmail, employeeCode, date, missedItems, cc } = data;
  const subject = `⚠ Important: Missed Submission — Possible LOP (${date})`;

  const missedTimesheetBadge = missedItems.includes('timesheet')
    ? `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;margin-bottom:12px;">
        <span style="color:#991b1b;font-weight:700;">⏱ Timesheet Not Submitted</span>
        <p style="margin:6px 0 0;font-size:13px;color:#7f1d1d;">You have not submitted your timesheet for <strong>${date}</strong>.</p>
       </div>` : '';

  const missedPlanBadge = missedItems.includes('daily_plan')
    ? `<div style="background:#fff7ed;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:12px;">
        <span style="color:#92400e;font-weight:700;">📋 Plan for the Day Not Submitted</span>
        <p style="margin:6px 0 0;font-size:13px;color:#78350f;">You have not submitted your Plan for the Day for <strong>${date}</strong>.</p>
       </div>` : '';

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;border:1px solid #fca5a5;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#7f1d1d 0%,#b91c1c 100%);padding:28px 30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">⚠ Action Required</h1>
        <p style="color:#fecaca;margin:8px 0 0;font-size:14px;">Missed Submission — ${date}</p>
      </div>

      <div style="padding:28px;background:#ffffff;">
        <p style="font-size:15px;color:#334155;margin:0 0 20px;">
          Dear <strong>${employeeName}</strong> (${employeeCode}),
        </p>
        <p style="font-size:14px;color:#475569;margin:0 0 20px;">
          Our records indicate that you have <strong>not submitted</strong> the following for <strong>${date}</strong>:
        </p>

        ${missedTimesheetBadge}
        ${missedPlanBadge}

        <!-- LOP Warning -->
        <div style="background:#fef2f2;border-left:5px solid #dc2626;border-radius:0 8px 8px 0;padding:18px 22px;margin-top:20px;">
           <ul style="margin:0;padding:0;list-style:none;font-size:14px;color:#991b1b;line-height:1.8;">
            <li><strong>Seek your Reporting Manager immediately.</strong></li>
            <li><strong>Missing submissions may result in LOP (Loss of Pay) as per company policy.</strong></li>
            <li><strong>Verify if any submissions are in draft or pending state in the system.</strong></li>
            <li><strong>If this continues for more than 2 days, your system access may be locked.</strong></li>
          </ul>
        </div>

        <!-- Instructions -->
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin-top:20px;">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1e40af;">📌 Next Steps</p>
          <ul style="margin:0;padding-left:20px;font-size:13px;color:#1e3a8a;line-height:2;">
            <li>Reach out to <strong>HR</strong> if you believe this was a technical error.</li>
            <li>If you still have access, submit your records through the <strong>Time Strap portal</strong>.</li>
          </ul>
        </div>
      </div>

      <div style="padding:18px 28px;background:#f1f5f9;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#64748b;">Automated notification from <strong>Time Strap</strong> — Please do not reply.</p>
      </div>
    </div>
  `;

  console.log(`[LOP WARNING EMAIL] Sending to: ${employeeEmail}${cc ? ` (CC: ${cc.join(', ')})` : ''}`);
  return await sendEmail({ to: [employeeEmail], cc, subject, html });
}

/* ============================
   PLAN WINDOW CLOSED EMAIL
   Sent when Admin/HR marks the daily plan portal as Closed
============================ */
export async function sendPlanWindowClosedEmail(data: {
  recipients: string[];
  closedBy: string;
  date: string;
}) {
  const { recipients, closedBy, date } = data;
  if (recipients.length === 0) return { success: false, error: 'No recipients' };

  const subject = `🔒 Plan for the Day Portal is Now CLOSED — ${date}`;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);padding:30px;text-align:center;">
        <h1 style="color:#f59e0b;margin:0;font-size:24px;">🔒 Portal Closed</h1>
        <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Plan for the Day Submission Window — ${date}</p>
      </div>

      <div style="padding:28px;background:#ffffff;">
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:20px 24px;margin-bottom:24px;text-align:center;">
          <p style="margin:0;font-size:18px;color:#78350f;font-weight:700;">
            The <strong>Plan for the Day</strong> submission portal is now <strong>CLOSED</strong>.
          </p>
        </div>

        <p style="font-size:14px;color:#475569;line-height:1.8;margin:0 0 16px;">
          The submission window has been closed by <strong>${closedBy}</strong> at ${new Date().toLocaleTimeString('en-IN')} on ${date}.
        </p>

        <!-- Instructions -->
        <div style="background:#fef2f2;border-left:5px solid #dc2626;border-radius:0 8px 8px 0;padding:16px 20px;margin-top:16px;">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#991b1b;">⚠ Submissions are no longer accepted.</p>
          <p style="margin:0;font-size:13px;color:#7f1d1d;line-height:1.7;">
            If you have not submitted your Plan for the Day and need assistance, please:
          </p>
          <ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#7f1d1d;line-height:2;">
            <li>Contact your <strong>Reporting Manager</strong> directly.</li>
            <li>Reach out to the <strong>HR department</strong> for an exception or clarification.</li>
          </ul>
        </div>

        <p style="font-size:13px;color:#64748b;margin-top:20px;text-align:center;">
          This is an automated message. Please do not attempt to submit through the portal at this time.
        </p>
      </div>

      <div style="padding:16px 28px;background:#f1f5f9;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#64748b;">Automated notification from <strong>Time Strap</strong></p>
      </div>
    </div>
  `;

  console.log(`[PLAN CLOSED EMAIL] Sending to ${recipients.length} employees`);
  return await sendEmail({ to: recipients, subject, html });
}
/* -------------------------------------------------------------------------- */
/*                    Admin Approval tab — review emails                      */
/* -------------------------------------------------------------------------- */
function escapeHtmlAdminReview(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Sent to the employee for ONE date on which the admin rejected one or more tasks.
export async function sendAdminReviewRejectionEmail(data: {
  employeeName: string;
  employeeCode: string;
  date: string;
  items: { project: string; task: string; reasons: string[] }[];
  approverName?: string;
  recipients: string[];
}) {
  try {
    const { employeeName, employeeCode, date, items, approverName, recipients } = data;
    const rows = items.map(item => `
      <tr>
        <td style="padding:10px;border:1px solid #334155;vertical-align:top;">
          <strong>${escapeHtmlAdminReview(item.project)}</strong><br/>
          <span style="color:#94a3b8;">${escapeHtmlAdminReview(item.task)}</span>
        </td>
        <td style="padding:10px;border:1px solid #334155;vertical-align:top;color:#fca5a5;">
          ${item.reasons.map(r => `&bull; ${escapeHtmlAdminReview(r)}`).join("<br/>")}
        </td>
      </tr>`).join("");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width:800px; margin:0 auto; background-color:#0f172a; color:#ffffff;">
        <div style="padding:20px;text-align:center;">
          <h1>Time Strap</h1>
          <p>Timesheet Status: <span style="color:#ef4444; font-weight:bold;">Rejected</span></p>
        </div>
        <div style="padding:30px; background:#1e293b; color:#e2e8f0;">
          <p><strong>Employee:</strong> ${escapeHtmlAdminReview(employeeName)} (${escapeHtmlAdminReview(employeeCode)})</p>
          <p><strong>Date rejected:</strong> ${escapeHtmlAdminReview(date)}</p>
          ${approverName ? `<p><strong>Reviewed By:</strong> ${escapeHtmlAdminReview(approverName)}</p>` : ""}
          <table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;">
            <thead>
              <tr style="background-color:#0f172a;color:#ffffff;">
                <th style="padding:10px;border:1px solid #334155;text-align:left;">Project / Task</th>
                <th style="padding:10px;border:1px solid #334155;text-align:left;">Why it was rejected</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:20px;">Please correct the items above and re-apply (resubmit) the timesheet for this date.</p>
        </div>
        <div style="background:#0f172a;padding:15px;text-align:center;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">Automated email from Time Strap System</p>
        </div>
      </div>`;

    return await sendEmail({
      to: recipients,
      subject: `Timesheet Rejected - ${employeeName} (${employeeCode}) - ${date}`,
      html,
    });
  } catch (err) {
    console.error("[ADMIN REVIEW REJECTION EMAIL ERROR]", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Sent to the admin who ran the review: overall report incl. why each date/task was rejected.
export async function sendAdminReviewReportEmail(data: {
  adminName: string;
  employeeName: string;
  employeeCode: string;
  startDate: string;
  endDate: string;
  totals: { approved: number; rejected: number; skipped: number };
  rows: { date: string; project: string; task: string; result: string; reasons: string[] }[];
  recipients: string[];
}) {
  try {
    const { adminName, employeeName, employeeCode, startDate, endDate, totals, rows, recipients } = data;
    const colorFor = (r: string) => (r === "approved" ? "#22c55e" : r === "rejected" ? "#ef4444" : "#94a3b8");
    const body = rows.map(r => `
      <tr>
        <td style="padding:8px;border:1px solid #334155;white-space:nowrap;">${escapeHtmlAdminReview(r.date)}</td>
        <td style="padding:8px;border:1px solid #334155;">${escapeHtmlAdminReview(r.project)}<br/><span style="color:#94a3b8;">${escapeHtmlAdminReview(r.task)}</span></td>
        <td style="padding:8px;border:1px solid #334155;color:${colorFor(r.result)};font-weight:bold;text-transform:uppercase;">${escapeHtmlAdminReview(r.result)}</td>
        <td style="padding:8px;border:1px solid #334155;">${r.reasons.length ? r.reasons.map(x => `&bull; ${escapeHtmlAdminReview(x)}`).join("<br/>") : "&mdash;"}</td>
      </tr>`).join("");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width:900px; margin:0 auto; background-color:#0f172a; color:#ffffff;">
        <div style="padding:20px;text-align:center;">
          <h1>Time Strap</h1>
          <p>Admin Approval Report</p>
        </div>
        <div style="padding:30px; background:#1e293b; color:#e2e8f0;">
          <p><strong>Employee:</strong> ${escapeHtmlAdminReview(employeeName)} (${escapeHtmlAdminReview(employeeCode)})</p>
          <p><strong>Range:</strong> ${escapeHtmlAdminReview(startDate)} to ${escapeHtmlAdminReview(endDate)}</p>
          <p><strong>Run by:</strong> ${escapeHtmlAdminReview(adminName)}</p>
          <p>
            <span style="color:#22c55e;">Approved: ${totals.approved}</span> &nbsp;|&nbsp;
            <span style="color:#ef4444;">Rejected: ${totals.rejected}</span> &nbsp;|&nbsp;
            <span style="color:#94a3b8;">Skipped: ${totals.skipped}</span>
          </p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:12px;">
            <thead>
              <tr style="background-color:#0f172a;color:#ffffff;">
                <th style="padding:8px;border:1px solid #334155;text-align:left;">Date</th>
                <th style="padding:8px;border:1px solid #334155;text-align:left;">Project / Task</th>
                <th style="padding:8px;border:1px solid #334155;text-align:left;">Result</th>
                <th style="padding:8px;border:1px solid #334155;text-align:left;">Reason</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <div style="background:#0f172a;padding:15px;text-align:center;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">Automated email from Time Strap System</p>
        </div>
      </div>`;

    return await sendEmail({
      to: recipients,
      subject: `Admin Approval Report - ${employeeName} (${employeeCode}) - ${startDate} to ${endDate}`,
      html,
    });
  } catch (err) {
    console.error("[ADMIN REVIEW REPORT EMAIL ERROR]", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}