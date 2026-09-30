/**
 * Shared tool list + categorization used by:
 *  - the "Tools Used" picker on the Tracker's TaskForm
 *  - the "Tool Selection" field on the Plan for the Day
 *  - TimeGuard tool-usage validation (server/toolUsageValidation.ts), to decide
 *    which tool selections require a matching TimeGuard activity log and which
 *    don't.
 *
 * Non-development tools are activities that don't produce software/tool
 * activity on the employee's machine — meetings, client calls, discussions,
 * reviews, training, and similar — so TimeGuard (which watches app/window
 * usage) has nothing to verify them against. Tool validation should only be
 * enforced for tools that represent actual software/development tool usage.
 */

/** Tools that represent meetings, calls, discussions, reviews, training, or
 * similar non-development activity. TimeGuard tool-usage validation is
 * skipped when these are selected, since there's no expectation of an
 * app/tool activity log during a meeting or a call. */
export const NON_DEVELOPMENT_TOOLS = [
  'Meeting Others',
  'Meeting with Teams',
  'Calls/Phone',
  'Client Call',
  'Client Meeting',
  'Discussion',
  'Team Discussion',
  'Review',
  'Code Review',
  'Performance Review',
  'Training',
  'Onboarding/Training',
] as const;

const NON_DEVELOPMENT_TOOLS_SET = new Set(
  NON_DEVELOPMENT_TOOLS.map((t) => t.trim().toLowerCase())
);

/** Fallback keyword match, in case a tool name isn't in the curated list
 * above (e.g. a free-text/"Others" style entry like "Client Review Call"). */
const NON_DEVELOPMENT_KEYWORDS = [
  'meeting',
  'call',
  'discussion',
  'review',
  'training',
  'client',
  'standup',
  'stand-up',
  'sync-up',
  'catch-up',
  'interview',
];

/** True if a single tool name represents a meeting/call/discussion/review/
 * training-style non-development activity. */
export function isNonDevelopmentTool(toolName: string | null | undefined): boolean {
  if (!toolName) return false;
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) return false;
  if (NON_DEVELOPMENT_TOOLS_SET.has(normalized)) return true;
  return NON_DEVELOPMENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Whether TimeGuard tool-usage validation should be skipped for a given set
 * of selected tools. Validation is only enforced for tasks that require
 * actual software/development tool usage — so if EVERY selected tool is a
 * non-development activity (meeting, client call, discussion, review,
 * training, etc.), validation is skipped entirely. A mixed selection (e.g.
 * "Meeting with Teams" + "VS Code") is still validated, since real dev-tool
 * usage is expected to show up in TimeGuard's logs.
 */
export function shouldSkipToolValidation(toolNames: string[] | null | undefined): boolean {
  const tools = (toolNames || []).map((t) => (t || '').trim()).filter(Boolean);
  if (tools.length === 0) return false;
  return tools.every(isNonDevelopmentTool);
}

/** Full tool list offered in "Tools Used" (Tracker) and "Tool Selection"
 * (Plan for the Day) pickers. Includes both development tools and
 * non-development (meeting/call/discussion/review/training) activities. */
export const TOOLS_LIST = [
  'Adobe Scanner', 'Airtable', 'Android Studio', 'Angular', 'AutoCAD', 'AWS', 'Azure',
  'Antigravity', 'Amazon', 'Bitbucket', 'BrowserStack', 'Calls/Phone',
  'Canva', 'ChatGPT', 'Chrome', 'Claude', 'Client Call', 'Client Meeting', 'Code Review',
  'Copilot', 'Whatsapp', 'Confluence', 'CSS', 'Discussion', 'Docker',
  'Drizzle', 'Emails', 'ESLint', 'Excel', 'Express', 'Figma', 'Firebase', 'Firefox',
  'Flutter', 'Gemini', 'Git', 'GitHub', 'GitLab', 'Google', 'Google Calendar', 'Google Keep',
  'Google Maps', 'Google Play Console', 'Google Tasks', 'Grafana', 'GSAP', 'GST Portal', 'Heroku', 'Hostinger', 'HTML',
  'IncomeTax Portal', 'Indeed', 'InVision', 'JavaScript', 'Jenkins', 'Jest', 'Jira', 'Kubernetes', 'LinkedIn', 'Loom',
  'Lucide Icons', 'Meeting Others', 'Meeting with Teams', 'Miro', 'MongoDB', 'MS Office', 'MS Teams',
  'MySQL', 'Naukri', 'Netlify', 'Next.js', 'Node.js', 'Notes', 'Notion', 'Onboarding/Training', 'OpenAI', 'Others', 'Outlook',
  'Performance Review', 'Porter', 'PostgreSQL', 'Postman', 'Promilo', 'PPT', 'Prettier', 'Prisma', 'React', 'Redis', 'Redux', 'Safari', 'Sentry',
  'Shadcn/UI', 'Shine', 'Slack', 'Storybook', 'Supabase', 'Swift', 'Tailwind CSS', 'TanStack Query', 'Team Discussion', 'Traces',
  'TimeChamp', 'Training', 'Trello', 'TypeScript', 'Unolo', 'Vercel', 'Vite', 'VS Code', 'Vue', 'Web Browser', 'Word',
  'WorkIndia', 'Wouter', 'XCode', 'Zapier', 'Zeplin', 'Zoho Books', 'Zoho Cliq', 'Zoho Expenses'
].sort();