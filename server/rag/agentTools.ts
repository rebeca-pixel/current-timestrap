export const HR_TOOLS = [
  "getMyLeaves",
  "viewPendingLeaves",
  "approveLeaveRequest",
  "rejectLeaveRequest",
  "requestLeave",
  "getEmployees",
  "getEmployeeDetail",
  "getAttendanceRiskCheck",
  "approveTimesheet",
  "rejectTimesheet",
  "updateCompanyPolicy",
  "getTeamData",
  "recallMemory",
  "saveMemory",
  "getDraftTimesheets",
  "getPendingApprovals",
  "getTeamInsights",
  "generateReport",
];

export const PROJECT_TOOLS = [
  "getMyTasks",
  "getMyTasksForPlan",
  "getMyProjects",
  "getProjectKeySteps",
  "getProjectSubtasks",
  "submitTimesheetEntry",
  "finalizeTimesheetSubmission",
  "submitDailyPlan",
  "getDailyPlan",
  "deleteDailyPlan",
  "createTask",
  "updateTaskProgress",
  "updateTaskStatus",
  "updateTaskDescription",
  "markTaskComplete",
  "updateTaskDeadline",
  "extendProjectDeadline",
  "assignTaskToEmployee",
  "deleteTask",
  "deleteProject",
  "getProjectDetails",
  "submitTimesheet",
  "getTimesheetsByDate",
  "getRecentTimesheets",
  "getEmployees",
  "getTeamData",
  "recallMemory",
  "saveMemory",
  "getDraftTimesheets",
  "getPendingApprovals",
  "generateReport",
  "getDailyPlanSubmissions",
];

export const ANALYTICS_TOOLS = [
  "getPerformancePrediction",
  "getTaskRisks",
  "getProjectHealth",
  "getTeamInsights",
  "generateReport",
  "getTeamData",
  "getEmployees",
  "getAttendanceRiskCheck",
  "recallMemory",
  "saveMemory",
];

export const KNOWLEDGE_TOOLS = [
  "recallMemory",
  "saveMemory",
];

// No tools needed for casual chat / greetings / dismissals
export const CONVERSATIONAL_TOOLS: string[] = [];

export type AgentType = "hr" | "project" | "analytics" | "knowledge" | "conversational";

export function getToolsForAgent(agent: AgentType): string[] {
  switch (agent) {
    case "hr": return HR_TOOLS;
    case "project": return PROJECT_TOOLS;
    case "analytics": return ANALYTICS_TOOLS;
    case "knowledge": return KNOWLEDGE_TOOLS;
    case "conversational": return CONVERSATIONAL_TOOLS;
    default: return [];
  }
}
