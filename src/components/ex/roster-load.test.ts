import { describe, expect, it, vi } from "vitest";
import { autonomyGate, fetchRoster, twinsGate } from "./roster-load";

const okJson = (body: unknown) =>
  vi.fn(async () => ({ json: async () => body }) as unknown as Response) as unknown as typeof fetch;

describe("fetchRoster", () => {
  it("returns the roster array from /api/employees", async () => {
    const fetchImpl = okJson([{ id: "e1", twinStatus: "ready" }]);
    await expect(fetchRoster(fetchImpl)).resolves.toEqual([{ id: "e1", twinStatus: "ready" }]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/employees");
  });

  it("returns null (not a rejection) when the body is not an array", async () => {
    await expect(fetchRoster(okJson({ error: "boom" }))).resolves.toBeNull();
  });

  it("returns null (not a rejection) when the request fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(fetchRoster(fetchImpl)).resolves.toBeNull();
  });

  it("returns null when the body is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    await expect(fetchRoster(fetchImpl)).resolves.toBeNull();
  });
});

describe("twinsGate", () => {
  it("never reports an empty roster before it has loaded", () => {
    expect(twinsGate(false, 0)).toBe("loading");
    expect(twinsGate(false, 3)).toBe("loading");
  });

  it("reports empty or ready once loaded", () => {
    expect(twinsGate(true, 0)).toBe("empty");
    expect(twinsGate(true, 2)).toBe("ready");
  });
});

describe("autonomyGate", () => {
  it("never reports off before the mode has loaded", () => {
    expect(autonomyGate(false, "base")).toBe("loading");
    expect(autonomyGate(false, "x")).toBe("loading");
  });

  it("reports armed or off once loaded", () => {
    expect(autonomyGate(true, "x")).toBe("armed");
    expect(autonomyGate(true, "base")).toBe("off");
  });
});
