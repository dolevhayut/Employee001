const LTS_MAJOR_VERSIONS = new Set([22, 24]);

/**
 * Report whether Employee001 is tested on this Node.js version (the LTS lines).
 *
 * @param {string} version
 * @returns {{ ok: boolean, level: "ok" | "warn" | "error", message: string }}
 */
export function checkNodeVersion(version = process.versions.node) {
  const match = String(version).match(/^v?(\d+)/);
  const major = match ? Number(match[1]) : Number.NaN;

  if (!Number.isSafeInteger(major)) {
    return {
      ok: false,
      level: "error",
      message: `Could not determine the Node version from ${JSON.stringify(version)}; use Node 24 LTS`,
    };
  }

  if (major < 22) {
    return {
      ok: false,
      level: "error",
      message: `Node ${major} is too old; use Node 24 LTS`,
    };
  }

  if (LTS_MAJOR_VERSIONS.has(major)) {
    return { ok: true, level: "ok", message: `Node ${major} is supported` };
  }

  return {
    ok: true,
    level: "warn",
    message: `Node ${major} isn't an LTS release; Employee001 is tested on Node 22 and 24. If something misbehaves, switch to Node 24 LTS (e.g. \`nvm install 24 && nvm use 24\`).`,
  };
}
