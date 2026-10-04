import { describe, expect, it } from "vitest";

import { withSidecarLock } from "./sidecar-lock";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

describe("withSidecarLock", () => {
  it("runs overlapping calls for the same id strictly in order", async () => {
    const events: string[] = [];
    const firstDone = deferred();
    const first = withSidecarLock("same", async () => {
      events.push("first:start");
      await firstDone.promise;
      events.push("first:end");
    });
    const second = withSidecarLock("same", async () => events.push("second"));

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    firstDone.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("allows calls for different ids to run concurrently", async () => {
    const events: string[] = [];
    const aDone = deferred();
    const bDone = deferred();
    const a = withSidecarLock("a", async () => { events.push("a:start"); await aDone.promise; });
    const b = withSidecarLock("b", async () => { events.push("b:start"); await bDone.promise; });

    await Promise.resolve();
    expect(events).toEqual(expect.arrayContaining(["a:start", "b:start"]));
    aDone.resolve();
    bDone.resolve();
    await Promise.all([a, b]);
  });

  it("continues with the next call after a rejection", async () => {
    const failed = withSidecarLock("same", async () => { throw new Error("expected"); });
    const next = withSidecarLock("same", async () => "ran");

    await expect(failed).rejects.toThrow("expected");
    await expect(next).resolves.toBe("ran");
  });
});
