import pkg from 'pg';
const { Pool } = pkg;
import type { QueryResult } from 'pg';

// Initialize Neon PostgreSQL connection pool for PMS database
const pmsDatabaseUrl = process.env.PMS_DATABASE_URL || process.env.DATABASE_URL!;

export const pmsPool = new Pool({
  connectionString: pmsDatabaseUrl,
  ssl: process.env.PMS_DISABLE_SSL === 'true' ? false : {
    rejectUnauthorized: false
  }
});

// Log which PMS database we are connecting to (masked for security)
if (pmsDatabaseUrl) {
  const maskedUrl = pmsDatabaseUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`🔌 PMS Database initialized with host: ${maskedUrl.split('@')[1]?.split('/')[0] || 'Unknown'}`);
}

// PMS Project interface matching Supabase schema
export interface PMSProject {
  id: string;
  project_code: string;
  project_name: string;
  description?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  created_by_emp_code?: string;
  progress_percentage?: number;
  client_name?: string;
  department?: string | string[]; // Legacy single department field or new array
  departments?: string[] | string; // New multiple departments field (array or comma-separated string)
  dept?: string; // Alternative department field name
  department_name?: string; // Alternative department field name
}

// PMS Task interface matching Supabase schema
export interface PMSTask {
  id: string;
  project_id: string;
  key_step_id?: string;
  task_name: string;
  description?: string;
  priority?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  assignee?: string;
  task_members?: string[];
  created_at?: string;
  assigner_id?: string;
  task_owner_id?: string;
  updated_at?: string;
  progress?: number;
  schedule_type?: string;
  schedule_data?: any;
}

// PMS Subtask interface matching Supabase schema
export interface PMSSubtask {
  id: string;
  task_id: string;
  title: string;
  assigned_to?: string;
  is_completed?: boolean;
  progress?: number;
  created_at?: string;
}

// Department name normalization mapping
const normalizeDepartment = (dept: string): string => {
  const normalized = dept.toLowerCase().trim();
  // Map ALL observed variations from the PMS project_departments table
  // to a single canonical department name so cross-system comparisons work.
  const departmentMappings: Record<string, string> = {
    // Software
    'software': 'software',
    'software developer': 'software',
    'software developers': 'software',
    // Finance
    'finance': 'finance',
    // Purchase
    'purchase': 'purchase',
    'purchases': 'purchase',
    // HR
    'hr': 'hr',
    'hr & admin': 'hr',
    'hr and admin': 'hr',
    'human resources': 'hr',
    'human resources & admin': 'hr',
    'human resource': 'hr',
    // Operations
    'operations': 'operations',
    'operation': 'operations',
    // Marketing
    'marketing': 'marketing',
    // Sales
    'sales': 'sales',
    // Admin
    'admin': 'admin',
    'administration': 'admin',
    // IT / IT Support
    'it': 'it support',
    'it support': 'it support',
    'information technology': 'it support',
    'it-support': 'it support',
    // QA
    'qa': 'qa',
    'quality assurance': 'qa',
    'testing': 'qa',
    // Presales
    'presale': 'presales',
    'presales': 'presales',
    'pre-sales': 'presales',
    'pre sales': 'presales',
  };

  return departmentMappings[normalized] || normalized;
};

// Check if two departments are equivalent
const isDepartmentMatch = (userDept: string, projectDept: string): boolean => {
  return normalizeDepartment(userDept) === normalizeDepartment(projectDept);
};

// ---- Tracker visibility helpers -------------------------------------------
// ---- Tracker visibility helpers -------------------------------------------
// Keep only currently active/relevant PMS work visible on the Tracker page.
const DONE_STATUSES = ['completed', 'complete', 'done', 'closed', 'cancelled', 'canceled'];

// Compute today's date in IST (UTC+5:30) as YYYY-MM-DD
export const getISTTodayKey = (): string => {
  const now = new Date();
  const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istNow = new Date(utcNow + (5.5 * 60 * 60 * 1000));
  return istNow.toISOString().split('T')[0];
};

