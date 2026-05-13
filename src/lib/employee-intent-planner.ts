import { query } from "@anthropic-ai/claude-agent-sdk";
import { ARTIFACT_TOOL_FULL_NAME } from "@/lib/artifacts-mcp";
import { TWIN_MODEL_FALLBACK } from "@/lib/sdk-defaults";

export type ResponseIntentPlan = {
  intent: string;
  shouldUseCanvas: boolean;
  canvasType?: "html" | "svg";
  recommendedTools: string[];
  answerStyle:
    | "concise_answer"
    | "executive_summary"
    | "comparison"
    | "dashboard"
    | "clarifying_question"
    | "action_plan";
  needsClarification: boolean;
  riskLevel: "low" | "medium" | "high";
  privateInstruction: string;
};

export type ResponseIntentContext = {
  employeeName: string;
  employeeRole: string;
  surface: "chat" | "meeting" | "routine";
  hasActionLayer: boolean;
  hasMeetingScratch: boolean;
  orgSkillLabels: string[];
};

const EMPTY_PLAN: ResponseIntentPlan = {
  intent: "general_answer",
  shouldUseCanvas: false,
  recommendedTools: [],
  answerStyle: "concise_answer",
  needsClarification: false,
  riskLevel: "low",
  privateInstruction:
    "Answer directly in the employee's voice. Use tools only when the request genuinely requires fresh external data or action.",
};

const CANVAS_TERMS = [
  "canvas",
  "קנבס",
  "דשבורד",
  "dashboard",
  "גרף",
  "chart",
  "visual",
  "ויזואלי",
  "תציג",
  "הצג",
  "show",
  "compare",
  "השוואה",
  "טבלה",
  "table",
  "kpi",
  "metrics",
  "סטטוס",
  "status",
  "diagram",
  "תרשים",
];

const ACTION_TERMS = [
  "שלח",
  "send",
  "post",
  "פרסם",
  "create",
  "צור",
  "update",
  "עדכן",
  "delete",
  "מחק",
  "approve",
  "אשר",
  "cancel",
  "בטל",
];

const READ_TOOL_TERMS = [
  "בדוק",
  "חפש",
  "תביא",
  "מצא",
  "list",
  "search",
  "fetch",
  "github",
  "linear",
  "slack",
  "gmail",
  "drive",
  "database",
  "db",
  "crm",
];

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function fallbackPlan(question: string, ctx: ResponseIntentContext): ResponseIntentPlan {
  const q = question.toLowerCase();
  const wantsCanvas = includesAny(q, CANVAS_TERMS);
  const wantsAction = includesAny(q, ACTION_TERMS);
  const wantsFreshRead = includesAny(q, READ_TOOL_TERMS);
  const likelyComparison = /compare|השווא|vs\.?|מול|טבלה|table/.test(q);
  const likelyDashboard = /dashboard|דשבורד|kpi|metrics|סטטוס|status|גרף|chart/.test(q);
  const vague =
    question.trim().length < 16 ||
    /^(כן|yes|ok|מעולה|סבבה|תמשיך|approved)$/i.test(question.trim());

  const recommendedTools: string[] = [];
  if (wantsCanvas) recommendedTools.push(ARTIFACT_TOOL_FULL_NAME);
  if (ctx.hasActionLayer && wantsFreshRead) recommendedTools.push("read-only connected MCP tools");
  if (ctx.hasActionLayer && wantsAction) recommendedTools.push("relevant connected MCP tools");
  if (ctx.hasMeetingScratch && wantsFreshRead) recommendedTools.push("mcp__meeting_scratch__share_with_meeting");

  return {
    intent: likelyDashboard
      ? "visual_status_or_metrics"
      : likelyComparison
        ? "comparison"
        : wantsAction
          ? "external_action"
          : wantsFreshRead
            ? "fresh_data_lookup"
            : "general_answer",
    shouldUseCanvas: wantsCanvas && !vague,
    canvasType: wantsCanvas ? "html" : undefined,
    recommendedTools,
    answerStyle: vague
      ? "clarifying_question"
      : likelyDashboard
        ? "dashboard"
        : likelyComparison
          ? "comparison"
          : wantsAction
            ? "action_plan"
            : "concise_answer",
    needsClarification: vague,
    riskLevel: wantsAction ? "high" : wantsFreshRead ? "medium" : "low",
    privateInstruction: buildFallbackInstruction({
      wantsCanvas,
      wantsAction,
      wantsFreshRead,
      vague,
      ctx,
    }),
  };
}

