// Built-in tools the Claude Agent SDK exposes (Read / Glob / Grep / Write /
// WebSearch / WebFetch / TodoWrite / AskUserQuestion / Task) reimplemented
// against the local filesystem and (optionally) a real web search backend.
//
// Each tool is described as an OpenAI function-tool definition + handler. The
// agent loop in query.ts gathers the active subset based on `allowedTools`,
// `disallowedTools`, and the registered MCP servers, then calls handlers when
// the model emits a tool_call.

import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { ChatCompletionTool } from "openai/resources/chat/completions/completions";
import type { AgentDefinition } from "./types";

export type BuiltinToolName =
  | "Read"
  | "Write"
  | "Glob"
  | "Grep"
  | "WebSearch"
  | "WebFetch"
  | "TodoWrite"
  | "AskUserQuestion"
  | "Task";

export type ToolHandlerCtx = {
  cwd: string;
  abortSignal?: AbortSignal;
  agents?: Record<string, AgentDefinition>;
  /** Called when the model requests AskUserQuestion. Returns the answers map. */
  askUserQuestion?: (
    input: Record<string, unknown>
  ) => Promise<Record<string, string>>;
  /** Spawn a Task subagent and return its final text. Implemented by query.ts. */
  spawnTask?: (
    args: {
      subagent_type: string;
      description: string;
      prompt: string;
    },
    ctx: ToolHandlerCtx
  ) => Promise<string>;
};

export type BuiltinToolDef = {
  name: BuiltinToolName;
  schema: ChatCompletionTool;
  handler: (
    input: Record<string, unknown>,
    ctx: ToolHandlerCtx
  ) => Promise<{ text: string; isError?: boolean }>;
};

function resolvePath(cwd: string, p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.join(cwd, p);
}

async function safeStat(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

const Read: BuiltinToolDef = {
  name: "Read",
  schema: {
    type: "function",
    function: {
      name: "Read",
      description:
        "Read a file from the workspace. Returns the full file contents as text. Use for known paths under the agent's cwd.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file (absolute or relative to cwd).",
          },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["file_path"],
      },
    },
  },
  handler: async (input, ctx) => {
    const raw = typeof input.file_path === "string" ? input.file_path : "";
    if (!raw) return { text: "Error: file_path is required.", isError: true };
    const full = resolvePath(ctx.cwd, raw);
    try {
      const content = await fs.readFile(full, "utf8");
      const offset = typeof input.offset === "number" ? input.offset : 0;
      const limit = typeof input.limit === "number" ? input.limit : 2000;
      const lines = content.split("\n").slice(offset, offset + limit);
      return {
        text: lines.map((l, i) => `${offset + i + 1}\t${l}`).join("\n"),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `Error reading ${raw}: ${msg}`, isError: true };
    }
  },
};

