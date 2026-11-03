import fs from "fs";
import { envFilePath } from "./app-home";

// Keys an admin saves in Settings (PATCH /api/system/config) go to the env
// file. Next reads `.env` from its own folder at startup, which is enough for
// `npx employee001`. In Docker that folder is the image, so a rebuild threw
// the keys away; the image points EMPLOYEE001_ENV_FILE at the data volume
// instead, and this loads it back when the server starts.

/** The keys Settings may save, and the only ones read back from the file. */
export const SAVED_KEY_NAMES = ["ANTHROPIC_API_KEY", "COMPOSIO_API_KEY", "ELEVENLABS_API_KEY"] as const;

const KEYCHAIN_PLACEHOLDER = "@keychain";

/** KEY="value" lines as Settings writes them (plain KEY=value too). */
export function parseSavedKeys(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !(SAVED_KEY_NAMES as readonly string[]).includes(m[1])) continue;
    const quoted = m[2].match(/^"(.*)"$|^'(.*)'$/);
    const value = quoted ? (quoted[1] ?? quoted[2]).replace(/\\n/g, "\n") : m[2];
    if (value && value !== KEYCHAIN_PLACEHOLDER) out[m[1]] = value;
  }
  return out;
}

/** Load keys saved in Settings when they live outside Next's own folder
 *  (EMPLOYEE001_ENV_FILE). The server's real environment wins, as with
 *  `.env`. Returns the names it set. */
export function loadSavedKeys(env: Record<string, string | undefined> = process.env): string[] {
  if (!env.EMPLOYEE001_ENV_FILE) return [];
  let text: string;
  try {
    text = fs.readFileSync(envFilePath(), "utf8");
  } catch {
    return []; // nothing saved yet
  }
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(parseSavedKeys(text))) {
    if (env[key]) continue;
    env[key] = value;
    loaded.push(key);
  }
  return loaded;
}