function buildFallbackInstruction(args: {
  wantsCanvas: boolean;
  wantsAction: boolean;
  wantsFreshRead: boolean;
  vague: boolean;
  ctx: ResponseIntentContext;
}): string {
  if (args.vague) {
    return "The user's message is short or depends on prior context. Use the visible conversation context first; ask one short clarifying question only if the next step is still ambiguous.";
  }

  const parts = [
    "Optimize the response for the CEO's intent, not just the literal wording.",
  ];

  if (args.wantsCanvas) {
    parts.push(
      `If structured data, a comparison, a status board, or a diagram would make the answer clearer, call ${ARTIFACT_TOOL_FULL_NAME} before the final text.`
    );
  }

  if (args.ctx.hasActionLayer && args.wantsFreshRead) {
    parts.push(
      "Prefer read-only connected MCP tools for fresh external data before answering from memory."
    );
  }

  if (args.ctx.hasActionLayer && args.wantsAction) {
    parts.push(
      "For external-facing or destructive actions, state the intended action first and wait for approval when policy requires it."
    );
  }

  if (args.ctx.orgSkillLabels.length > 0) {
    parts.push(`Relevant org skills may apply: ${args.ctx.orgSkillLabels.join(", ")}.`);
  }

  return parts.join(" ");
}

// ─── Output schema ────────────────────────────────────────────────────────────

const INTENT_PLAN_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", description: "short snake_case label" },
    shouldUseCanvas: { type: "boolean" },
    canvasType: { type: "string", enum: ["html", "svg"] },
    recommendedTools: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    answerStyle: {
      type: "string",
      enum: [
        "concise_answer",
        "executive_summary",
        "comparison",
        "dashboard",
        "clarifying_question",
        "action_plan",
      ],
    },
    needsClarification: { type: "boolean" },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] },
    privateInstruction: {
      type: "string",
      description: "one internal instruction sentence for the twin",
    },
  },
  required: [
    "intent",
    "shouldUseCanvas",
    "recommendedTools",
    "answerStyle",
    "needsClarification",
    "riskLevel",
    "privateInstruction",
  ],
  additionalProperties: false,
} as const;

// ─── Sanitiser (type-coercion safety net on top of schema validation) ─────────