// A task is finished if its status says so, is_completed is true, or progress reached 100%.
export const isPMSTaskCompleted = (task: any): boolean => {
  if (!task) return false;
  const status = String(task.status || '').trim().toLowerCase();
  if (DONE_STATUSES.includes(status)) return true;
  if (task.is_completed === true) return true;
  const progress = Number(task.progress);
  if (!isNaN(progress) && progress >= 100) return true;
  return false;
};

// A task is active if not completed and its deadline has not passed (or it has a recurring schedule).
export const isPMSTaskActive = (task: any, todayKey: string = getISTTodayKey()): boolean => {
  if (!task || isPMSTaskCompleted(task)) return false;

  // Recurring tasks (Daily, Weekly, Monthly) stay active according to their schedule
  if (task.schedule_type && ['Daily', 'Weekly', 'Monthly'].includes(task.schedule_type)) {
    return true;
  }

  const startKey = task.start_date ? String(task.start_date).substring(0, 10) : null;
  const endKey = task.end_date ? String(task.end_date).substring(0, 10) : null;

  if (startKey && startKey > todayKey) return false; // not started yet
  if (endKey && endKey < todayKey) return false;     // deadline is in the past (overdue / lapsed)
  return true;
};

// A project is active when it is not completed AND today falls inside its start..end window.
export const isPMSProjectActive = (project: any, todayKey: string = getISTTodayKey()): boolean => {
  if (!project) return false;
  const status = String(project.status || '').trim().toLowerCase();
  if (DONE_STATUSES.includes(status)) return false;
  const progress = Number(project.progress_percentage ?? project.progress);
  if (!isNaN(progress) && progress >= 100) return false;
  const startKey = project.start_date ? String(project.start_date).substring(0, 10) : null;
  const endKey = project.end_date ? String(project.end_date).substring(0, 10) : null;
  if (startKey && startKey > todayKey) return false; // not started yet
  if (endKey && endKey < todayKey) return false;     // timeline has lapsed (overdue / expired)
  return true;
};

