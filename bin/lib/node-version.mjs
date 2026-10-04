const LTS_MAJOR_VERSIONS = new Set([22, 24]);

/**
 * Report whether a Node.js version is supported by Employee001's native modules.
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
    message: `Node ${major} is not supported yet (native modules); use Node 24 LTS, e.g. \`nvm install 24 && nvm use 24\``,
  };
}
