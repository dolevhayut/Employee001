import { describe, expect, it } from "vitest";
import { checkDiskEncryption } from "../../bin/lib/disk-encryption.mjs";

describe("checkDiskEncryption", () => {
  it("recognizes FileVault status", () => {
    expect(checkDiskEncryption({ platform: "darwin", run: () => "FileVault is On.\n" })).toMatchObject({ status: "on" });
    expect(checkDiskEncryption({ platform: "darwin", run: () => "FileVault is Off.\n" })).toMatchObject({ status: "off" });
  });

  it("recognizes a Linux crypt mapper", () => {
    const run = (file: string) => file === "findmnt" ? "/dev/mapper/cryptdata\n" : "";
    expect(checkDiskEncryption({ platform: "linux", run })).toMatchObject({ status: "on" });
  });

  it("recognizes BitLocker status", () => {
    expect(checkDiskEncryption({ platform: "win32", dataDir: "C:\\Employee001\\data", run: () => "Protection Status:    Protection On" })).toMatchObject({ status: "on" });
  });

  it("reports command failures as unknown", () => {
    expect(checkDiskEncryption({ platform: "darwin", run: () => { throw new Error("no access"); } })).toMatchObject({ status: "unknown" });
  });
});