export const getProjects = async (
  userRole?: string,
  userEmpCode?: string,
  userDepartment?: string,
  includeInactive: boolean = false
): Promise<PMSProject[]> => {
  try {
    const isAdmin = userRole === 'admin' || userEmpCode === 'E0001' || userEmpCode === 'E0000';
    const todayKey = getISTTodayKey();

    // 1. Fetch all projects
    const query = `
      SELECT DISTINCT
        p.id,
        p.title as project_name,
        p.project_code,
        p.client_name,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.progress as progress_percentage,
        p.created_at,
        p.updated_at,
        p.created_by_employee_id
      FROM projects p
      ORDER BY p.title
    `;
    const projectsResult: QueryResult = await pmsPool.query(query);
    const allProjects = (projectsResult.rows as any[]) || [];

    // 2. Fetch all project departments
    const deptResult: QueryResult = await pmsPool.query(`
      SELECT project_id, department FROM project_departments
    `);

    const projectDepts: Record<string, string[]> = {};
    deptResult.rows.forEach((row: any) => {
      const projId = row.project_id;
      if (!projectDepts[projId]) projectDepts[projId] = [];
      projectDepts[projId].push(row.department);
    });

    // 3. If employee code is provided, fetch assigned project IDs and employee department from PMS
    let assignedProjectIds = new Set<string>();
    let empPmsId = '';
    let empDeptInPMS = '';
    if (userEmpCode) {
      const empRes = await pmsPool.query(
        `SELECT id, emp_code, department FROM employees WHERE LOWER(TRIM(emp_code)) = LOWER(TRIM($1))`,
        [userEmpCode]
      );
      const empRow = empRes.rows[0];
      if (empRow) {
        empDeptInPMS = empRow.department || '';
        empPmsId = empRow.id || '';
        const empId = empRow.id;

        // Projects where employee is assigned to a task (task member, task owner, or assigner)
        const assignedProjRes = await pmsPool.query(
          `SELECT DISTINCT pt.project_id
           FROM project_tasks pt
           LEFT JOIN task_members tm ON pt.id = tm.task_id
           WHERE tm.employee_id = $1 OR pt.task_owner_id = $1 OR pt.assigner_id = $1`,
          [empId]
        );
        assignedProjRes.rows.forEach((r: any) => {
          if (r.project_id) assignedProjectIds.add(r.project_id);
        });

        // Also check project_members table for direct project membership
        try {
          const memberProjRes = await pmsPool.query(
            `SELECT DISTINCT project_id FROM project_members WHERE employee_id = $1`,
            [empId]
          );
          memberProjRes.rows.forEach((r: any) => {
            if (r.project_id) assignedProjectIds.add(r.project_id);
          });
        } catch (_memberErr) {
          // project_members table may not exist — silently ignore
        }

        // Also include projects created by this employee (using UUID comparison)
        try {
          const createdProjRes = await pmsPool.query(
            `SELECT DISTINCT id FROM projects WHERE created_by_employee_id = $1`,
            [empId]
          );
          createdProjRes.rows.forEach((r: any) => {
            if (r.id) assignedProjectIds.add(r.id);
          });
        } catch (_createdErr) {
          // Silently ignore if column doesn't exist
        }
      }
    }

    const effectiveDept = (userDepartment || empDeptInPMS || '').trim();

    // 4. Enrich projects with their department array
    let enrichedProjects = allProjects.map(p => ({
      ...p,
      department: projectDepts[p.id as any] || []
    }));

    console.log(`📊 PMS getProjects: isAdmin=${isAdmin}, empCode=${userEmpCode}, empPmsId=${empPmsId}, dept=${effectiveDept}, assignedProjCount=${assignedProjectIds.size}, totalProjects=${allProjects.length}`);

    // 5. Strict filtering: department is the PRIMARY gate.
    // Even if user has 'admin' role (e.g. E0046), when they belong to a department
    // (e.g. "Software developer"), their project list MUST be filtered to that department.
    // Only super-admins (E0001/E0000) with no specific department bypass this filter.
    const isSuperAdmin = (userEmpCode === 'E0001' || userEmpCode === 'E0000') && !effectiveDept;

    if (!isSuperAdmin) {
      enrichedProjects = enrichedProjects.filter(p => {
        const pDepts = Array.isArray(p.department)
          ? p.department
          : (typeof p.department === 'string' ? [p.department] : []);

        const isDeptMatch = effectiveDept
          ? pDepts.some((d: string) => isDepartmentMatch(effectiveDept, d))
          : false;

        // Project has explicit dept(s) but NONE match employee dept -> exclude always
        if (pDepts.length > 0 && !isDeptMatch) return false;

        // Project has NO department: fall back to direct task assignment
        if (pDepts.length === 0) {
          return assignedProjectIds.has(String(p.id));
        }

        // Project dept matches employee dept -> show
        return true;
      });
    }

    // 6. Filter out completed and overdue projects unless explicitly requested
    if (!includeInactive) {
      enrichedProjects = enrichedProjects.filter(p => isPMSProjectActive(p, todayKey));
    }

    console.log(`📊 PMS filtered active projects returned: ${enrichedProjects.length} projects`);
    return enrichedProjects;
  } catch (error) {
    console.error("💥 Error connecting to PMS:", error);
    return [];
  }
};

