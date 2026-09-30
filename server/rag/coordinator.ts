import OpenAI from "openai";
import { runRAGChat } from "./ragChat";
import { pool } from "../db";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type AgentType = "hr" | "project" | "analytics" | "knowledge" | "conversational";

// ── STEP 1: INTENT ROUTER ────────────────────────────────────────────────────
// Analyses message and decides which agents are needed

async function routeToAgents(
  message: string,
  userRole: string,
  history: any[] = []
): Promise<AgentType[]> {
  const systemMessage = {
    role: "system",
    content: `You are a routing assistant. Analyse the user message and return ONLY a JSON array of agents needed.

Available agents:
- "hr": leaves, attendance, employee info, HR policies, approvals
- "project": tasks, projects, timesheets, daily plans, deadlines
- "analytics": performance scores, predictions, reports, team insights
- "knowledge": company policies, office timings, holidays, general company info
- "conversational": greetings, acknowledgments, dismissals, casual chat, anything that doesn't need data or tools

AGENT EXCLUSIVE OWNERSHIP RULES (non-negotiable):

- project agent EXCLUSIVELY owns: timesheets, daily plans, task status, submission compliance, late/missing/on-time submissions, draft entries, timesheet approvals. NEVER send these to analytics.

- hr agent EXCLUSIVELY owns: leaves, attendance records, employee profiles, leave balances, leave approvals, permissions. NEVER send these to analytics.

- analytics agent EXCLUSIVELY owns: performance scores, productivity trends, predictions, statistical summaries, charts, rankings across multiple employees. NEVER use analytics for raw data lookups that project or hr can answer directly.

- knowledge agent EXCLUSIVELY owns: policy questions, company rules, general information with no live database lookup needed.

- conversational agent EXCLUSIVELY owns: greetings, small talk, clarifications. NEVER route a query with employee names or data intent to conversational.

ROUTING RULE: Assign EXACTLY ONE agent per query. The only exception is when a query genuinely spans two domains (e.g. 'compare leave balance AND performance score for mohan') - in that case assign maximum TWO agents, never more.

Rules:
- Never return an empty array []
- Default to ["conversational"] when unsure
- Return ONLY valid JSON array, nothing else

Examples:
"show my tasks" → ["project"]
"apply for leave" → ["hr"]
"what are office timings" → ["knowledge"]
"how am i performing" → ["analytics"]
"compare leave balance and performance score for mohan" → ["hr", "analytics"]
"ok" → ["conversational"]
"thanks" → ["conversational"]
"good morning" → ["conversational"]
"bye" → ["conversational"]
"got it" → ["conversational"]
"never mind" → ["conversational"]
"generate report" → ["analytics"]
"how many employees have draft timesheets right now" → ["project"]
"show me all pending approvals across the company" → ["hr"]
"who submitted daily plan today" → ["project"]
"who missed daily plan today" → ["project"]`,
  };

  const messages = [
    systemMessage,
    ...history.slice(-5).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 100,
    messages: messages as any,
  });

  try {
    const raw = response.choices[0].message.content?.trim() || '["conversational"]';
    const agents = JSON.parse(raw) as AgentType[];
    const valid = agents.filter((a) =>
      ["hr", "project", "analytics", "knowledge", "conversational"].includes(a)
    );
    // Never allow empty — fallback to conversational
    return valid.length > 0 ? valid : ["conversational"];
  } catch {
    return ["conversational"];
  }
}

// ── STEP 2: AGENT SYSTEM PROMPTS ─────────────────────────────────────────────