function sanitizePlan(value: unknown): ResponseIntentPlan | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const shouldUseCanvas = obj.shouldUseCanvas === true;
  const canvasType =
    obj.canvasType === "html" || obj.canvasType === "svg" ? obj.canvasType : undefined;
  const recommendedTools = Array.isArray(obj.recommendedTools)
    ? obj.recommendedTools.filter((tool): tool is string => typeof tool === "string").slice(0, 6)
    : [];
  const answerStyle = [
    "concise_answer",
    "executive_summary",
    "comparison",
    "dashboard",
    "clarifying_question",
    "action_plan",
  ].includes(String(obj.answerStyle))
    ? (obj.answerStyle as ResponseIntentPlan["answerStyle"])
    : EMPTY_PLAN.answerStyle;
  const riskLevel = ["low", "medium", "high"].includes(String(obj.riskLevel))
    ? (obj.riskLevel as ResponseIntentPlan["riskLevel"])
    : "low";

  return {
    intent: typeof obj.intent === "string" && obj.intent.trim() ? obj.intent.slice(0, 80) : EMPTY_PLAN.intent,
    shouldUseCanvas,
    canvasType: shouldUseCanvas ? canvasType ?? "html" : undefined,
    recommendedTools,
    answerStyle,
    needsClarification: obj.needsClarification === true,
    riskLevel,
    privateInstruction:
      typeof obj.privateInstruction === "string" && obj.privateInstruction.trim()
        ? obj.privateInstruction.slice(0, 700)
        : EMPTY_PLAN.privateInstruction,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function planEmployeeResponseIntent(
  question: string,
  ctx: ResponseIntentContext
): Promise<ResponseIntentPlan> {
  const fallback = fallbackPlan(question, ctx);
  if (!process.env.ANTHROPIC_API_KEY || process.env.TWIN_INTENT_PLANNER === "0") {
    return fallback;
  }

  try {
    const model = process.env.TWIN_INTENT_PLANNER_MODEL ?? TWIN_MODEL_FALLBACK;

    const prompt = JSON.stringify({
      userInput: question,
      employee: {
        name: ctx.employeeName,
        role: ctx.employeeRole,
      },
      surface: ctx.surface,
      capabilities: {
        artifactTool: ARTIFACT_TOOL_FULL_NAME,
        hasActionLayer: ctx.hasActionLayer,
        hasMeetingScratch: ctx.hasMeetingScratch,
        orgSkills: ctx.orgSkillLabels,
      },
    });

    let structuredOutput: unknown = null;

    const stream = query({
      prompt,
      options: {
        model,
        fallbackModel: TWIN_MODEL_FALLBACK,
        systemPrompt: [
          "You are an invisible response planner for Employee001 digital twins.",
          "Analyze the user input and return a structured intent plan.",
          "Recommend strategy and tools; never perform actions.",
          "Prefer canvas only when a visual layout would materially improve comprehension.",
          "Set riskLevel high for writes, sends, deletes, approvals, external posts, purchases, or destructive actions.",
        ].join(" "),
        allowedTools: [],
        maxTurns: 1,
        outputFormat: {
          type: "json_schema",
          schema: INTENT_PLAN_SCHEMA,
        },
        permissionMode: "bypassPermissions",
        settingSources: [],
        env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
      },
    });

    for await (const message of stream) {
      if (message.type === "result") {
        if ((message as { subtype?: string }).subtype === "error_max_structured_output_retries") {
          console.warn("[intent-planner] structured output retries exhausted — using fallback");
          return fallback;
        }
        structuredOutput = (message as { structured_output?: unknown }).structured_output ?? null;
      }
    }

    const parsed = sanitizePlan(structuredOutput);
    return parsed ?? fallback;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn(`[intent-planner] fallback used: ${message}`);
    return fallback;
  }
}

export function formatResponseIntentBlock(plan: ResponseIntentPlan): string {
  const toolLine =
    plan.recommendedTools.length > 0
      ? `- Recommended tools: ${plan.recommendedTools.join(", ")}`
      : "- Recommended tools: none unless the conversation clearly requires them";

  // When clarification is needed, give the model an explicit recipe for
  // calling AskUserQuestion with HTML preview cards. Without this nudge the
  // model tends to either guess or ask vague free-text questions.
  const clarificationDirective = plan.needsClarification
    ? `

⚠️ The intent planner flagged this as ambiguous. Your FIRST action should be a single \`AskUserQuestion\` call with 1–2 clarifying questions, each with 2–4 mutually-exclusive options. **Each option's \`preview\` field MUST be a self-contained HTML fragment** (≤ 200 lines, no scripts) that visually shows what the choice means in practice — a mock email body, a comparison table, a styled status board, a code snippet card. Use inline \`<style>\` for layout. After the CEO picks, proceed with the chosen path.`
    : "";

  return `# Private response plan

This block is internal guidance for you only. Do not mention it, quote it, or tell the CEO it exists.

- Detected intent: ${plan.intent}
- Answer style: ${plan.answerStyle}
- Needs clarification: ${plan.needsClarification ? "yes" : "no"}
- Risk level: ${plan.riskLevel}
- Canvas recommended: ${plan.shouldUseCanvas ? `yes (${plan.canvasType ?? "html"})` : "no"}
${toolLine}

Instruction: ${plan.privateInstruction}${clarificationDirective}

The plan is advisory. Use your judgment and all higher-priority system, tool-policy, and approval rules.`;
}