export const getTasks = async (projectId?: string, userDepartment?: string, userEmpCode?: string, userRole?: string): Promise<PMSTask[]> => {
  try {
    const isAdmin = userRole === 'admin' || userEmpCode === 'E0001' || userEmpCode === 'E0000';
    const todayKey = getISTTodayKey();

    let query = 'SELECT *, schedule_type, schedule_data FROM project_tasks ORDER BY task_name';
    const params: any[] = [];

    if (projectId) {
      query = `
        SELECT DISTINCT pt.*, pt.schedule_type, pt.schedule_data FROM project_tasks pt
        INNER JOIN projects p ON pt.project_id = p.id
        LEFT JOIN task_members tm ON pt.id = tm.task_id
        LEFT JOIN employees e ON tm.employee_id = e.id
        LEFT JOIN employees task_owner_employee ON task_owner_employee.id = pt.task_owner_id
        WHERE p.project_code = $1
          AND (pt.status IS NULL OR LOWER(pt.status) NOT IN ('completed', 'complete', 'done', 'closed', 'cancelled', 'canceled'))
          AND (
            LOWER(TRIM(COALESCE(e.emp_code, ''))) = LOWER(TRIM($2))
            OR LOWER(TRIM(COALESCE(task_owner_employee.emp_code, ''))) = LOWER(TRIM($2))
          )
        ORDER BY pt.task_name
      `;
      params.push(projectId, userEmpCode || null);
    } else if (userEmpCode && !isAdmin) {
      query = `
        SELECT DISTINCT pt.*
        FROM project_tasks pt
        INNER JOIN projects p ON pt.project_id = p.id
        LEFT JOIN task_members tm ON pt.id = tm.task_id
        LEFT JOIN employees e ON tm.employee_id = e.id
        LEFT JOIN employees task_owner_employee ON task_owner_employee.id = pt.task_owner_id
        WHERE (
          LOWER(TRIM(COALESCE(e.emp_code, ''))) = LOWER(TRIM($1))
          OR LOWER(TRIM(COALESCE(task_owner_employee.emp_code, ''))) = LOWER(TRIM($1))
        )
          AND (pt.status IS NULL OR LOWER(pt.status) NOT IN ('completed', 'complete', 'done', 'closed', 'cancelled', 'canceled'))
        ORDER BY pt.task_name
      `;
      params.push(userEmpCode);
    }

    const result: QueryResult = await pmsPool.query(query, params);
    let tasks = (result.rows as PMSTask[]) || [];

    // Filter out completed and overdue tasks
    tasks = tasks.filter(t => isPMSTaskActive(t, todayKey));
    return tasks;
  } catch (error) {
    console.error("💥 Error connecting to PMS:", error);
    return [];
  }
};

export const getDepartmentTasks = async (userDepartment: string, userEmpCode: string, userRole: string, myTasksOnly: boolean = false): Promise<any[]> => {
  try {
    const todayKey = getISTTodayKey();

    // Fetch active projects in the department
    const projects = await getProjects(userRole, userEmpCode, userDepartment);
    if (projects.length === 0) return [];

    const projectIds = projects.map(p => p.id);
    const projectMap = projects.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {} as Record<string, any>);

    const query = `
      SELECT DISTINCT pt.*, pt.schedule_type, pt.schedule_data FROM project_tasks pt
      INNER JOIN projects p ON pt.project_id = p.id
      LEFT JOIN task_members tm ON pt.id = tm.task_id
      LEFT JOIN employees e ON tm.employee_id = e.id
      LEFT JOIN employees task_owner_employee ON task_owner_employee.id = pt.task_owner_id
      WHERE pt.project_id = ANY($1)
        AND (pt.status IS NULL OR LOWER(pt.status) NOT IN ('completed', 'complete', 'done', 'closed', 'cancelled', 'canceled'))
        AND (
          LOWER(TRIM(COALESCE(e.emp_code, ''))) = LOWER(TRIM($2))
          OR LOWER(TRIM(COALESCE(task_owner_employee.emp_code, ''))) = LOWER(TRIM($2))
        )
      ORDER BY pt.task_name
    `;
    const queryParams = [projectIds, userEmpCode || null];

    const result: QueryResult = await pmsPool.query(query, queryParams);
    const tasks = result.rows || [];

    // Filter out completed or overdue tasks and enrich with project info
    const activeTasks = tasks
      .filter(t => isPMSTaskActive(t, todayKey))
      .map(task => ({
        ...task,
        project: projectMap[task.project_id]
      }))
      .filter(t => t.project && isPMSProjectActive(t.project, todayKey));

    return activeTasks;
  } catch (error) {
    console.error("💥 Error in getDepartmentTasks:", error);
    return [];
  }
};

