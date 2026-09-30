import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { pool } from "../db";
import { pmsPool } from "../pmsSupabase";
import { lmsPool } from "../lmsSupabase";

// Ensure reports directory exists
const reportsDir = path.join(process.cwd(), "reports");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

function formatDate(d: any): string {
  if (!d) return "N/A";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d;
  }
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "N/A";
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  } catch {
    return "N/A";
  }
}

function generateFileName(reportType: string, format: string): string {
  const timestamp = Date.now();
  return `${reportType}_${timestamp}.${format}`;
}

// ── EXCEL HELPERS ────────────────────────────────────────────────────────────

function styleHeader(sheet: ExcelJS.Worksheet, columns: string[]) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  headerRow.alignment = { horizontal: "center" };
  sheet.columns = columns.map((col) => ({
    header: col,
    key: col.toLowerCase().replace(/ /g, "_"),
    width: 22,
  }));
}

// ── PDF HELPERS ──────────────────────────────────────────────────────────────

function createPDFDoc(title: string, subtitle: string): { doc: PDFKit.PDFDocument; filePath: string } {
  const fileName = generateFileName(title.replace(/ /g, "_"), "pdf");
  const filePath = path.join(reportsDir, fileName);
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(fs.createWriteStream(filePath));

  // Header
  doc.rect(0, 0, doc.page.width, 80).fill("#4F46E5");
  doc.fillColor("#FFFFFF").fontSize(20).font("Helvetica-Bold")
    .text(title, 40, 20, { align: "left" });
  doc.fontSize(11).font("Helvetica")
    .text(subtitle, 40, 50, { align: "left" });
  doc.fillColor("#000000").moveDown(3);

  return { doc, filePath };
}