function getAgentSystemPrompt(agent: AgentType, userRole: string): string {
  const base = `You are ARIA, an intelligent work assistant for Knockturn Private Limited.
Answer naturally and concisely. Never mention agents or routing.`;

  switch (agent) {
    case "hr":
      return `${base}
Focus: Leave management, attendance, employee information, HR approvals.
Only answer HR-related aspects of the query.
If the query has non-HR parts, ignore them — another system handles those.`;

    case "project":
      return `${base}
Focus: Tasks, projects, timesheets, daily plans, deadlines, assignments.
Only answer project/task-related aspects of the query.
If the query has non-project parts, ignore them — another system handles those.`;

    case "analytics":
      return `${base}
Focus: Performance scores, productivity trends, predictions, reports, team insights.
Only answer analytics-related aspects of the query.
Present risk levels clearly: HIGH / MEDIUM / LOW.
Always include actionable suggestions.`;

    case "knowledge":
      return `${base}
Focus: Company policies, office timings, holidays, general company information.
Use retrieved context to answer. Never guess policy details.
If information is not in the context, say to contact HR.`;

    case "conversational":
      return `${base}
You are responding to a casual message, dismissal, or acknowledgment.
Respond briefly and naturally in 1 sentence.
Do not call any tools.
Do not ask follow-up questions.
NEVER say phrases implying you will check or fetch data (such as "let me check", "one moment", "calling X now") since you have no tools — immediately and honestly state that you cannot look that up.
Examples: "Got it!", "No problem!", "Sure, let me know if you need anything."`;

    default:
      return base;
  }
}

// ── STEP 3: RUN AGENTS IN PARALLEL ───────────────────────────────────────────

async function runAgent(
  agent: AgentType,
  message: string,
  userContext: any,
  history: any[],
  onChunk: (chunk: any) => void
): Promise<string> {
  const chunks: string[] = [];

  // Correct positional arguments used here matching runRAGChat signature
  await runRAGChat(
    message,
    history,
    {
      ...userContext,
      agentMode: agent,
      agentSystemPrompt: getAgentSystemPrompt(agent, userContext.role),
    },
    (chunk: any) => {
      if (chunk.type === "text") {
        chunks.push(chunk.content);
      } else {
        // Forward ALL non-text chunks directly to client
        // This includes interactive_task_plan, action_executed, etc.
        onChunk(chunk);
      }
    }
  );

  return chunks.join("");
}

// ── STEP 4: COMBINE RESPONSES ─────────────────────────────────────────────────

async function combineResponses(
  message: string,
  responses: { agent: AgentType; content: string }[]
): Promise<string> {
  // Filter out empty responses
  const activeResponses = responses.filter((r) => r.content.trim().length > 0);

  if (activeResponses.length === 0) {
    return "I don't currently have a way to do that.";
  }

  if (activeResponses.length === 1) {
    return activeResponses[0].content;
  }

  // Multiple agents — combine naturally
  const combined = activeResponses
    .map((r) => `[${r.agent.toUpperCase()} DATA]:\n${r.content}`)
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1000,
    messages: [
      {
        role: "system",
        content: `You are ARIA, an intelligent work assistant for Knockturn Private Limited.
You have received data from multiple specialized systems.
Combine them into ONE natural, cohesive response.

Rules:
- Never mention agents, systems, or routing
- Write as if you know everything naturally
- Remove duplicate information
- Keep it concise and well structured
- Use bullet points only when showing lists
- NEVER omit performance scores, attendance risk, or prediction data from the final response. Always include ALL data from ALL agents.
- Always end with a helpful suggestion if relevant`,
      },
      {
        role: "user",
        content: `Original question: "${message}"

Data from systems:
${combined}

Combine into one natural response:`,
      },
    ],
  });

  return response.choices[0].message.content || activeResponses[0].content;
}

// ── MAIN COORDINATOR FUNCTION ─────────────────────────────────────────────────

