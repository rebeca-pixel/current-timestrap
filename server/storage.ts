import { db, pool } from "./db";
import { eq, desc, and, gte, lte, inArray, ne } from "drizzle-orm";
import {
  organisations,
  employees,
  timeEntries,
  managers,
  departments,
  groups,
  projects,
  tasks,
  subtasks,
  discussions,
  dailySubmissions,
  dailyPlanSettings,
  alerts,
  siteReports,
  siteReportAttachments,
  type Alert,
  type InsertAlert,
  type DailyPlanSettings,
  type Organisation,
  type InsertOrganisation,
  type Employee,
  type InsertEmployee,
  type TimeEntry,
  type InsertTimeEntry,
  type Manager,
  type InsertManager,
  type Department,
  type InsertDepartment,
  type Group,
  type InsertGroup,
  type Project,     // <-- keep type
  type Task,        // <-- keep type
  type Subtask,      // <-- keep type
  type Discussion,
  type InsertDiscussion,
  type SiteReport,
  type InsertSiteReport,
  type SiteReportAttachment,
  type InsertSiteReportAttachment,
  dailyPlans,
  planTasks,
  type DailyPlan,
  type InsertDailyPlan,
  type PlanTask,
  type InsertPlanTask,
  type DailySubmission,
  type InsertDailySubmission,
} from "@shared/schema";
import { getProjects as getPMSProjects, getTasks as getPMSTasks, getTasksByProject as getPMSTasksByProject, getSubtasks as getPMSSubtasks, type PMSProject, type PMSTask, type PMSSubtask } from "./pmsSupabase";
import bcrypt from "bcryptjs";

export interface IStorage {
  // Organisations
  getOrganisations(): Promise<Organisation[]>;
  getOrganisation(id: string): Promise<Organisation | undefined>;
  createOrganisation(org: InsertOrganisation): Promise<Organisation>;
  updateOrganisation(id: string, org: Partial<InsertOrganisation>): Promise<Organisation | undefined>;
  deleteOrganisation(id: string): Promise<boolean>;

  // Departments  
  getDepartments(): Promise<Department[]>;
  getDepartment(id: string): Promise<Department | undefined>;
  createDepartment(dept: InsertDepartment): Promise<Department>;
  updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department | undefined>;
  deleteDepartment(id: string): Promise<boolean>;