export const getTasksByProject = async (projectId: string, userDepartment?: string, userEmpCode?: string, userRole?: string): Promise<PMSTask[]> => {
  try {
    const todayKey = getISTTodayKey();

    const result: QueryResult = await pmsPool.query(
      `SELECT DISTINCT pt.*, pt.schedule_type, pt.schedule_data FROM project_tasks pt
       INNER JOIN projects p ON pt.project_id = p.id
       LEFT JOIN task_members tm ON pt.id = tm.task_id
       LEFT JOIN employees e ON tm.employee_id = e.id
       LEFT JOIN employees task_owner_employee ON task_owner_employee.id = pt.task_owner_id
       WHERE p.project_code = $1
         AND (pt.status IS NULL OR LOWER(pt.status) NOT IN ('completed', 'complete', 'done', 'closed', 'cancelled', 'canceled'))
         AND (
           LOWER(TRIM(COALESCE(e.emp_code, ''))) = LOWER(TRIM($2))
           OR LOWER(TRIM(COALESCE(task_owner_employee.emp_code, ''))) = LOWER(TRIM($2))
         )
       ORDER BY pt.task_name`,
      [projectId, userEmpCode || null]
    );

    let tasks = (result.rows as PMSTask[]) || [];
    tasks = tasks.filter(t => isPMSTaskActive(t, todayKey));
    return tasks;
  } catch (error) {
    console.error("💥 Error connecting to PMS:", error);
    return [];
  }
};

export const getSubtasks = async (taskId?: string, userDepartment?: string, userEmpCode?: string): Promise<PMSSubtask[]> => {
  try {
    console.log("🔍 PMS getSubtasks called with taskId:", taskId, "userDepartment:", userDepartment, "userEmpCode:", userEmpCode);

    let query = `
      SELECT s.*, e.emp_code as assigned_emp_code 
      FROM subtasks s
      LEFT JOIN employees e ON s.assigned_to::text = e.id::text OR s.assigned_to::text = e.emp_code::text
      WHERE (s.is_completed = false OR s.is_completed IS NULL)
        AND (s.progress < 100 OR s.progress IS NULL)
    `;
    const params: any[] = [];
    let paramIdx = 1;

    if (taskId) {
      query += ` AND s.task_id = $${paramIdx}::uuid`;
      params.push(taskId);
      paramIdx++;
    }

    if (userEmpCode) {
      // Show subtasks that are explicitly assigned to this employee OR are unassigned
      // (assigned_to IS NULL). Previously the strict match silently hid all subtasks
      // whose assigned_to column was null, making the Sub Task dropdown appear empty
      // even though the parent task had many subtasks.
      query += ` AND (s.assigned_to IS NULL OR LOWER(s.assigned_to::text) = LOWER($${paramIdx}) OR LOWER(e.emp_code) = LOWER($${paramIdx}))`;
      params.push(userEmpCode);
      paramIdx++;
    }

    console.log("📡 Executing optimized PMS getSubtasks query...");
    const result: QueryResult = await pmsPool.query(query, params);

    let subtasks = result.rows as PMSSubtask[] || [];
    console.log(`📊 PMS subtasks returned: ${subtasks.length} subtasks`);
    return subtasks;
  } catch (error) {
    console.error("💥 Error connecting to PMS:", error);
    return []; // Return empty array on connection issues
  }
};

