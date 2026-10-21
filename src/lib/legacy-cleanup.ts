// One-time removal of files older versions wrote and this one must not keep.

import "server-only";
import fs from "fs";
import { dataDir } from "./app-home";

/** data/council-debug.log held CEO questions and twin names with no retention
 *  (written before 71fbff1 and again for a while after). Nothing reads it. */
export function removeLegacyDebugLog(): boolean {
  const abs = dataDir("council-debug.log");
  try {
    if (!fs.existsSync(abs)) return false;
    fs.rmSync(abs, { force: true });
    return true;
  } catch {
    return false;
  }
}
