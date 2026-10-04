import { describe, expect, it } from "vitest";
import { checkNodeVersion } from "../../bin/lib/node-version.mjs";

describe("checkNodeVersion", () => {
  it.each(["22.0.0", "v22.12.0", "24.0.0", "24.12.0"])("accepts supported Node %s", (version) => {
    const major = Number(version.replace(/^v/, "").split(".")[0]);
    expect(checkNodeVersion(version)).toEqual({ ok: true, level: "ok", message: `Node ${major} is supported` });
  });

  it.each(["23.0.0", "25.0.0", "26.0.0"])("warns for unsupported Node %s", (version) => {
    const result = checkNodeVersion(version);
    expect(result.level).toBe("warn");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("use Node 24 LTS");
  });

  it("rejects Node versions below 22", () => {
    expect(checkNodeVersion("21.7.3")).toEqual({ ok: false, level: "error", message: "Node 21 is too old; use Node 24 LTS" });
  });

  it("rejects an unparseable version", () => {
    expect(checkNodeVersion("banana").level).toBe("error");
  });
});
