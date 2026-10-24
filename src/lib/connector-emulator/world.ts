// The CompanySim company the emulator answers from, read once per process over
// CompanySim's read-only REST API (https://github.com/dolevhayut/companysim).

export type Row = Record<string, unknown> & { id: string };

export const WORLD_TYPES = [
  "people", "roles", "teams", "departments", "projects", "customers", "contacts",
  "tickets", "documents", "channels", "conversations", "messages", "tools",
] as const;

export type World = Record<(typeof WORLD_TYPES)[number], Row[]>;

export function companySimUrl(): string {
  return (process.env.COMPANYSIM_URL ?? "http://127.0.0.1:4545").replace(/\/$/, "");
}

async function list(base: string, type: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | null = null;
  do {
    const url = `${base}/api/v1/${type}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`CompanySim ${type}: HTTP ${res.status}. Is it running (docker compose up -d in the companysim repo)?`);
    const page = (await res.json()) as { items: Row[]; nextCursor: string | null };
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

let cached: { url: string; world: Promise<World> } | null = null;

/** The whole company, cached per CompanySim URL. Records come back in id order. */
export function loadWorld(base = companySimUrl()): Promise<World> {
  if (cached?.url === base) return cached.world;
  const world = Promise.all(WORLD_TYPES.map((t) => list(base, t))).then(
    (rows) => Object.fromEntries(WORLD_TYPES.map((t, i) => [t, rows[i]])) as World,
  );
  // A failed load must not stick: the next call retries.
  world.catch(() => { if (cached?.world === world) cached = null; });
  cached = { url: base, world };
  return world;
}

/** Tests inject a fixture world instead of calling CompanySim. */
export function setWorldForTests(world: World | null, base = companySimUrl()): void {
  cached = world ? { url: base, world: Promise.resolve(world) } : null;
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