// Batch-fetch subtasks for a set of parent task IDs in a single query and group
// them by task_id. Used by /api/available-tasks so the Tracker page can show every
// planned task together with its own subtasks instead of issuing one query per task.
// Unlike getSubtasks(), this intentionally does NOT filter out completed subtasks —
// the caller (available-tasks) wants the full parent/child list for every task that
// is currently visible, and completed subtasks should still render (just not hidden).
export const getSubtasksForTaskIds = async (taskIds: string[]): Promise<Record<string, PMSSubtask[]>> => {
  const grouped: Record<string, PMSSubtask[]> = {};
  if (!taskIds || taskIds.length === 0) return grouped;

  try {
    const uniqueIds = Array.from(new Set(taskIds.filter(Boolean)));
    if (uniqueIds.length === 0) return grouped;

    console.log("🔍 PMS getSubtasksForTaskIds called for", uniqueIds.length, "tasks");

    const result: QueryResult = await pmsPool.query(
      `SELECT s.*, e.emp_code as assigned_emp_code
       FROM subtasks s
       LEFT JOIN employees e ON s.assigned_to::text = e.id::text OR s.assigned_to::text = e.emp_code::text
       WHERE s.task_id = ANY($1::uuid[])
       ORDER BY s.created_at ASC NULLS LAST`,
      [uniqueIds]
    );

    const subtasks = (result.rows || []) as PMSSubtask[];
    for (const subtask of subtasks) {
      const key = String(subtask.task_id);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(subtask);
    }

    console.log(`📊 PMS getSubtasksForTaskIds returned ${subtasks.length} subtasks across ${Object.keys(grouped).length} tasks`);
    return grouped;
  } catch (error) {
    console.error("💥 Error in getSubtasksForTaskIds:", error);
    return grouped; // Return whatever we have (empty on failure) so callers degrade gracefully
  }
};

export const getSubtaskById = async (subtaskId: string): Promise<PMSSubtask | null> => {
  try {
    const result: QueryResult = await pmsPool.query(
      'SELECT * FROM subtasks WHERE id = $1::uuid',
      [subtaskId]
    );
    return (result.rows && result.rows[0]) ? (result.rows[0] as PMSSubtask) : null;
  } catch (error) {
    console.error("💥 Error fetching subtask by ID:", error);
    return null;
  }
};

// Update a PMS task (e.g., change end_date) and return updated row
export const updateTaskInPMS = async (taskId: string, updates: { end_date?: string, status?: string }): Promise<PMSTask | null> => {
  try {
    const setParts: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (updates.end_date !== undefined) {
      setParts.push(`end_date = $${idx++}`);
      params.push(updates.end_date);
    }
    if (updates.status !== undefined) {
      setParts.push(`status = $${idx++}`);
      params.push(updates.status);
    }

    if (setParts.length === 0) return null;

    params.push(taskId);
    const query = `UPDATE project_tasks SET ${setParts.join(', ')} WHERE id = $${idx}::uuid RETURNING *`;
    const result: QueryResult = await pmsPool.query(query, params);
    if (result.rows && result.rows.length > 0) {
      return result.rows[0] as PMSTask;
    }
    return null;
  } catch (error) {
    console.error('Error updating task in PMS:', error);
    return null;
  }
};

// Update project progress percentage in PMS
export const updateProjectProgress = async (projectId: string, progress: number): Promise<boolean> => {
  try {
    console.log(`📡 Updating PMS project ${projectId} progress to ${progress}%`);
    // Supports both UUID and project_code
    const result = await pmsPool.query(
      'UPDATE projects SET progress = $1, status = $2, updated_at = NOW() WHERE id::text = $3 OR project_code = $3',
      [progress, progress === 100 ? 'Completed' : 'In Progress', projectId]
    );
    const success = (result.rowCount ?? 0) > 0;
    if (success) {
      console.log(`✅ Successfully updated PMS project ${projectId} progress`);
    } else {
      console.log(`⚠️ No rows updated for PMS project ${projectId}`);
    }
    return success;
  } catch (error) {
    console.error('💥 Error updating project progress in PMS:', error);
    return false;
  }
};
// Update a PMS subtask status
export const updateSubtaskInPMS = async (subtaskId: string, isCompleted: boolean): Promise<PMSSubtask | null> => {
  try {
    console.log(`📡 Updating PMS subtask ${subtaskId} is_completed to ${isCompleted}`);
    const result: QueryResult = await pmsPool.query(
      'UPDATE subtasks SET is_completed = $1 WHERE id = $2::uuid RETURNING *',
      [isCompleted, subtaskId]
    );
    if (result.rows && result.rows.length > 0) {
      console.log(`✅ Successfully updated PMS subtask ${subtaskId}`);
      return result.rows[0] as PMSSubtask;
    }
    console.log(`⚠️ No rows updated for PMS subtask ${subtaskId}`);
    return null;
  } catch (error) {
    console.error('💥 Error updating subtask in PMS:', error);
    return null;
  }
};