export async function runCoordinator({
  message,
  userContext,
  history,
  onChunk,
}: {
  message: string;
  userContext: any;
  history: any[];
  onChunk: (chunk: any) => void;
}): Promise<void> {
  const salaryRegex = /\b(salary|salaries|compensation|compensations|payroll|paycheck|wages)\b/i;
  if (salaryRegex.test(message)) {
    const finalResponse = "This information is not available through Timestrap.";
    onChunk({ type: "full_text", content: finalResponse });
    const words = finalResponse.split(" ");
    for (const word of words) {
      onChunk({ type: "text", content: word + " " });
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    onChunk({ type: "done" });
    return;
  }

  try {
    userContext.executionCache = new Map<string, Promise<any>>();

    // Step 1 — Route to agents
    let agents = await routeToAgents(message, userContext.role, history);
    console.log(`[COORDINATOR] Routing to agents:`, agents);

    // Safety check for conversational override
    if (agents.length === 1 && agents[0] === "conversational") {
      let refersToOtherEmployee = false;
      try {
        const dbRes = await pool.query(
          `SELECT employee_code, name FROM employees WHERE is_active = true`
        );
        const lowerMessage = message.toLowerCase();
        const messageWords = lowerMessage.split(/[^a-zA-Z0-9]+/).filter(w => w.length >= 3);
        
        for (const row of dbRes.rows) {
          if (row.employee_code === userContext.employeeCode) continue;
          const nameParts = row.name.toLowerCase().split(/\s+/).filter((p: string) => p.length >= 3);
          const hasMatch = nameParts.some((part: string) => {
            return messageWords.some((word: string) => {
              return word === part || part.startsWith(word) || word.startsWith(part);
            });
          });
          if (hasMatch) {
            refersToOtherEmployee = true;
            break;
          }
        }
      } catch (err) {
        console.error("[COORDINATOR] Failed to check employee names:", err);
      }

      const dataKeywords = [
        "task", "project", "timesheet", "leave", "holiday", "report", 
        "perform", "predict", "risk", "attendance", "role", "work", 
        "plan", "employ", "status", "submit", "approve", "reject",
        "working on", "submitted", "approved", "late", "compliance",
        "ontime", "on time", "who submitted", "didn't submit", "did not submit",
        "excel", "pdf", "format", "download"
      ];
      const lowerMessage = message.toLowerCase();
      const hasDataKeyword = dataKeywords.some(keyword => lowerMessage.includes(keyword));

      if (refersToOtherEmployee || hasDataKeyword) {
        let targetAgent: AgentType = "project";
        if (lowerMessage.includes("leave") || lowerMessage.includes("attendance") || lowerMessage.includes("holiday")) {
          targetAgent = "hr";
        } else if (lowerMessage.includes("perform") || lowerMessage.includes("predict") || lowerMessage.includes("risk") || lowerMessage.includes("report") || lowerMessage.includes("excel") || lowerMessage.includes("pdf") || lowerMessage.includes("format") || lowerMessage.includes("download")) {
          targetAgent = "analytics";
        } else if (lowerMessage.includes("policy") || lowerMessage.includes("timings")) {
          targetAgent = "knowledge";
        }
        console.log(`[COORDINATOR] Overriding conversational agent to: ${targetAgent}`);
        agents = [targetAgent];
      }
    }

    console.log(`[ROUTING] Query: "${message.slice(0, 50)}..." → Agents: ${agents.join(', ')}`);
    console.log(`[ROUTING] If more than 1 agent selected, reason should be cross-domain query`);

    // Step 2 — Run all needed agents in parallel
    const agentPromises = agents.map((agent) =>
      runAgent(agent, message, userContext, history, onChunk)
        .then((content) => ({ agent, content }))
        .catch((err) => {
          console.error(`[COORDINATOR] Agent ${agent} failed:`, err);
          return { agent, content: "" };
        })
    );

    const agentResults = await Promise.all(agentPromises);

    // Step 3 — Combine responses
    const finalResponse = await combineResponses(message, agentResults);

    // Send full text first so TTS voice starts immediately
    onChunk({ type: "full_text", content: finalResponse });

    // Step 4 — Stream combined response word by word
    const words = finalResponse.split(" ");
    for (const word of words) {
      onChunk({ type: "text", content: word + " " });
      // Minor delay to simulate natural typing
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    onChunk({ type: "done" });
  } catch (error) {
    console.error("[COORDINATOR] Error:", error);
    // Correct positional arguments used in fallback call
    await runRAGChat(message, history, userContext, onChunk);
  }
}
