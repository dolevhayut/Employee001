import { execFileSync } from "node:child_process";
import { resolve, win32 } from "node:path";

function outputOf(run, file, args) {
  const output = run(file, args, { encoding: "utf8", timeout: 3_000, windowsHide: true });
  return Buffer.isBuffer(output) ? output.toString("utf8") : String(output ?? "");
}

/**
 * Checks whether the volume containing dataDir is protected by the OS.
 * It deliberately does not attempt to enable encryption or invoke sudo.
 *
 * @param {{ platform?: string, run?: (file: string, args: string[], options: object) => string | Buffer, dataDir?: string }} options
 */
export function checkDiskEncryption({ platform = process.platform, run = execFileSync, dataDir = resolve(process.cwd(), "data") } = {}) {
  try {
    if (platform === "darwin") {
      const detail = outputOf(run, "fdesetup", ["status"]).trim();
      if (/FileVault is On\./i.test(detail)) return { status: "on", detail };
      if (/FileVault is Off\./i.test(detail)) return { status: "off", detail };
      return { status: "unknown", detail: detail || "FileVault status was not recognized" };
    }

    if (platform === "win32") {
      const root = win32.parse(dataDir).root;
      const drive = root.match(/^[A-Za-z]:/)?.[0];
      if (!drive) return { status: "unknown", detail: "Could not determine the data drive" };
      const detail = outputOf(run, "manage-bde", ["-status", drive]).trim();
      if (/Protection Status:\s*Protection On/i.test(detail)) return { status: "on", detail };
      if (/Protection Status:\s*Protection Off/i.test(detail)) return { status: "off", detail };
      return { status: "unknown", detail: detail || "BitLocker status was not recognized" };
    }

    if (platform === "linux") {
      const source = outputOf(run, "findmnt", ["-no", "SOURCE", dataDir]).trim();
      if (/^\/dev\/mapper\//.test(source)) {
        return { status: "on", detail: `${source} is a device-mapper volume` };
      }
      const detail = outputOf(run, "lsblk", ["-no", "TYPE,MOUNTPOINT", source]).trim();
      if (/(^|\n)crypt(?:\s|$)/m.test(detail)) {
        return { status: "on", detail: `${source} is backed by a crypt mapper` };
      }
      return { status: "unknown", detail: source ? `${source} is not a detectable crypt mapper` : "Could not determine the data device" };
    }

    return { status: "unknown", detail: `Disk encryption check is not available on ${platform}` };
  } catch {
    return { status: "unknown", detail: "Could not check disk encryption" };
  }
}