// Update a PMS subtask progress and trigger parent update
export const updateSubtaskProgress = async (subtaskId: string, progress: number): Promise<boolean> => {
  try {
    console.log(`📡 Updating PMS subtask ${subtaskId} progress to ${progress}%`);
    const result: QueryResult = await pmsPool.query(
      'UPDATE subtasks SET progress = $1, is_completed = $2, updated_at = NOW() WHERE id = $3::uuid RETURNING task_id',
      [progress, progress === 100, subtaskId]
    );
    if (result.rows && result.rows.length > 0) {
      const taskId = result.rows[0].task_id;
      // We pass 100 as progress if we know it's 100, but updateTaskProgress will recalculate anyway.
      // We don't have the date here easily, so we might need to pass it from routes.ts if we want end_date.
      await updateTaskProgress(taskId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('💥 Error updating subtask progress in PMS:', error);
    return false;
  }
};

// Recalculate task progress based on subtasks
export const updateTaskProgress = async (taskId: string, directProgress?: number, date?: string): Promise<boolean> => {
  try {
    console.log(`🔍 Recalculating progress for task ${taskId}`);
    const subtasks = await getSubtasks(taskId);

    let progress = 0;
    if (subtasks.length > 0) {
      const sum = subtasks.reduce((acc, st) => acc + (Number(st.progress) || 0), 0);
      progress = Math.round(sum / subtasks.length);
    } else if (directProgress !== undefined) {
      progress = directProgress;
    } else {
      // If no subtasks and no direct progress provided, we keep current or default to 0
      // Usually called with directProgress when subtasks don't exist
      return false;
    }

    const setParts = [`progress = $1`, `status = $2`, `updated_at = NOW()`];
    const queryParams: any[] = [progress, progress === 100 ? 'Completed' : 'In Progress'];

    if (progress === 100 && date) {
      setParts.push(`end_date = $${queryParams.length + 1}`);
      queryParams.push(date);
    }

    queryParams.push(taskId);
    const result: QueryResult = await pmsPool.query(
      `UPDATE project_tasks SET ${setParts.join(', ')} WHERE id = $${queryParams.length}::uuid RETURNING key_step_id`,
      queryParams
    );

    if (result.rows && result.rows.length > 0) {
      const keyStepId = result.rows[0].key_step_id;
      if (keyStepId) {
        await updateKeyStepProgress(keyStepId);
      } else {
        // Fallback to project update if no key step
        const taskRes = await pmsPool.query('SELECT project_id FROM project_tasks WHERE id = $1::uuid', [taskId]);
        if (taskRes.rows.length > 0) {
          await updateProjectProgressFromChildren(taskRes.rows[0].project_id);
        }
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('💥 Error updating task progress in PMS:', error);
    return false;
  }
};

// Recalculate key step progress based on tasks
export const updateKeyStepProgress = async (keyStepId: string): Promise<boolean> => {
  try {
    console.log(`🔍 Recalculating progress for key step ${keyStepId}`);
    const tasksRes = await pmsPool.query('SELECT progress FROM project_tasks WHERE key_step_id = $1::uuid', [keyStepId]);
    const tasks = tasksRes.rows;

    let progress = 0;
    if (tasks.length > 0) {
      const sum = tasks.reduce((acc, t) => acc + (Number(t.progress) || 0), 0);
      progress = Math.round(sum / tasks.length);
    }

    const result: QueryResult = await pmsPool.query(
      'UPDATE key_steps SET progress = $1, status = $2, updated_at = NOW() WHERE id = $3::uuid RETURNING project_id',
      [progress, progress === 100 ? 'Completed' : 'In Progress', keyStepId]
    );

    if (result.rows && result.rows.length > 0) {
      await updateProjectProgressFromChildren(result.rows[0].project_id);
      return true;
    }
    return false;
  } catch (error) {
    console.error('💥 Error updating key step progress in PMS:', error);
    return false;
  }
};

// Recalculate project progress based on key steps
export const updateProjectProgressFromChildren = async (projectId: string): Promise<boolean> => {
  try {
    console.log(`🔍 Recalculating progress for project ${projectId}`);
    const keyStepsRes = await pmsPool.query('SELECT progress FROM key_steps WHERE project_id = $1::uuid', [projectId]);
    const keySteps = keyStepsRes.rows;

    let progress = 0;
    if (keySteps.length > 0) {
      const sum = keySteps.reduce((acc, ks) => acc + (Number(ks.progress) || 0), 0);
      progress = Math.round(sum / keySteps.length);
    } else {
      // Fallback: if no key steps, try to average tasks directly
      const tasksRes = await pmsPool.query('SELECT progress FROM project_tasks WHERE project_id = $1::uuid', [projectId]);
      const tasks = tasksRes.rows;
      if (tasks.length > 0) {
        const sum = tasks.reduce((acc, t) => acc + (Number(t.progress) || 0), 0);
        progress = Math.round(sum / tasks.length);
      }
    }

    const result = await pmsPool.query(
      'UPDATE projects SET progress = $1, status = $2, updated_at = NOW() WHERE id::text = $3 OR project_code = $3 OR LOWER(TRIM(title)) = LOWER(TRIM($3)) RETURNING id',
      [progress, progress === 100 ? 'Completed' : 'In Progress', projectId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('💥 Error updating project progress from children in PMS:', error);
    return false;
  }
};

// Helper to get current project progress
export const getProjectProgress = async (projectId: string): Promise<number> => {
  try {
    const res = await pmsPool.query('SELECT progress FROM projects WHERE id::text = $1 OR project_code = $1 OR LOWER(TRIM(title)) = LOWER(TRIM($1))', [projectId]);
    return res.rows[0]?.progress || 0;
  } catch (error) {
    console.error('Error fetching project progress:', error);
    return 0;
  }
};

// Insert site report into PMS database
export const saveSiteReportToPMS = async (report: any) => {
  try {
    console.log(`📡 Saving site report for ${report.projectName} to PMS internal records`);

    // Check if table exists, if not create it (best effort for "internal records")
    await pmsPool.query(`
      CREATE TABLE IF NOT EXISTS site_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id TEXT,
        employee_name TEXT,
        project_name TEXT,
        date TEXT,
        work_category TEXT,
        start_time TEXT,
        end_time TEXT,
        duration TEXT,
        work_done TEXT,
        issues_faced TEXT,
        materials_used TEXT,
        labor_count INTEGER,
        location_lat TEXT,
        location_lng TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const query = `
      INSERT INTO site_reports (
        employee_id, employee_name, project_name, date, work_category, 
        start_time, end_time, duration, work_done, issues_faced, 
        materials_used, labor_count, location_lat, location_lng
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const params = [
      report.employeeId, report.employeeName, report.projectName, report.date, report.workCategory,
      report.startTime, report.endTime, report.duration, report.workDone, report.issuesFaced,
      report.materialsUsed, report.laborCount, report.locationLat, report.locationLng
    ];

    const result = await pmsPool.query(query, params);
    return result.rows[0];
  } catch (error) {
    console.error('💥 Error saving site report to PMS:', error);
    return null;
  }
};