const Write: BuiltinToolDef = {
  name: "Write",
  schema: {
    type: "function",
    function: {
      name: "Write",
      description:
        "Write a file (overwriting if it exists). Used by twins to save scratch memos under scratch/<employeeId>/.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          content: { type: "string" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  handler: async (input, ctx) => {
    const raw = typeof input.file_path === "string" ? input.file_path : "";
    const content = typeof input.content === "string" ? input.content : "";
    if (!raw) return { text: "Error: file_path is required.", isError: true };
    const full = resolvePath(ctx.cwd, raw);
    try {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
      return { text: `Wrote ${content.length} chars to ${raw}.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `Error writing ${raw}: ${msg}`, isError: true };
    }
  },
};

async function walk(dir: string, max = 5000): Promise<string[]> {
  const out: string[] = [];
  async function recurse(d: string) {
    if (out.length >= max) return;
    let entries: import("fs").Dirent[] = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) return;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await recurse(dir);
  return out;
}

function globToRegex(pattern: string): RegExp {
  // Minimal glob → regex (handles **, *, ?). Good enough for the cwd-sandboxed
  // patterns the twins use ("**/*.md", "employees/*/EXPERTISE.md").
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
      i++;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if ("/.+()|^$[]{}\\".includes(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += "$";
  return new RegExp(re);
}

const Glob: BuiltinToolDef = {
  name: "Glob",
  schema: {
    type: "function",
    function: {
      name: "Glob",
      description:
        "List files matching a glob pattern (e.g. 'org-brain/nodes/*.md', 'employees/**/*.md'). Returns paths relative to cwd.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Optional subdirectory (relative to cwd) to search under." },
        },
        required: ["pattern"],
      },
    },
  },
  handler: async (input, ctx) => {
    const pattern = typeof input.pattern === "string" ? input.pattern : "";
    if (!pattern) return { text: "Error: pattern is required.", isError: true };
    const baseRel = typeof input.path === "string" ? input.path : "";
    const base = baseRel ? resolvePath(ctx.cwd, baseRel) : ctx.cwd;
    if (!existsSync(base)) {
      return { text: `No files found (path does not exist: ${baseRel || "."}).` };
    }
    const re = globToRegex(pattern);
    const all = await walk(base);
    const matches = all
      .map((f) => path.relative(ctx.cwd, f))
      .filter((rel) => re.test(rel));
    if (matches.length === 0) {
      return { text: "No files found." };
    }
    return { text: matches.slice(0, 200).join("\n") };
  },
};

const Grep: BuiltinToolDef = {
  name: "Grep",
  schema: {
    type: "function",
    function: {
      name: "Grep",
      description:
        "Search file contents for a regex pattern under the agent's cwd. Returns matching lines with their file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Optional subdir relative to cwd." },
          glob: { type: "string", description: "Optional file glob filter, e.g. '*.md'." },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
          },
          "-i": { type: "boolean", description: "Case-insensitive." },
          "-n": { type: "boolean", description: "Show line numbers." },
        },
        required: ["pattern"],
      },
    },
  },
  handler: async (input, ctx) => {
    const pattern = typeof input.pattern === "string" ? input.pattern : "";
    if (!pattern) return { text: "Error: pattern is required.", isError: true };
    const baseRel = typeof input.path === "string" ? input.path : "";
    const base = baseRel ? resolvePath(ctx.cwd, baseRel) : ctx.cwd;
    if (!existsSync(base)) {
      return { text: "No matches (path does not exist)." };
    }
    const caseInsensitive = input["-i"] === true;
    const lineNumbers = input["-n"] === true;
    const outputMode =
      typeof input.output_mode === "string" ? input.output_mode : "files_with_matches";
    const globFilter =
      typeof input.glob === "string" ? globToRegex(input.glob) : null;

    let re: RegExp;
    try {
      re = new RegExp(pattern, caseInsensitive ? "i" : "");
    } catch (err) {
      return {
        text: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const all = await walk(base);
    const files = all.filter((f) => {
      const rel = path.relative(ctx.cwd, f);
      return !globFilter || globFilter.test(path.basename(rel));
    });

    const matches: string[] = [];
    const filesWithMatches = new Set<string>();
    let matchCount = 0;
    for (const f of files) {
      let content: string;
      try {
        content = await fs.readFile(f, "utf8");
      } catch {
        continue;
      }
      const rel = path.relative(ctx.cwd, f);
      const lines = content.split("\n");
      let fileHadMatch = false;
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          fileHadMatch = true;
          matchCount++;
          if (outputMode === "content") {
            matches.push(
              lineNumbers ? `${rel}:${i + 1}:${lines[i]}` : `${rel}:${lines[i]}`
            );
            if (matches.length > 200) break;
          }
        }
      }
      if (fileHadMatch) filesWithMatches.add(rel);
      if (matches.length > 200) break;
    }

    if (outputMode === "count") {
      return { text: `${matchCount} matches in ${filesWithMatches.size} files` };
    }
    if (outputMode === "files_with_matches") {
      const list = [...filesWithMatches];
      return {
        text: list.length === 0 ? "No matches." : list.join("\n"),
      };
    }
    return { text: matches.length === 0 ? "No matches." : matches.join("\n") };
  },
};

const WebFetch: BuiltinToolDef = {
  name: "WebFetch",
  schema: {
    type: "function",
    function: {
      name: "WebFetch",
      description:
        "Fetch a single URL and return the body as text (HTML is converted to plain text). Use when you have a specific URL to consult.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          prompt: { type: "string", description: "What to extract from the page." },
        },
        required: ["url"],
      },
    },
  },
  handler: async (input) => {
    const url = typeof input.url === "string" ? input.url : "";
    if (!url) return { text: "Error: url is required.", isError: true };
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Employee001/1.0 (+https://employee001.com) AzurePort",
        },
        signal: AbortSignal.timeout(20_000),
      });
      const ctype = res.headers.get("content-type") ?? "";
      const body = await res.text();
      if (ctype.includes("html")) {
        const text = body
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
        return { text };
      }
      return { text: body.slice(0, 8000) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `WebFetch error: ${msg}`, isError: true };
    }
  },
};

const WebSearch: BuiltinToolDef = {
  name: "WebSearch",
  schema: {
    type: "function",
    function: {
      name: "WebSearch",
      description:
        "Search the web. Optional — requires BING_SEARCH_KEY or TAVILY_API_KEY. Returns a concise list of {title, url, snippet} matches.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          allowed_domains: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
      },
    },
  },
  handler: async (input) => {
    const query = typeof input.query === "string" ? input.query : "";
    if (!query) return { text: "Error: query is required.", isError: true };

    const tavilyKey = process.env.TAVILY_API_KEY;
    const bingKey = process.env.BING_SEARCH_KEY;

    if (tavilyKey) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            max_results: 5,
            search_depth: "basic",
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = (await res.json()) as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const items = (data.results ?? [])
          .map(
            (r) =>
              `- ${r.title ?? "(no title)"} — ${r.url ?? ""}\n  ${(r.content ?? "").slice(0, 200)}`
          )
          .join("\n");
        return { text: items || "No results." };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { text: `WebSearch (Tavily) error: ${msg}`, isError: true };
      }
    }
    if (bingKey) {
      try {
        const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=5`;
        const res = await fetch(url, {
          headers: { "Ocp-Apim-Subscription-Key": bingKey },
          signal: AbortSignal.timeout(15_000),
        });
        const data = (await res.json()) as {
          webPages?: { value?: Array<{ name: string; url: string; snippet: string }> };
        };
        const items = (data.webPages?.value ?? [])
          .map((r) => `- ${r.name} — ${r.url}\n  ${r.snippet}`)
          .join("\n");
        return { text: items || "No results." };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { text: `WebSearch (Bing) error: ${msg}`, isError: true };
      }
    }

    return {
      text: "WebSearch is not configured. Set TAVILY_API_KEY or BING_SEARCH_KEY in .env to enable. Answer from the brain or profile files instead.",
      isError: false,
    };
  },
};

const TodoWrite: BuiltinToolDef = {
  name: "TodoWrite",
  schema: {
    type: "function",
    function: {
      name: "TodoWrite",
      description:
        "Record your in-progress task list (planning surface). Pass an array of {id, content, status} objects.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                },
              },
              required: ["id", "content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  handler: async (input) => {
    const todos = Array.isArray(input.todos) ? input.todos : [];
    return { text: `Todos updated (${todos.length}).` };
  },
};

const AskUserQuestion: BuiltinToolDef = {
  name: "AskUserQuestion",
  schema: {
    type: "function",
    function: {
      name: "AskUserQuestion",
      description:
        "Ask the user a multi-choice clarification question. Render rich option cards in the UI; user picks one or more.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                header: { type: "string" },
                multiSelect: { type: "boolean" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      description: { type: "string" },
                      preview: { type: "string" },
                    },
                    required: ["label", "description"],
                  },
                },
              },
              required: ["question", "header", "options"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  handler: async (input, ctx) => {
    if (!ctx.askUserQuestion) {
      return {
        text: "AskUserQuestion is not available in this surface (no user UI).",
        isError: true,
      };
    }
    const answers = await ctx.askUserQuestion(input);
    return {
      text: JSON.stringify({ answers }),
    };
  },
};

const Task: BuiltinToolDef = {
  name: "Task",
  schema: {
    type: "function",
    function: {
      name: "Task",
      description:
        "Spawn a focused subagent to work on a single self-contained task. Use for parallel research where each branch has its own context.",
      parameters: {
        type: "object",
        properties: {
          subagent_type: { type: "string" },
          description: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["subagent_type", "description", "prompt"],
      },
    },
  },
  handler: async (input, ctx) => {
    if (!ctx.spawnTask) {
      return {
        text: "Task spawning is not enabled in this run.",
        isError: true,
      };
    }
    const subagent_type = typeof input.subagent_type === "string" ? input.subagent_type : "";
    const description = typeof input.description === "string" ? input.description : "";
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    if (!subagent_type || !prompt) {
      return { text: "subagent_type and prompt are required.", isError: true };
    }
    try {
      const result = await ctx.spawnTask(
        { subagent_type, description, prompt },
        ctx
      );
      return { text: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `Task failed: ${msg}`, isError: true };
    }
  },
};

export const BUILTIN_TOOLS: Record<BuiltinToolName, BuiltinToolDef> = {
  Read,
  Write,
  Glob,
  Grep,
  WebSearch,
  WebFetch,
  TodoWrite,
  AskUserQuestion,
  Task,
};
