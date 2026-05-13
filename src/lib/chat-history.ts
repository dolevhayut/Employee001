import fs from "fs";
import path from "path";

export type StoredMessage = {
  role: "user" | "twin";
  id: string;
  text: string;
  ts: number;
  confidence?: number | null;
  cited?: string[];
  artifacts?: Array<{
    artifactId: string;
    type: "html" | "svg";
    title: string;
    content: string;
  }>;
};

const CONTEXT_WINDOW = 40;

function historyPath(employeeId: string): string {
  return path.join(process.cwd(), "data/employees", employeeId, "chat-history.jsonl");
}

export function loadChatHistory(employeeId: string): StoredMessage[] {
  const p = historyPath(employeeId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as StoredMessage]; }
      catch { return []; }
    });
}

export function appendChatMessage(employeeId: string, msg: StoredMessage): void {
  const p = historyPath(employeeId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(msg) + "\n", "utf-8");
}

/** Returns the last N messages formatted for the AI context history. */
export function getContextHistory(
  employeeId: string,
): Array<{ role: "user" | "assistant"; text: string }> {
  return loadChatHistory(employeeId)
    .slice(-CONTEXT_WINDOW)
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
}
