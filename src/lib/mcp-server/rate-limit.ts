const KEY = "__e001McpAskTimestamps";
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 20;

function timestamps(): number[] {
  const state = globalThis as typeof globalThis & { [KEY]?: number[] };
  return (state[KEY] ??= []);
}

/** Returns true and consumes a slot when the rolling global limit permits it. */
export function takeAskTwinRateLimit(now = Date.now()): boolean {
  const state = timestamps();
  const cutoff = now - WINDOW_MS;
  while (state.length && state[0] <= cutoff) state.shift();
  if (state.length >= LIMIT) return false;
  state.push(now);
  return true;
}