  // Groups
  getGroups(): Promise<Group[]>;
  getGroup(id: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroup(id: string, group: Partial<InsertGroup>): Promise<Group | undefined>;
  deleteGroup(id: string): Promise<boolean>;

  // Projects (NEW)
  getProjects(userRole?: string, userEmpCode?: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: any): Promise<Project>;
  updateProject(id: string, project: Partial<any>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Tasks
  getTasks(projectId?: string, userDepartment?: string, userEmpCode?: string, userRole?: string): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  getTasksByProject(projectCode: string, userDepartment?: string, userEmpCode?: string, userRole?: string): Promise<Task[]>;
  createTask(task: any): Promise<Task>;
  updateTask(id: string, task: Partial<any>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;

  // Subtasks   
  getSubtasks(): Promise<Subtask[]>;
  getSubtask(id: string): Promise<Subtask | undefined>;
  getSubtasksByTask(taskId: string): Promise<Subtask[]>;
  getPMSSubtasks(taskId?: string, userDepartment?: string): Promise<PMSSubtask[]>;
  createSubtask(subtask: any): Promise<Subtask>;
  updateSubtask(id: string, subtask: Partial<any>): Promise<Subtask | undefined>;
  deleteSubtask(id: string): Promise<boolean>;

  // Employees
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: string): Promise<Employee | undefined>;
  getEmployeeByCode(code: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  validateEmployee(code: string, password: string): Promise<Employee | null>;
  updateEmployeePassword(code: string, passwordHash: string): Promise<Employee | undefined>;
  updateEmployeeToolValidation(id: string, enforce: boolean): Promise<Employee | undefined>;

  // Time Entries
  getTimeEntries(): Promise<TimeEntry[]>;
  // Added for the Approvals page — excludes un-submitted 'draft' entries (Plan-for-the-Day
  // only creates drafts; they must not appear for approval until the timesheet is submitted)
  // and can optionally be scoped to a date range so the page doesn't have to load the entire
  // history (which was the cause of the Approvals page becoming unresponsive).
  getApprovalTimeEntries(startDate?: string, endDate?: string): Promise<TimeEntry[]>;
  getTimeEntry(id: string): Promise<TimeEntry | undefined>;
  getTimeEntriesByEmployee(employeeId: string): Promise<TimeEntry[]>;
  // Added for grouped daily email summaries
  getTimeEntriesByEmployeeAndDate(employeeId: string, date: string): Promise<TimeEntry[]>;
  // Added for EOD reports — fetch ALL entries for a given date across all employees
  getTimeEntriesByDate(date: string): Promise<TimeEntry[]>;
  getTimeEntriesByDateRange(startDate: string, endDate: string): Promise<TimeEntry[]>;
  getPendingTimeEntries(): Promise<TimeEntry[]>;
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined>;
  deleteTimeEntry(id: string): Promise<boolean>;
  updateTimeEntryStatus(id: string, status: string, approvedBy?: string, rejectionReason?: string): Promise<TimeEntry | undefined>;
  managerApproveTimeEntry(id: string, managerId: string): Promise<TimeEntry | undefined>;
  adminApproveTimeEntry(id: string, adminId: string): Promise<TimeEntry | undefined>;

  // Managers
  getManagers(): Promise<Manager[]>;
  createManager(manager: InsertManager): Promise<Manager>;
  seedManagers(): Promise<void>;
  seedDefaultEmployees(): Promise<void>;
  getAllTaskPostponements(): Promise<any[]>;
  resubmitTimeEntry(id: string, updateData?: any): Promise<TimeEntry | undefined>;
  reopenTimeEntry(id: string): Promise<TimeEntry | undefined>;
  onHoldTimeEntry(id: string, reason: string, managerId: string): Promise<TimeEntry | undefined>;
  createDiscussion(discussion: InsertDiscussion): Promise<Discussion>;
  getDiscussionsByEntry(entryId: string): Promise<Discussion[]>;
  getDiscussionsByEmployee(employeeId: string): Promise<Discussion[]>;
  getAllDiscussions(): Promise<Discussion[]>;

  // Site reports
  getSiteReports(employeeId?: string): Promise<SiteReport[]>;
  getSiteReport(id: string): Promise<SiteReport | undefined>;
  createSiteReport(report: InsertSiteReport): Promise<SiteReport>;
  updateSiteReport(id: string, report: Partial<InsertSiteReport>): Promise<SiteReport | undefined>;
  getSiteReportAttachments(reportId: string): Promise<SiteReportAttachment[]>;
  createSiteReportAttachment(attachment: InsertSiteReportAttachment): Promise<SiteReportAttachment>;

  // Daily Plans
  createDailyPlan(data: InsertDailyPlan): Promise<DailyPlan>;
  getDailyPlanByDate(employeeId: string, date: string): Promise<DailyPlan | undefined>;
  createPlanTask(data: InsertPlanTask): Promise<PlanTask>;
  getPlanTasks(planId: string): Promise<PlanTask[]>;
  getPlanTasksByEmployeeAndDate(employeeId: string, date: string): Promise<PlanTask[]>;
  getBatchPlanTasksByDateRange(startDate: string, endDate: string): Promise<any[]>;
  updatePlanTask(id: string, updates: Partial<InsertPlanTask>): Promise<PlanTask | undefined>;
  getAllDailyPlans(): Promise<DailyPlan[]>;

  // Daily Submissions
  createDailySubmission(data: InsertDailySubmission): Promise<DailySubmission>;
  getDailySubmissionByDate(employeeId: string, date: string): Promise<DailySubmission | undefined>;
  getDailySubmissionsByDate(date: string): Promise<DailySubmission[]>;
  getDailySubmissionsByDateRange(startDate: string, endDate: string): Promise<DailySubmission[]>;
  getBatchPlanTasksByPlanIds(planIds: string[]): Promise<PlanTask[]>;

  // Password Reset OTPs
  deleteExistingOTPs(employeeCode: string): Promise<void>;
  createOTP(employeeCode: string, otp: string, expiresAt: Date): Promise<void>;
  getValidOTP(employeeCode: string, otp: string): Promise<any>;
  markOTPUsed(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Organisations
  async getOrganisations(): Promise<Organisation[]> {
    return await db.select().from(organisations).orderBy(desc(organisations.createdAt));
  }

  async getOrganisation(id: string): Promise<Organisation | undefined> {
    const [org] = await db.select().from(organisations).where(eq(organisations.id, id));
    return org;
  }

  async createOrganisation(org: InsertOrganisation): Promise<Organisation> {
    const [newOrg] = await db.insert(organisations).values(org).returning();
    return newOrg;
  }

  async updateOrganisation(id: string, org: Partial<InsertOrganisation>): Promise<Organisation | undefined> {
    const [updated] = await db.update(organisations).set(org).where(eq(organisations.id, id)).returning();
    return updated;
  }

  async deleteOrganisation(id: string): Promise<boolean> {
    await db.delete(organisations).where(eq(organisations.id, id));
    return true;
  }

  // Departments
  async getDepartments(): Promise<Department[]> {
    return await db.select().from(departments).orderBy(desc(departments.createdAt));
  }

  async getDepartment(id: string): Promise<Department | undefined> {
    const [dept] = await db.select().from(departments).where(eq(departments.id, id));
    return dept;
  }

  async createDepartment(dept: InsertDepartment): Promise<Department> {
    const [newDept] = await db.insert(departments).values(dept).returning();
    return newDept;
  }

  async updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department | undefined> {
    const [updated] = await db.update(departments).set(dept).where(eq(departments.id, id)).returning();
    return updated;
  }

  async deleteDepartment(id: string): Promise<boolean> {
    await db.delete(departments).where(eq(departments.id, id));
    return true;
  }

  // Groups
  async getGroups(): Promise<Group[]> {
    return await db.select().from(groups).orderBy(desc(groups.createdAt));
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async createGroup(group: InsertGroup): Promise<Group> {
    const [newGroup] = await db.insert(groups).values(group).returning();
    return newGroup;
  }

  async updateGroup(id: string, group: Partial<InsertGroup>): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set(group).where(eq(groups.id, id)).returning();
    return updated;
  }

  async deleteGroup(id: string): Promise<boolean> {
    await db.delete(groups).where(eq(groups.id, id));
    return true;
  }

  // Projects (NEW)
  async getProjects(userRole?: string, userEmpCode?: string, userDepartment?: string): Promise<Project[]> {
    try {
      const pmsProjects = await getPMSProjects(userRole, userEmpCode, userDepartment);
      // Map PMS projects to local Project type
      return pmsProjects.map(pmsProject => ({
        project_code: pmsProject.project_code,
        project_name: pmsProject.project_name,
        description: pmsProject.description || null,
        status: pmsProject.status || null,
        start_date: pmsProject.start_date || null,
        end_date: pmsProject.end_date || null,
      }));
    } catch (error) {
      console.error("Error fetching projects from PMS, falling back to local DB:", error);
      // Fallback to local DB if PMS fails
      return await db.select().from(projects).orderBy(desc(projects.start_date));
    }
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.project_code, id));
    return project;
  }

  async createProject(project: any): Promise<Project> {
    const [newProject] = await db.insert(projects).values(project).returning();
    return newProject;
  }

  async updateProject(id: string, project: Partial<any>): Promise<Project | undefined> {
    const [updatedProject] = await db.update(projects).set(project).where(eq(projects.project_code, id)).returning();
    return updatedProject;
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await db.delete(projects).where(eq(projects.project_code, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Tasks
  async getTasks(projectId?: string, userDepartment?: string, userEmpCode?: string, userRole?: string): Promise<Task[]> {
    try {
      const pmsTasks = await getPMSTasks(projectId, userDepartment, userEmpCode, userRole);
      // Map PMS tasks to local Task type
      return pmsTasks.map(pmsTask => ({
        id: pmsTask.id,
        project_code: pmsTask.project_id, // Map project_id to project_code
        task_name: pmsTask.task_name,
        key_step_id: pmsTask.key_step_id,
        createdAt: pmsTask.created_at ? new Date(pmsTask.created_at) : new Date(),
      }));
    } catch (error) {
      console.error("Error fetching tasks from PMS, falling back to local DB:", error);
      // Fallback to local DB if PMS fails
      if (projectId) {
        return await db.select().from(tasks).where(eq(tasks.project_code, projectId)).orderBy(desc(tasks.createdAt));
      }
      return await db.select().from(tasks).orderBy(desc(tasks.createdAt));
    }
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  }

  async createTask(task: any): Promise<Task> {
    const [newTask] = await db.insert(tasks).values(task).returning();
    return newTask;
  }

  async updateTask(id: string, task: Partial<any>): Promise<Task | undefined> {
    const [updatedTask] = await db.update(tasks).set(task).where(eq(tasks.id, id)).returning();
    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const result = await db.delete(tasks).where(eq(tasks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getTasksByProject(projectCode: string, userDepartment?: string, userEmpCode?: string, userRole?: string): Promise<Task[]> {
    try {
      const pmsTasks = await getPMSTasksByProject(projectCode, userDepartment, userEmpCode, userRole);
      // Map PMS tasks to local Task type
      return pmsTasks.map(pmsTask => ({
        id: pmsTask.id,
        project_code: pmsTask.project_id, // Map project_id to project_code
        task_name: pmsTask.task_name,
        key_step_id: pmsTask.key_step_id,
        createdAt: pmsTask.created_at ? new Date(pmsTask.created_at) : new Date(),
      }));
    } catch (error) {
      console.error("Error fetching tasks by project from PMS, falling back to local DB:", error);
      // Fallback to local DB if PMS fails
      return await db.select().from(tasks).where(eq(tasks.project_code, projectCode));
    }
  }

  // PMS Subtasks
  async getPMSSubtasks(taskId?: string, userDepartment?: string): Promise<PMSSubtask[]> {
    try {
      return await getPMSSubtasks(taskId, userDepartment);
    } catch (error) {
      console.error("Error fetching subtasks from PMS:", error);
      return [];
    }
  }

  // Subtasks
  async getSubtasks(): Promise<Subtask[]> {
    return await db.select().from(subtasks).orderBy(desc(subtasks.createdAt));
  }

  async getSubtask(id: string): Promise<Subtask | undefined> {
    const [subtask] = await db.select().from(subtasks).where(eq(subtasks.id, id));
    return subtask;
  }

  async createSubtask(subtask: any): Promise<Subtask> {
    const [newSubtask] = await db.insert(subtasks).values(subtask).returning();
    return newSubtask;
  }

  async updateSubtask(id: string, subtask: Partial<any>): Promise<Subtask | undefined> {
    const [updatedSubtask] = await db.update(subtasks).set(subtask).where(eq(subtasks.id, id)).returning();
    return updatedSubtask;
  }

  async deleteSubtask(id: string): Promise<boolean> {
    const result = await db.delete(subtasks).where(eq(subtasks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getSubtasksByTask(taskId: string): Promise<Subtask[]> {
    return await db.select().from(subtasks).where(eq(subtasks.task_id, taskId));
  }

  // Employees
  async getEmployees(): Promise<Employee[]> {
    return await db.select().from(employees).orderBy(desc(employees.createdAt));
  }

  async getEmployee(id: string): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.id, id));
    return emp;
  }

  async getEmployeeByCode(code: string): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.employeeCode, code.toUpperCase()));
    return emp;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const hashedPassword = await bcrypt.hash(employee.password, 10);
    const [newEmp] = await db.insert(employees).values({
      ...employee,
      employeeCode: employee.employeeCode.toUpperCase(),
      password: hashedPassword,
    }).returning();
    return newEmp;
  }

  async validateEmployee(code: string, password: string): Promise<Employee | null> {
    const emp = await this.getEmployeeByCode(code);
    if (!emp) return null;

    const isValid = await bcrypt.compare(password, emp.password);
    return isValid ? emp : null;
  }

  async updateEmployeePassword(code: string, passwordHash: string): Promise<Employee | undefined> {
    const [updated] = await db.update(employees)
      .set({ password: passwordHash })
      .where(eq(employees.employeeCode, code.toUpperCase()))
      .returning();
    return updated;
  }

  async updateEmployeeToolValidation(id: string, enforce: boolean): Promise<Employee | undefined> {
    const [updated] = await db.update(employees)
      .set({ enforceToolValidation: enforce })
      .where(eq(employees.id, id))
      .returning();
    return updated;
  }

  // Time Entries
  async getTimeEntries(): Promise<TimeEntry[]> {
    return await db.select().from(timeEntries).orderBy(desc(timeEntries.submittedAt));
  }

  async getApprovalTimeEntries(startDate?: string, endDate?: string): Promise<TimeEntry[]> {
    // Always exclude 'draft' entries: those are created automatically when an employee
    // submits their "Plan for the Day" and must not show up for approval until the
    // employee actually submits the timesheet (submit-daily transitions draft -> pending).
    const conditions = [ne(timeEntries.status, 'draft')];
    if (startDate) conditions.push(gte(timeEntries.date, startDate));
    if (endDate) conditions.push(lte(timeEntries.date, endDate));

    return await db.select().from(timeEntries)
      .where(and(...conditions))
      .orderBy(desc(timeEntries.date), desc(timeEntries.submittedAt));
  }

  async getTimeEntry(id: string): Promise<TimeEntry | undefined> {
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    return entry;
  }

  async getTimeEntriesByEmployee(employeeId: string): Promise<TimeEntry[]> {
    return await db.select().from(timeEntries)
      .where(eq(timeEntries.employeeId, employeeId))
      .orderBy(desc(timeEntries.submittedAt));
  }

  // fetch all entries for a specific employee on a given date, ordered by start time
  async getTimeEntriesByEmployeeAndDate(employeeId: string, date: string): Promise<TimeEntry[]> {
    return await db.select().from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.date, date)
        )
      )
      .orderBy(timeEntries.startTime);
  }

  // fetch ALL entries for a specific date across all employees (used by EOD Reports)
  async getTimeEntriesByDate(date: string): Promise<TimeEntry[]> {
    return await db.select().from(timeEntries).where(eq(timeEntries.date, date));
  }

  async getTimeEntriesByDateRange(startDate: string, endDate: string): Promise<TimeEntry[]> {
    return await db.select().from(timeEntries).where(
      and(
        gte(timeEntries.date, startDate),
        lte(timeEntries.date, endDate)
      )
    );
  }

  async getPendingTimeEntries(): Promise<TimeEntry[]> {
    return await db.select().from(timeEntries)
      .where(eq(timeEntries.status, "pending"))
      .orderBy(desc(timeEntries.submittedAt));
  }

  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    const [existing] = await db.select().from(timeEntries).where(
      and(
        eq(timeEntries.employeeId, entry.employeeId),
        eq(timeEntries.date, entry.date),
        eq(timeEntries.projectName, entry.projectName),
        eq(timeEntries.taskDescription, entry.taskDescription),
        eq(timeEntries.startTime, entry.startTime)
      )
    ).limit(1);

    if (existing) {
      return existing;
    }

    const [newEntry] = await db.insert(timeEntries).values({
      ...entry,
      toolsUsed: entry.toolsUsed || [],
    }).returning();
    return newEntry;
  }

  async updateTimeEntry(id: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined> {
    const [updated] = await db.update(timeEntries)
      .set(data)
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async deleteTimeEntry(id: string): Promise<boolean> {
    await db.delete(timeEntries).where(eq(timeEntries.id, id));
    return true;
  }

  async updateTimeEntryStatus(
    id: string,
    status: string,
    approvedBy?: string,
    rejectionReason?: string
  ): Promise<TimeEntry | undefined> {
    const [updated] = await db.update(timeEntries)
      .set({
        status,
        approvedBy,
        approvedAt: new Date(),
        rejectionReason,
      })
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async managerApproveTimeEntry(id: string, managerId: string): Promise<TimeEntry | undefined> {
    const [updated] = await db.update(timeEntries)
      .set({
        status: "manager_approved",
        managerApprovedBy: managerId,
        managerApprovedAt: new Date(),
      })
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async adminApproveTimeEntry(id: string, adminId: string): Promise<TimeEntry | undefined> {
    const [updated] = await db.update(timeEntries)
      .set({
        status: "approved",
        approvedBy: adminId,
        approvedAt: new Date(),
      })
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  // Managers
  async getManagers(): Promise<Manager[]> {
    return await db.select().from(managers);
  }

  async createManager(manager: InsertManager): Promise<Manager> {
    const [newManager] = await db.insert(managers).values(manager).returning();
    return newManager;
  }

  async seedManagers(): Promise<void> {
    try {
      console.log("🌱 Seeding managers...");
      const existingManagers = await this.getManagers();
      if (existingManagers.length > 0) {
        console.log("✅ Managers already seeded.");
        return;
      }

      const managerList = [
        { name: "Vikram Sen", employeeCode: "MGR003", email: "vikram@ctint.in", department: "Sales" },
        { name: "Neha Thomas", employeeCode: "MGR004", email: "neha@ctint.in", department: "Marketing" },
        { name: "Kiran Dev", employeeCode: "MGR005", email: "kiran@ctint.in", department: "Finance" },
        { name: "Priya Sharma", employeeCode: "MGR006", email: "priya@ctint.in", department: "Operations" },
        { name: "Rahul Gupta", employeeCode: "MGR007", email: "rahul@ctint.in", department: "IT" },
        { name: "Ananya Patel", employeeCode: "MGR008", email: "ananya@ctint.in", department: "Admin" },
        { name: "Arjun Reddy", employeeCode: "MGR009", email: "arjun@ctint.in", department: "Legal" },
        { name: "Meera Nair", employeeCode: "MGR010", email: "meera@ctint.in", department: "Quality" },
        { name: "Sanjay Kumar", employeeCode: "MGR011", email: "sanjay@ctint.in", department: "Support" },
        { name: "Ritu Singh", employeeCode: "MGR012", email: "ritu@ctint.in", department: "Design" },
        { name: "Deepak Joshi", employeeCode: "MGR013", email: "deepak@ctint.in", department: "Research" },
        { name: "Kavitha Menon", employeeCode: "MGR014", email: "kavitha@ctint.in", department: "Training" },
        { name: "Suresh Iyer", employeeCode: "MGR015", email: "suresh@ctint.in", department: "Procurement" },
      ];

      for (const manager of managerList) {
        await this.createManager(manager);
      }
      console.log("✅ Managers seeded successfully.");
    } catch (error) {
      console.error("❌ Error seeding managers:", error);
      // We don't rethrow here to allow server startup to continue even if seeding fails
    }
  }

  async seedDefaultEmployees(): Promise<void> {
    try {
      console.log("🌱 Seeding default employees...");
      const defaultEmployees = [
        { employeeCode: "E0046", name: "Rebeca Suji", email: "rebeca@ctint.in", password: "admin123", role: "admin", department: "Software" },
        { employeeCode: "E0001", name: "Samprakash", email: "sp@ctint.in", password: "admin123", role: "admin", department: "Presales" },
        { employeeCode: "E0002", name: "Leo Celestine", email: "leo@ctint.in", password: "admin123", role: "admin", department: "Software" },
        { employeeCode: "E0041", name: "Mohanraj C", email: "mohan@ctint.in", password: "admin123", role: "employee", department: "Finance" },
        { employeeCode: "E0042", name: "Yuvaraj", password: "admin123", role: "employee", department: "Purchase" },
        { employeeCode: "E0032", name: "Sivaram C", password: "admin123", role: "employee", department: "Operations" },
        { employeeCode: "E0044", name: "Umar Farooque", password: "admin123", role: "employee", department: "Operations" },
        { employeeCode: "E0009", name: "Rajinth", password: "admin123", role: "employee", department: "Operations" },
        { employeeCode: "E0048", name: "Durga Devi", password: "admin123", role: "employee", department: "Software" },
        { employeeCode: "E0047", name: "Samyuktha", email: "samyuktha@ctint.in", password: "admin123", role: "employee", department: "HR & Admin" },
        { employeeCode: "E0049", name: "Pushpa Prithviraj", password: "admin123", role: "hr", department: "HR & Admin" },
        { employeeCode: "E0050", name: "Zameela Begam", password: "admin123", role: "employee", department: "Finance" },
        { employeeCode: "E0051", name: "Arunkumar", password: "admin123", role: "employee", department: "Purchase" },
        { employeeCode: "E0053", name: "S.NAVEEN KUMAR", password: "admin123", role: "employee", department: "IT Support" },
      ];

      const existingEmployees = await this.getEmployees();
      const existingCodes = new Set(existingEmployees.map(e => e.employeeCode));

      for (const emp of defaultEmployees) {
        if (!existingCodes.has(emp.employeeCode)) {
          await this.createEmployee(emp);
          console.log(`Created missing employee: ${emp.employeeCode} (${emp.name})`);
        } else {
          // Correct any known name typos for existing records
          const existing = existingEmployees.find(e => e.employeeCode === emp.employeeCode);
          if (existing && existing.name !== emp.name) {
            await db.update(employees)
              .set({ name: emp.name })
              .where(eq(employees.employeeCode, emp.employeeCode));
            console.log(`Updated name for ${emp.employeeCode}: "${existing.name}" → "${emp.name}"`);
          }
        }
      }

      await this.syncAllPasswords();
      console.log("✅ Default employees seeded/verified successfully.");
    } catch (error) {
      console.error("❌ Error seeding default employees:", error);
    }
  }

  async syncAllPasswords(): Promise<void> {
    try {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await db.update(employees).set({ password: hashedPassword });
      console.log("All employee passwords synced to admin123");
    } catch (error) {
      console.error("Error syncing passwords:", error);
    }
  }

  async getAllTaskPostponements(): Promise<any[]> {
    const result = await pool.query(`
      SELECT 
        tp.id,
        tp.task_id as "taskId",
        tp.task_name as "taskName",
        tp.previous_due_date as "previousDueDate",
        tp.new_due_date as "newDueDate",
        tp.reason,
        tp.postponed_by as "postponedBy",
        tp.postponed_at as "postponedAt",
        tp.postpone_count as "postponeCount",
        e.name as "employeeName",
        e.employee_code as "employeeCode"
      FROM task_postponements tp
      LEFT JOIN employees e ON tp.postponed_by = e.id
      ORDER BY tp.postponed_at DESC
    `);
    return result.rows;
  }

  async resubmitTimeEntry(id: string, updateData: any = {}): Promise<TimeEntry | undefined> {
    const data: any = {
      ...updateData,
      status: "resubmitted",
      rejectionReason: null,
      submittedAt: new Date(),
    };

    const [updated] = await db.update(timeEntries)
      .set(data)
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async reopenTimeEntry(id: string): Promise<TimeEntry | undefined> {
    const [updated] = await db.update(timeEntries)
      .set({
        status: "pending",
        rejectionReason: null,
      })
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async onHoldTimeEntry(id: string, reason: string, managerId: string): Promise<TimeEntry | undefined> {
    const [updated] = await db.update(timeEntries)
      .set({
        status: "on_hold",
        onHoldReason: reason,
        approvedBy: managerId,
        approvedAt: new Date(),
      })
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async createDiscussion(discussion: InsertDiscussion): Promise<Discussion> {
    const [newDiscussion] = await db.insert(discussions).values(discussion).returning();
    return newDiscussion;
  }

  async getDiscussionsByEntry(entryId: string): Promise<Discussion[]> {
    return await db.select().from(discussions)
      .where(eq(discussions.timeEntryId, entryId))
      .orderBy(desc(discussions.createdAt));
  }

  async getDiscussionsByEmployee(employeeId: string): Promise<Discussion[]> {
    return await db.select().from(discussions)
      .where(eq(discussions.employeeId, employeeId))
      .orderBy(desc(discussions.createdAt));
  }

  async getAllDiscussions(): Promise<Discussion[]> {
    return await db.select().from(discussions)
      .orderBy(desc(discussions.createdAt));
  }

  // Site reports
  async getSiteReports(employeeId?: string): Promise<SiteReport[]> {
    if (employeeId) {
      return await db.select().from(siteReports)
        .where(eq(siteReports.employeeId, employeeId))
        .orderBy(desc(siteReports.timestamp));
    }
    return await db.select().from(siteReports)
      .orderBy(desc(siteReports.timestamp));
  }

  async getSiteReport(id: string): Promise<SiteReport | undefined> {
    const [report] = await db.select().from(siteReports).where(eq(siteReports.id, id));
    return report;
  }

  async createSiteReport(report: InsertSiteReport): Promise<SiteReport> {
    const [newReport] = await db.insert(siteReports).values(report).returning();
    return newReport;
  }

  async updateSiteReport(id: string, report: any): Promise<SiteReport | undefined> {
    const [updated] = await db.update(siteReports)
      .set(report)
      .where(eq(siteReports.id, id))
      .returning();
    return updated;
  }

  async getSiteReportAttachments(reportId: string): Promise<SiteReportAttachment[]> {
    return await db.select().from(siteReportAttachments)
      .where(eq(siteReportAttachments.reportId, reportId))
      .orderBy(desc(siteReportAttachments.createdAt));
  }

  async createSiteReportAttachment(attachment: InsertSiteReportAttachment): Promise<SiteReportAttachment> {
    const [newAttachment] = await db.insert(siteReportAttachments).values(attachment).returning();
    return newAttachment;
  }

  // Daily Plans
  async createDailyPlan(data: InsertDailyPlan): Promise<DailyPlan> {
    const [plan] = await db.insert(dailyPlans).values(data).returning();
    return plan;
  }

  async getDailyPlanByDate(employeeId: string, date: string): Promise<DailyPlan | undefined> {
    const [plan] = await db.select().from(dailyPlans).where(
      and(eq(dailyPlans.employeeId, employeeId), eq(dailyPlans.date, date))
    );
    return plan;
  }

  async createPlanTask(data: InsertPlanTask): Promise<PlanTask> {
    const [task] = await db.insert(planTasks).values(data).returning();
    return task;
  }

  async getPlanTasks(planId: string): Promise<PlanTask[]> {
    return await db.select().from(planTasks).where(eq(planTasks.planId, planId));
  }

  async getPlanTasksByEmployeeAndDate(employeeId: string, date: string): Promise<PlanTask[]> {
    const plan = await this.getDailyPlanByDate(employeeId, date);
    if (!plan) return [];
    return await this.getPlanTasks(plan.id);
  }

  async updatePlanTask(id: string, updates: Partial<InsertPlanTask>): Promise<PlanTask | undefined> {
    const [updated] = await db.update(planTasks).set(updates).where(eq(planTasks.id, id)).returning();
    return updated;
  }

  async getAllDailyPlans(): Promise<DailyPlan[]> {
    return await db.select().from(dailyPlans).orderBy(desc(dailyPlans.date));
  }

  // Daily Submissions
  async createDailySubmission(data: InsertDailySubmission): Promise<DailySubmission> {
    const [submission] = await db
      .insert(dailySubmissions)
      .values(data)
      .onConflictDoUpdate({
        target: [dailySubmissions.employeeId, dailySubmissions.date],
        set: {
          totalHours: data.totalHours,
        },
      })
      .returning();
    return submission;
  }

  async getDailySubmissionByDate(employeeId: string, date: string): Promise<DailySubmission | undefined> {
    const [submission] = await db.select().from(dailySubmissions).where(
      and(eq(dailySubmissions.employeeId, employeeId), eq(dailySubmissions.date, date))
    );
    return submission;
  }

  async getDailySubmissionsByDate(date: string): Promise<DailySubmission[]> {
    return await db.select().from(dailySubmissions).where(eq(dailySubmissions.date, date));
  }

  async getDailySubmissionsByDateRange(startDate: string, endDate: string): Promise<DailySubmission[]> {
    return await db.select().from(dailySubmissions).where(
      and(
        gte(dailySubmissions.date, startDate),
        lte(dailySubmissions.date, endDate)
      )
    );
  }

  async getBatchPlanTasksByDateRange(startDate: string, endDate: string): Promise<any[]> {
    try {
      const q = await db.select()
        .from(planTasks)
        .innerJoin(dailyPlans, eq(planTasks.planId, dailyPlans.id))
        .where(
          and(
            gte(dailyPlans.date, startDate),
            lte(dailyPlans.date, endDate)
          )
        );

      return q;
    } catch (error) {
      console.error("Error batch getting plan tasks:", error);
      return [];
    }
  }

  // Alerts
  async createAlert(data: InsertAlert): Promise<Alert> {
    const [alert] = await db.insert(alerts).values(data).returning();
    return alert;
  }

  async getAlertsByEmployee(employeeId: string): Promise<Alert[]> {
    return await db.select().from(alerts).where(eq(alerts.employeeId, employeeId)).orderBy(desc(alerts.createdAt));
  }

  async markAlertAsRead(id: string): Promise<void> {
    await db.update(alerts).set({ isRead: true }).where(eq(alerts.id, id));
  }

  // Daily Plan Settings
  async setDailyPlanClosed(date: string, isClosed: boolean): Promise<void> {
    await db.insert(dailyPlanSettings)
      .values({ date, isClosed, closedAt: isClosed ? new Date() : null })
      .onConflictDoUpdate({
        target: dailyPlanSettings.date,
        set: { isClosed, closedAt: isClosed ? new Date() : null }
      });
  }

  async isDailyPlanClosed(date: string): Promise<boolean> {
    const [settings] = await db.select().from(dailyPlanSettings).where(eq(dailyPlanSettings.date, date));
    return settings?.isClosed || false;
  }

  async getBatchPlanTasksByPlanIds(planIds: string[]): Promise<PlanTask[]> {
    if (planIds.length === 0) return [];
    return await db.select().from(planTasks).where(inArray(planTasks.planId, planIds));
  }

  // Password Reset OTPs
  async deleteExistingOTPs(employeeCode: string): Promise<void> {
    await pool.query('DELETE FROM password_reset_otps WHERE employee_code = $1', [employeeCode]);
  }

  async createOTP(employeeCode: string, otp: string, expiresAt: Date): Promise<void> {
    await pool.query(
      'INSERT INTO password_reset_otps (employee_code, otp, expires_at) VALUES ($1, $2, $3)',
      [employeeCode, otp, expiresAt]
    );
  }

  async getValidOTP(employeeCode: string, otp: string): Promise<any> {
    const result = await pool.query(
      'SELECT * FROM password_reset_otps WHERE employee_code = $1 AND otp = $2 AND used = FALSE AND expires_at > NOW() LIMIT 1',
      [employeeCode, otp]
    );
    return result.rows[0] || null;
  }

  async markOTPUsed(id: number): Promise<void> {
    await pool.query('UPDATE password_reset_otps SET used = TRUE WHERE id = $1', [id]);
  }
}

export const storage = new DatabaseStorage();