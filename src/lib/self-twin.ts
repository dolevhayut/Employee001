import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./app-home";
import { CURRENT_CONSENT_VERSION, type EmployeeConsent } from "./employees";
import { recordConsentEvidence } from "./consent-evidence";
import { saveUploadedKnowledgeFile } from "./knowledge-files";

// "Build my twin": the person running Employee001 builds their own twin from
// what they write and upload, with no invite and no connected tools. The
// twin builder reads the material from knowledge/ (twin-builder.ts), and the
// twin keeps reading it at run time like any uploaded knowledge.

/** Where the "tell your twin about your work" text is kept. */
export const SELF_NOTES_FILE = "about-my-work.md";
export const SELF_NOTES_MAX_CHARS = 60_000;

export type SelfTwinInput = {
  name: string;
  role: string;
  notes: string;
  /** Account that built it, when sign-in is on. */
  userId?: string;
  locale?: string;
  headers: Headers;
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function selfTwinProblem(input: Pick<SelfTwinInput, "name" | "role" | "notes">): string | null {
  if (!input.name.trim()) return "Your name is required.";
  if (!input.role.trim()) return "Your role is required.";
  if (input.notes.trim().length < 200) return "Tell your twin a bit more about your work (a few paragraphs at least).";
  if (input.notes.length > SELF_NOTES_MAX_CHARS) return `That's more than ${SELF_NOTES_MAX_CHARS.toLocaleString("en-US")} characters. Upload long documents as files instead.`;
  return null;
}

/** Creates the employee with the person's own consent and their notes.
 *  The profile files come from the builder; until it writes them the twin
 *  is "pending", never "ready". */
export async function createSelfTwin(input: SelfTwinInput): Promise<{ employeeId: string }> {
  const name = input.name.trim().slice(0, 120);
  const role = input.role.trim().slice(0, 120);
  const employeeId = `${slug(name) || "me"}-${randomBytes(3).toString("hex")}`;
  const dir = dataDir("employees", employeeId);
  await fs.mkdir(dir, { recursive: true });

  const now = new Date().toISOString();
  const consent: EmployeeConsent = { grantedAt: now, version: CURRENT_CONSENT_VERSION, scopes: ["data-collection"] };
  await fs.writeFile(
    path.join(dir, "employee.json"),
    JSON.stringify(
      {
        id: employeeId,
        name,
        role,
        integrations: [],
        createdAt: now,
        lastActiveAt: now,
        via: { self: true, ...(input.userId ? { userId: input.userId } : {}) },
        consent,
      },
      null,
      2,
    ),
    "utf8",
  );

  const notes = `# ${name}, ${role}: in my own words\n\n${input.notes.trim()}\n`;
  const saved = saveUploadedKnowledgeFile(employeeId, SELF_NOTES_FILE, Buffer.from(notes, "utf8"));
  if ("error" in saved) throw new Error(saved.error);

  recordConsentEvidence({ employeeId, employeeName: name, consent, locale: input.locale, headers: input.headers, channel: "self" });
  return { employeeId };
}
