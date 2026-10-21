// The environment the Claude Code child process gets. It used to inherit all
// of process.env, so every secret the app holds (Composio, OpenAI,
// ElevenLabs, Telegram, Slack bot, the workspace token…) was readable by a
// prompt-injected twin through the child. Only what the child needs to run
// and to reach the configured model provider passes through.

const EXACT = new Set([
  // Process basics
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG", "TZ", "TERM",
  "SYSTEMROOT", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "PROGRAMDATA",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
  "NODE_ENV", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
  // Network egress through a corporate proxy
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  // Model providers (model-provider.ts)
  "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK", "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "CLOUD_ML_REGION",
  "AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_CLIENT_SECRET", "AZURE_FEDERATED_TOKEN_FILE",
]);

const PREFIXES = ["LC_", "ANTHROPIC_", "CLAUDE_", "VERTEX_REGION_"];

export function isSdkChildEnvVar(name: string): boolean {
  return EXACT.has(name) || PREFIXES.some((p) => name.startsWith(p));
}

/** process.env narrowed to the allowlist, merged with explicit overrides.
 *  Undefined values are dropped (a stringified "undefined" reads as truthy
 *  in the child). */
export function sdkChildEnv(
  source: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && isSdkChildEnvVar(key)) out[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}
