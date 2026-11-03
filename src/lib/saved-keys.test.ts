import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSavedKeys, parseSavedKeys } from "./saved-keys";

let dir: string;
const saved = process.env.EMPLOYEE001_ENV_FILE;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "e001-saved-keys-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env.EMPLOYEE001_ENV_FILE;
  else process.env.EMPLOYEE001_ENV_FILE = saved;
});

describe("parseSavedKeys", () => {
  it("reads the lines Settings writes and nothing else", () => {
    const text = [
      'ANTHROPIC_API_KEY="sk-ant-1"',
      "COMPOSIO_API_KEY=ck_2",
      "ELEVENLABS_API_KEY='el-3'",
      "EMPLOYEE001_TOKEN=should-not-load",
      'ELEVENLABS_API_KEY_OLD="x"',
      "# comment",
      "",
    ].join("\n");
    expect(parseSavedKeys(text)).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-1",
      COMPOSIO_API_KEY: "ck_2",
      ELEVENLABS_API_KEY: "el-3",
    });
  });

  it("skips empty values and the keychain placeholder", () => {
    expect(parseSavedKeys('ANTHROPIC_API_KEY=""\nCOMPOSIO_API_KEY="@keychain"\n')).toEqual({});
  });
});

describe("loadSavedKeys", () => {
  it("does nothing without EMPLOYEE001_ENV_FILE (Next reads .env itself)", () => {
    const env: Record<string, string | undefined> = {};
    expect(loadSavedKeys(env)).toEqual([]);
    expect(env).toEqual({});
  });

  it("loads saved keys from the volume, and the real environment wins", () => {
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, 'ANTHROPIC_API_KEY="from-settings"\nCOMPOSIO_API_KEY="ck"\n');
    process.env.EMPLOYEE001_ENV_FILE = file;
    const env: Record<string, string | undefined> = { EMPLOYEE001_ENV_FILE: file, COMPOSIO_API_KEY: "from-compose" };
    expect(loadSavedKeys(env)).toEqual(["ANTHROPIC_API_KEY"]);
    expect(env.ANTHROPIC_API_KEY).toBe("from-settings");
    expect(env.COMPOSIO_API_KEY).toBe("from-compose");
  });

  it("is quiet when nothing was saved yet", () => {
    process.env.EMPLOYEE001_ENV_FILE = path.join(dir, "missing.env");
    expect(loadSavedKeys({ EMPLOYEE001_ENV_FILE: process.env.EMPLOYEE001_ENV_FILE })).toEqual([]);
  });
});