function pdfTableRow(doc: PDFKit.PDFDocument, cols: string[], isHeader = false) {
  const colWidth = (doc.page.width - 80) / cols.length;
  const y = doc.y;
  if (isHeader) {
    doc.rect(40, y - 4, doc.page.width - 80, 20).fill("#E0E7FF");
    doc.fillColor("#1E1B4B");
  } else {
    doc.fillColor("#111827");
  }
  cols.forEach((col, i) => {
    doc.fontSize(isHeader ? 9 : 8.5)
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .text(col || "N/A", 40 + i * colWidth, y, {
        width: colWidth - 4,
        lineBreak: false,
      });
  });
  doc.moveDown(1.2);
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 1 — Individual Employee Timesheet Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateEmployeeTimesheetReport(
  employeeCode: string,
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT te.date, te.project_name, te.task_description, 
            te.start_time, te.end_time, te.total_hours,
            te.percentage_complete, te.status, te.achievements,
            te.tools_used, e.name as employee_name
     FROM time_entries te
     JOIN employees e ON te.employee_id = e.id
     WHERE LOWER(te.employee_code) = LOWER($1)
       AND te.date BETWEEN $2 AND $3
       AND te.status != 'draft'
     ORDER BY te.date ASC`,
    [employeeCode, startDate, endDate]
  );

  const rows = res.rows;
  const empName = rows[0]?.employee_name || employeeCode;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Timesheet Report");
    styleHeader(ws, ["Date", "Project", "Task", "Start", "End", "Hours", "Progress%", "Status", "Achievements"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:I2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          formatDate(r.date), r.project_name, r.task_description,
          r.start_time, r.end_time, r.total_hours,
          r.percentage_complete, r.status, r.achievements,
        ]);
      });
    }
    const fileName = generateFileName(`timesheet_${employeeCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Timesheet Report — ${empName}`,
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Date", "Project", "Task", "Hours", "Status", "Progress%"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          formatDate(r.date), r.project_name,
          r.task_description?.slice(0, 30),
          r.total_hours, r.status,
          `${r.percentage_complete}%`,
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 2 — Individual Employee Leave Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateEmployeeLeaveReport(
  employeeCode: string,
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await lmsPool.query(
    `SELECT leave_type, start_date, end_date, status, 
            reason, leave_duration_type, username
     FROM leaves
     WHERE LOWER(user_id) = LOWER($1)
       AND start_date BETWEEN $2 AND $3
     ORDER BY start_date ASC`,
    [employeeCode, startDate, endDate]
  );

  const rows = res.rows;
  const empName = rows[0]?.username || employeeCode;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leave Report");
    styleHeader(ws, ["Employee", "Leave Type", "Start Date", "End Date", "Duration", "Status", "Reason"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:G2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          empName, r.leave_type,
          formatDate(r.start_date), formatDate(r.end_date),
          r.leave_duration_type, r.status, r.reason,
        ]);
      });
    }
    const fileName = generateFileName(`leave_${employeeCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Leave Report — ${empName}`,
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Leave Type", "Start", "End", "Duration", "Status", "Reason"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.leave_type, formatDate(r.start_date),
          formatDate(r.end_date), r.leave_duration_type,
          r.status, r.reason?.slice(0, 30),
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 3 — Individual Employee Task Completion Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateEmployeeTaskReport(
  employeeCode: string,
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pmsPool.query(
    `SELECT pt.task_name, pt.status, pt.priority, pt.progress,
            pt.start_date, pt.end_date, pt.completed_at,
            p.title as project_name,
            e.name as employee_name
     FROM project_tasks pt
     JOIN projects p ON pt.project_id = p.id
     JOIN task_members tm ON pt.id = tm.task_id
     JOIN employees e ON tm.employee_id = e.id
     WHERE LOWER(e.emp_code) = LOWER($1)
       AND (pt.start_date BETWEEN $2 AND $3
            OR pt.end_date BETWEEN $2 AND $3)
     ORDER BY pt.end_date ASC NULLS LAST`,
    [employeeCode, startDate, endDate]
  );

  const rows = res.rows;
  const empName = rows[0]?.employee_name || employeeCode;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Task Report");
    styleHeader(ws, ["Project", "Task", "Priority", "Status", "Progress%", "Start Date", "End Date", "Completed At"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:H2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          r.project_name, r.task_name, r.priority,
          r.status, `${r.progress}%`,
          formatDate(r.start_date), formatDate(r.end_date),
          formatDate(r.completed_at),
        ]);
      });
    }
    const fileName = generateFileName(`tasks_${employeeCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Task Report — ${empName}`,
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Project", "Task", "Priority", "Status", "Progress%", "Due Date"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.project_name, r.task_name?.slice(0, 25),
          r.priority, r.status,
          `${r.progress}%`, formatDate(r.end_date),
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 4 — Team Timesheet Compliance Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateTeamTimesheetComplianceReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const allEmpRes = await pool.query(
    `SELECT employee_code, name FROM employees WHERE is_active = true ORDER BY name`
  );

  const submittedRes = await pool.query(
    `SELECT employee_code, COUNT(DISTINCT date) as days_submitted
     FROM time_entries
     WHERE date BETWEEN $1 AND $2
       AND status != 'draft'
     GROUP BY employee_code`,
    [startDate, endDate]
  );

  const submittedMap = new Map(
    submittedRes.rows.map((r) => [r.employee_code, Number(r.days_submitted)])
  );

  const totalDays = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
  ) + 1;

  const rows = allEmpRes.rows.map((e) => ({
    name: e.name,
    code: e.employee_code,
    daysSubmitted: submittedMap.get(e.employee_code) || 0,
    totalDays,
    complianceRate: `${Math.round(((submittedMap.get(e.employee_code) || 0) / totalDays) * 100)}%`,
    status: (submittedMap.get(e.employee_code) || 0) >= totalDays ? "Compliant" : "Non-Compliant",
  }));

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Compliance Report");
    styleHeader(ws, ["Employee", "Code", "Days Submitted", "Total Days", "Compliance Rate", "Status"]);
    rows.forEach((r) => {
      ws.addRow([r.name, r.code, r.daysSubmitted, r.totalDays, r.complianceRate, r.status]);
    });
    const fileName = generateFileName("team_compliance", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Team Timesheet Compliance Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Code", "Days Submitted", "Total Days", "Rate", "Status"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [r.name, r.code, String(r.daysSubmitted), String(r.totalDays), r.complianceRate, r.status]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 5 — Team Attendance/Leave Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateTeamLeaveReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await lmsPool.query(
    `SELECT user_id as employee_code, username as employee_name,
            leave_type, start_date, end_date,
            leave_duration_type, status, reason
     FROM leaves
     WHERE start_date BETWEEN $1 AND $2
     ORDER BY start_date ASC`,
    [startDate, endDate]
  );

  const activeRes = await pool.query(
    "SELECT employee_code FROM employees WHERE is_active = true"
  );
  const activeCodes = new Set(
    activeRes.rows.map((r) => r.employee_code.toLowerCase())
  );

  const rows = res.rows.filter((r) =>
    r.employee_code ? activeCodes.has(r.employee_code.toLowerCase()) : false
  );

  console.log(`[generateTeamLeaveReport] Fetched ${rows.length} leave rows for period ${startDate} to ${endDate} (format: ${format})`);

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leave Report");
    styleHeader(ws, ["Employee", "Code", "Leave Type", "Start", "End", "Duration", "Status", "Reason"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:H2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          r.employee_name, r.employee_code, r.leave_type,
          formatDate(r.start_date), formatDate(r.end_date),
          r.leave_duration_type, r.status, r.reason,
        ]);
      });
    }
    const fileName = generateFileName("team_leave", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Team Attendance & Leave Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Leave Type", "Start", "End", "Duration", "Status"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.employee_name, r.leave_type,
          formatDate(r.start_date), formatDate(r.end_date),
          r.leave_duration_type, r.status,
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 6 — Team Productivity Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateTeamProductivityReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT te.employee_code, te.employee_name,
            COUNT(DISTINCT te.date) as days_worked,
            COUNT(*) as total_entries,
            SUM(
              EXTRACT(HOUR FROM (te.end_time::time - te.start_time::time)) +
              EXTRACT(MINUTE FROM (te.end_time::time - te.start_time::time)) / 60.0
            ) as total_hours,
            AVG(te.percentage_complete) as avg_completion
     FROM time_entries te
     JOIN employees e ON te.employee_id = e.id
     WHERE te.date BETWEEN $1 AND $2
       AND e.is_active = true
     GROUP BY te.employee_code, te.employee_name
     ORDER BY total_hours DESC NULLS LAST`,
    [startDate, endDate]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Productivity Report");
    styleHeader(ws, ["Employee", "Code", "Days Worked", "Total Entries", "Total Hours", "Avg Completion%"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:F2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          r.employee_name, r.employee_code,
          r.days_worked, r.total_entries,
          Number(r.total_hours || 0).toFixed(1),
          `${Number(r.avg_completion || 0).toFixed(0)}%`,
        ]);
      });
    }
    const fileName = generateFileName("team_productivity", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Team Productivity Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Code", "Days Worked", "Entries", "Hours", "Avg%"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.employee_name, r.employee_code,
          String(r.days_worked), String(r.total_entries),
          Number(r.total_hours || 0).toFixed(1),
          `${Number(r.avg_completion || 0).toFixed(0)}%`,
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 7 — Overdue Tasks Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateOverdueTasksReport(
  format: "pdf" | "excel"
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  const res = await pmsPool.query(
    `SELECT pt.task_name, pt.status, pt.priority, pt.progress,
            pt.end_date, p.title as project_name,
            e.name as assigned_to, e.emp_code as employee_code,
            (CURRENT_DATE - pt.end_date::date) as days_overdue
     FROM project_tasks pt
     JOIN projects p ON pt.project_id = p.id
     LEFT JOIN task_members tm ON pt.id = tm.task_id
     LEFT JOIN employees e ON tm.employee_id = e.id
     WHERE pt.end_date < $1
       AND LOWER(pt.status) != 'completed'
     ORDER BY pt.end_date ASC NULLS LAST`,
    [today]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Overdue Tasks");
    styleHeader(ws, ["Project", "Task", "Assigned To", "Priority", "Progress%", "Due Date", "Days Overdue", "Status"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:H2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          r.project_name, r.task_name, r.assigned_to,
          r.priority, `${r.progress}%`,
          formatDate(r.end_date), r.days_overdue, r.status,
        ]);
      });
    }
    const fileName = generateFileName("overdue_tasks", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Overdue Tasks Report",
      `Generated on: ${today}`
    );
    pdfTableRow(doc, ["Project", "Task", "Assigned To", "Priority", "Due Date", "Days Overdue"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.project_name, r.task_name?.slice(0, 25),
          r.assigned_to, r.priority,
          formatDate(r.end_date), String(r.days_overdue),
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 8 — Project Progress Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateProjectProgressReport(
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pmsPool.query(
    `SELECT p.title, p.project_code, p.status, p.progress,
            p.start_date, p.end_date, p.client_name,
            COUNT(pt.id) as total_tasks,
            COUNT(CASE WHEN LOWER(pt.status) = 'completed' THEN 1 END) as completed_tasks,
            COUNT(CASE WHEN pt.end_date < CURRENT_DATE AND LOWER(pt.status) != 'completed' THEN 1 END) as overdue_tasks
     FROM projects p
     LEFT JOIN project_tasks pt ON pt.project_id = p.id
     WHERE LOWER(p.status) = 'in progress'
     GROUP BY p.id, p.title, p.project_code, p.status, p.progress,
              p.start_date, p.end_date, p.client_name
     ORDER BY p.progress ASC`
  );

  const rows = res.rows;
  const today = new Date().toISOString().split("T")[0];

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Project Progress");
    styleHeader(ws, ["Project", "Code", "Client", "Progress%", "Start Date", "End Date", "Total Tasks", "Completed", "Overdue"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:I2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          r.title, r.project_code, r.client_name,
          `${r.progress}%`,
          formatDate(r.start_date), formatDate(r.end_date),
          r.total_tasks, r.completed_tasks, r.overdue_tasks,
        ]);
      });
    }
    const fileName = generateFileName("project_progress", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Project Progress Report",
      `Generated on: ${today}`
    );
    pdfTableRow(doc, ["Project", "Code", "Progress%", "End Date", "Tasks", "Completed", "Overdue"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.title, r.project_code, `${r.progress}%`,
          formatDate(r.end_date),
          String(r.total_tasks), String(r.completed_tasks), String(r.overdue_tasks),
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 9 — Project Task Breakdown Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateProjectTaskBreakdownReport(
  projectCode: string,
  format: "pdf" | "excel"
): Promise<string> {
  const projRes = await pmsPool.query(
    `SELECT id, title FROM projects WHERE LOWER(project_code) = LOWER($1)`,
    [projectCode]
  );

  if (projRes.rows.length === 0) throw new Error(`Project ${projectCode} not found`);

  const project = projRes.rows[0];

  const res = await pmsPool.query(
    `SELECT pt.task_name, pt.status, pt.priority, pt.progress,
            pt.start_date, pt.end_date,
            e.name as assigned_to
     FROM project_tasks pt
     LEFT JOIN task_members tm ON pt.id = tm.task_id
     LEFT JOIN employees e ON tm.employee_id = e.id
     WHERE pt.project_id = $1::uuid
     ORDER BY pt.end_date ASC NULLS LAST`,
    [project.id]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Task Breakdown");
    styleHeader(ws, ["Task", "Assigned To", "Priority", "Status", "Progress%", "Start Date", "End Date"]);
    if (rows.length === 0) {
      const row = ws.addRow(["No records found for the given period"]);
      ws.mergeCells("A2:G2");
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(1).font = { italic: true, color: { argb: "FF888888" } };
    } else {
      rows.forEach((r) => {
        ws.addRow([
          r.task_name, r.assigned_to, r.priority,
          r.status, `${r.progress}%`,
          formatDate(r.start_date), formatDate(r.end_date),
        ]);
      });
    }
    const fileName = generateFileName(`project_tasks_${projectCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Project Task Breakdown — ${project.title}`,
      `Project Code: ${projectCode}`
    );
    pdfTableRow(doc, ["Task", "Assigned To", "Priority", "Status", "Progress%", "Due Date"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.task_name?.slice(0, 28), r.assigned_to,
          r.priority, r.status,
          `${r.progress}%`, formatDate(r.end_date),
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

export async function generateDetailedTimesheetReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT 
      e.name as employee_name,
      te.date,
      te.project_name,
      te.task_description as task_name,
      te.start_time,
      te.end_time,
      te.total_hours,
      te.status
     FROM time_entries te
     JOIN employees e ON te.employee_code = e.employee_code
     WHERE te.date BETWEEN $1 AND $2
     AND te.status != 'draft'
     ORDER BY te.date, e.name, te.start_time`,
    [startDate, endDate]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Detailed Timesheet");

    // Header
    ws.columns = [
      { header: "Employee",     key: "employee_name", width: 22 },
      { header: "Date",         key: "date",          width: 14 },
      { header: "Project",      key: "project_name",  width: 28 },
      { header: "Task",         key: "task_name",     width: 35 },
      { header: "Start Time",   key: "start_time",    width: 12 },
      { header: "End Time",     key: "end_time",      width: 12 },
      { header: "Total Hours",  key: "total_hours",   width: 12 },
      { header: "Status",       key: "status",        width: 16 },
    ];

    // Style header row
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F3F8F' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Add rows
    rows.forEach(row => ws.addRow(row));

    // Alternate row colors
    for (let i = 2; i <= rows.length + 1; i++) {
      if (i % 2 === 0) {
        ws.getRow(i).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0FF' } };
        });
      }
    }

    const filename = `Detailed_Timesheet_${startDate}_to_${endDate}_${Date.now()}.xlsx`;
    const filepath = path.join(reportsDir, filename);
    await wb.xlsx.writeFile(filepath);
    return filename;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Detailed Timesheet Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Date", "Project", "Task", "Start", "End", "Hours", "Status"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.employee_name,
          formatDate(r.date),
          r.project_name?.slice(0, 16),
          r.task_name?.slice(0, 20),
          r.start_time,
          r.end_time,
          r.total_hours?.toString(),
          r.status
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

export async function generateDailyPlanReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT 
      e.name as employee_name,
      dp.date,
      pt.project_name,
      pt.task_name,
      pt.schedule_data,
      pt.status,
      pt.source
     FROM plan_tasks pt
     JOIN daily_plans dp ON pt.plan_id = dp.id
     JOIN employees e ON dp.employee_id = e.id
     WHERE dp.date BETWEEN $1 AND $2
     ORDER BY dp.date, e.name, (pt.schedule_data->>'order')::int`,
    [startDate, endDate]
  );

  const rows = res.rows.map(row => ({
    employee_name: row.employee_name,
    date:          row.date,
    project_name:  row.project_name,
    task_name:     row.task_name,
    start_time:    row.schedule_data?.startTime || '—',
    end_time:      row.schedule_data?.endTime   || '—',
    duration:      row.schedule_data?.durationMinutes 
                     ? `${row.schedule_data.durationMinutes} min` 
                     : '—',
    status:        row.status,
    source:        row.source
  }));

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Daily Plan Report");

    ws.columns = [
      { header: "Employee",     key: "employee_name", width: 22 },
      { header: "Date",         key: "date",          width: 14 },
      { header: "Project",      key: "project_name",  width: 28 },
      { header: "Task",         key: "task_name",     width: 35 },
      { header: "Start Time",   key: "start_time",    width: 12 },
      { header: "End Time",     key: "end_time",      width: 12 },
      { header: "Duration",     key: "duration",      width: 12 },
      { header: "Status",       key: "status",        width: 16 },
      { header: "Source",       key: "source",        width: 12 },
    ];

    ws.getRow(1).eachCell(cell => {
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F3F8F' } };
      cell.alignment = { horizontal: 'center' };
    });

    rows.forEach((row, idx) => {
      const excelRow = ws.addRow(row);
      if (idx % 2 === 0) {
        excelRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0FF' } };
        });
      }
    });

    const filename = `Daily_Plan_${startDate}_to_${endDate}_${Date.now()}.xlsx`;
    const filepath = path.join(reportsDir, filename);
    await wb.xlsx.writeFile(filepath);
    return filename;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Daily Plan Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Date", "Project", "Task", "Start", "End", "Dur", "Status", "Src"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.employee_name,
          formatDate(r.date),
          r.project_name?.slice(0, 12),
          r.task_name?.slice(0, 16),
          r.start_time,
          r.end_time,
          r.duration,
          r.status,
          r.source
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

export async function generateDailyPlanPerEmployeeReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT 
      e.name as employee_name,
      dp.date,
      pt.project_name,
      pt.task_name,
      pt.schedule_data->>'startTime' as start_time,
      pt.schedule_data->>'endTime'   as end_time,
      pt.schedule_data->>'durationMinutes' as duration_minutes,
      pt.status,
      pt.source
     FROM plan_tasks pt
     JOIN daily_plans dp ON pt.plan_id = dp.id
     JOIN employees e ON dp.employee_id = e.id
     WHERE dp.date BETWEEN $1 AND $2
     ORDER BY e.name, dp.date, (pt.schedule_data->>'order')::int NULLS LAST`,
    [startDate, endDate]
  );

  const rows = res.rows;

  const employeesMap = new Map<string, any[]>();
  rows.forEach(r => {
    const name = r.employee_name || "Unknown";
    if (!employeesMap.has(name)) {
      employeesMap.set(name, []);
    }
    employeesMap.get(name)!.push(r);
  });

  const formatRange = (sDate: string, eDate: string) => {
    try {
      const s = new Date(sDate);
      const e = new Date(eDate);
      const getMonthName = (d: Date) => {
        const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        return fullMonths[d.getMonth()];
      };
      const startMonth = getMonthName(s);
      const startDay = s.getDate();
      const endMonth = getMonthName(e);
      const endDay = e.getDate();
      const year = e.getFullYear();
      if (startMonth === endMonth) {
        return `${startMonth} ${startDay}–${endDay}, ${year}`;
      } else {
        return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
      }
    } catch {
      return `${sDate} to ${eDate}`;
    }
  };

  const formatLongDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      return `📅 ${weekdays[d.getDay()]}, ${fullMonths[d.getMonth()]} ${d.getDate()}`;
    } catch {
      return `📅 ${dateStr}`;
    }
  };

  const calcRowHeight = (project: string, task: string): number => {
    const pLines = Math.max(1, Math.floor((project || '').length / 34));
    const tLines = Math.max(1, Math.floor((task || '').length / 50));
    const lines  = Math.max(pLines, tLines);
    return Math.max(18, lines * 16);
  };

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    if (employeesMap.size === 0) {
      const ws = wb.addWorksheet("Daily Plan Report");
      ws.addRow(["No data found for the requested period"]);
    } else {
      employeesMap.forEach((empRows, employeeName) => {
        const sheetName = employeeName.substring(0, 30).replace(/[*?:\\/\[\]]/g, '');
        const ws = wb.addWorksheet(sheetName || "Sheet");
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.columns = [
          { key: "project_name", width: 36 },
          { key: "task_name", width: 52 },
          { key: "start_time", width: 10 },
          { key: "end_time", width: 10 },
          { key: "duration", width: 13 },
          { key: "status", width: 15 },
          { key: "source", width: 10 },
        ];
        const titleText = `Daily Plan Report — ${employeeName} | ${formatRange(startDate, endDate)}`;
        const titleRow = ws.addRow([titleText]);
        titleRow.height = 32;
        ws.mergeCells(1, 1, 1, 7);
        const titleCell = titleRow.getCell(1);
        titleCell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A6E" } };
        titleCell.alignment = { vertical: "middle", horizontal: "center" };
        const datesMap = new Map<string, any[]>();
        empRows.forEach(r => {
          const d = r.date;
          if (!datesMap.has(d)) datesMap.set(d, []);
          datesMap.get(d)!.push(r);
        });
        const sortedDates = Array.from(datesMap.keys()).sort();
        sortedDates.forEach((dateStr) => {
          if (ws.rowCount > 1) ws.addRow([]);
          const dateRow = ws.addRow([formatLongDate(dateStr)]);
          dateRow.height = 22;
          ws.mergeCells(ws.rowCount, 1, ws.rowCount, 7);
          const dateCell = dateRow.getCell(1);
          dateCell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
          dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E4057" } };
          dateCell.alignment = { vertical: "middle", horizontal: "left" };
          const headerRow = ws.addRow(["Project", "Task", "Start", "End", "Duration", "Status", "Source"]);
          headerRow.height = 20;
          headerRow.eachCell(cell => {
            cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };
            cell.alignment = { vertical: "middle", horizontal: "center" };
          });
          const dateTasks = datesMap.get(dateStr)!;
          const mappedTasks = dateTasks.map(t => {
            const st = t.start_time || '—', et = t.end_time || '—', dur = t.duration_minutes ? `${t.duration_minutes} min` : '—';
            const isBreak = (t.project_name || '').toLowerCase() === 'break' || (t.task_name || '').toLowerCase().includes('break');
            return { project_name: t.project_name, task_name: t.task_name, start_time: st, end_time: et, duration: dur, status: t.status, source: t.source, isBreak };
          });
          mappedTasks.sort((a, b) => {
            if (a.isBreak !== b.isBreak) return a.isBreak ? 1 : -1;
            return (a.start_time || '').localeCompare(b.start_time || '');
          });
          let workRowIdx = 0;
          mappedTasks.forEach(task => {
            const taskRow = ws.addRow([task.project_name || '—', task.task_name || '—', task.start_time, task.end_time, task.duration, task.status || '—', task.source || '—']);
            taskRow.height = calcRowHeight(task.project_name, task.task_name);
            let fillColor = 'FFFFFFFF';
            const project = task.project_name || '', status = task.status || '';
            if (project.toLowerCase() === 'break') fillColor = 'FFFFF8E1';
            else if (status === 'pending') fillColor = 'FFFCE8E8';
            else if (status === 'approved' || status === 'manager_approved' || status === 'on_hold') fillColor = 'FFE8F5E9';
            else fillColor = (workRowIdx % 2 === 0) ? 'FFEEF4FB' : 'FFFFFFFF', workRowIdx++;
            const thinBorder = {
              top: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } },
              bottom: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } },
              left: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } },
              right: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } }
            };
            taskRow.eachCell((cell, colNumber) => {
              cell.font = { name: "Calibri", size: 9 };
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
              cell.border = thinBorder;
              cell.alignment = { horizontal: (colNumber === 1 || colNumber === 2) ? 'left' : 'center', vertical: 'middle', wrapText: true };
            });
          });
        });
      });
    }
    const filename = `Daily_Plan_Per_Employee_${startDate}_to_${endDate}_${Date.now()}.xlsx`;
    const filepath = path.join(reportsDir, filename);
    await wb.xlsx.writeFile(filepath);
    return filename;
  } else {
    const { doc, filePath } = createPDFDoc("Daily Plan Per Employee", `Period: ${startDate} to ${endDate}`);
    pdfTableRow(doc, ["Employee", "Date", "Project", "Task", "Start", "End", "Dur", "Status", "Src"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280").text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [r.employee_name, formatDate(r.date), r.project_name?.slice(0, 12), r.task_name?.slice(0, 16), r.start_time || '—', r.end_time || '—', r.duration_minutes ? `${r.duration_minutes} min` : '—', r.status, r.source]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}

export async function generateTimesheetPerEmployeeReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT 
      e.name as employee_name,
      te.date,
      te.project_name,
      te.task_description,
      te.start_time,
      te.end_time,
      te.total_hours,
      te.status,
      te.quantify,
      te.achievements,
      te.key_step,
      te.tools_used,
      te.problem_and_issues,
      te.scope_of_improvements,
      te.percentage_complete
     FROM time_entries te
     JOIN employees e ON te.employee_code = e.employee_code
     WHERE te.date BETWEEN $1 AND $2
     ORDER BY e.name, te.date, te.start_time NULLS LAST`,
    [startDate, endDate]
  );

  const rows = res.rows;

  // Group by employee name
  const employeesMap = new Map<string, any[]>();
  rows.forEach(r => {
    const name = r.employee_name || "Unknown";
    if (!employeesMap.has(name)) {
      employeesMap.set(name, []);
    }
    employeesMap.get(name)!.push(r);
  });

  const formatRange = (sDate: string, eDate: string) => {
    try {
      const s = new Date(sDate);
      const e = new Date(eDate);
      const getMonthName = (d: Date) => {
        const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        return fullMonths[d.getMonth()];
      };
      const startMonth = getMonthName(s);
      const startDay = s.getDate();
      const endMonth = getMonthName(e);
      const endDay = e.getDate();
      const year = e.getFullYear();
      if (startMonth === endMonth) {
        return `${startMonth} ${startDay}–${endDay}, ${year}`;
      } else {
        return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
      }
    } catch {
      return `${sDate} to ${eDate}`;
    }
  };

  const formatLongDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      return `📅 ${weekdays[d.getDay()]}, ${fullMonths[d.getMonth()]} ${d.getDate()}`;
    } catch {
      return `📅 ${dateStr}`;
    }
  };

  const calcRowHeight = (fields: { text: string; charsPerLine: number }[]): number => {
    const lineCounts = fields.map(f => 
      Math.max(1, Math.ceil((f.text || '').length / f.charsPerLine))
    );
    const maxLines = Math.max(...lineCounts, 1);
    return Math.max(18, maxLines * 16);
  };

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();

    if (employeesMap.size === 0) {
      const ws = wb.addWorksheet("Timesheet Report");
      ws.addRow(["No data found for the requested period"]);
    } else {
      employeesMap.forEach((empRows, employeeName) => {
        const sheetName = employeeName.substring(0, 30).replace(/[*?:\\/\[\]]/g, '');
        const ws = wb.addWorksheet(sheetName || "Sheet");
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        ws.columns = [
          { key: "project_name", width: 36 },
          { key: "task_name", width: 52 },
          { key: "start_time", width: 10 },
          { key: "end_time", width: 10 },
          { key: "hours", width: 13 },
          { key: "status", width: 15 },
          { key: "quantify", width: 40 },
          { key: "achievements", width: 40 },
          { key: "key_step", width: 25 },
          { key: "tools_used", width: 25 },
          { key: "problems", width: 35 },
          { key: "scope", width: 35 },
          { key: "percentage", width: 12 },
        ];

        // Row 1: Full width title
        const titleText = `Timesheet Report — ${employeeName} | ${formatRange(startDate, endDate)}`;
        const titleRow = ws.addRow([titleText]);
        titleRow.height = 32;
        ws.mergeCells(1, 1, 1, 13);

        const titleCell = titleRow.getCell(1);
        titleCell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A6E" } };
        titleCell.alignment = { vertical: "middle", horizontal: "center" };

        const datesMap = new Map<string, any[]>();
        empRows.forEach(r => {
          const d = r.date;
          if (!datesMap.has(d)) {
            datesMap.set(d, []);
          }
          datesMap.get(d)!.push(r);
        });

        const sortedDates = Array.from(datesMap.keys()).sort();

        sortedDates.forEach((dateStr) => {
          if (ws.rowCount > 1) {
            ws.addRow([]);
          }

          const dateRow = ws.addRow([formatLongDate(dateStr)]);
          dateRow.height = 22;
          ws.mergeCells(ws.rowCount, 1, ws.rowCount, 13);
          const dateCell = dateRow.getCell(1);
          dateCell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
          dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E4057" } };
          dateCell.alignment = { vertical: "middle", horizontal: "left" };

          const headerRow = ws.addRow([
            "Project", "Task", "Start", "End", "Hours", "Status", 
            "Quantify", "Achievements", "Key Step", "Tools Used", 
            "Problems/Issues", "Scope of Improvements", "% Complete"
          ]);
          headerRow.height = 20;
          headerRow.eachCell(cell => {
            cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };
            cell.alignment = { vertical: "middle", horizontal: "center" };
          });

          const dateTasks = datesMap.get(dateStr)!;

          let workRowIdx = 0;
          dateTasks.forEach(task => {
            const toolsText = Array.isArray(task.tools_used) ? task.tools_used.join(", ") : "";
            const pctText = task.percentage_complete !== null && task.percentage_complete !== undefined
              ? `${task.percentage_complete}%`
              : "—";

            const rowData = [
              task.project_name || '—',
              task.task_description || '—',
              task.start_time || '—',
              task.end_time || '—',
              task.total_hours || '—',
              task.status || '—',
              task.quantify || '',
              task.achievements || '',
              task.key_step || '',
              toolsText || '',
              task.problem_and_issues || '',
              task.scope_of_improvements || '',
              pctText
            ];

            const taskRow = ws.addRow(rowData);
            
            taskRow.height = calcRowHeight([
              { text: task.project_name || '', charsPerLine: 34 },
              { text: task.task_description || '', charsPerLine: 50 },
              { text: task.quantify || '', charsPerLine: 38 },
              { text: task.achievements || '', charsPerLine: 38 },
              { text: task.key_step || '', charsPerLine: 24 },
              { text: toolsText, charsPerLine: 24 },
              { text: task.problem_and_issues || '', charsPerLine: 33 },
              { text: task.scope_of_improvements || '', charsPerLine: 33 },
            ]);

            let fillColor = 'FFFFFFFF';
            const status = task.status || '';

            if (status === 'draft') {
              fillColor = 'FFFCE8E8'; // Draft rows (#FCE8E8)
            } else if (status === 'pending' || status === 'submitted') {
              fillColor = 'FFFFF8E1'; // Pending/Submitted rows (#FFF8E1)
            } else if (status === 'approved' || status === 'manager_approved' || status === 'on_hold') {
              fillColor = 'FFE8F5E9'; // Approved rows (#E8F5E9)
            } else {
              fillColor = (workRowIdx % 2 === 0) ? 'FFEEF4FB' : 'FFFFFFFF';
              workRowIdx++;
            }

            const thinBorder = {
              top: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } },
              bottom: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } },
              left: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } },
              right: { style: 'thin' as ExcelJS.BorderStyle, color: { argb: 'FFCCCCCC' } }
            };

            taskRow.eachCell((cell, colNumber) => {
              cell.font = { name: "Calibri", size: 9 };
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
              cell.border = thinBorder;
              
              const isTextHeavy = [1, 2, 7, 8, 9, 10, 11, 12].includes(colNumber);
              if (isTextHeavy) {
                cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
              } else {
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
              }
            });
          });
        });
      });
    }

    const filename = `Timesheet_Per_Employee_${startDate}_to_${endDate}_${Date.now()}.xlsx`;
    const filepath = path.join(reportsDir, filename);
    await wb.xlsx.writeFile(filepath);
    return filename;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Timesheet Per Employee",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Date", "Project", "Task", "Start", "End", "Hours", "Status"], true);
    if (rows.length === 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Oblique").fillColor("#6B7280")
         .text("No records found for the given period", 40, doc.y, { align: "center" });
    } else {
      rows.forEach((r) => {
        pdfTableRow(doc, [
          r.employee_name,
          formatDate(r.date),
          r.project_name?.slice(0, 12),
          r.task_description?.slice(0, 16) || '—',
          r.start_time || '—',
          r.end_time || '—',
          r.total_hours || '—',
          r.status
        ]);
      });
    }
    doc.end();
    return path.basename(filePath);
  }
}
