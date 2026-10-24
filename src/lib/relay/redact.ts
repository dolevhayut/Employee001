// PII and secret redaction for handover packages.

/**
 * Simple, deterministic PII + secret redaction pass.
 *
 * Scrubs the categories most likely to leak through a free-text interview
 * answer before it is committed to the RCP: emails, phone numbers, and
 * anything that looks like a credential / token / key / password. A defensive
 * pass, not a guarantee: reviewers still read every item before it's used.
 *
 * Order matters: credential-bearing key:value pairs are caught first (so we
 * don't half-redact them with the generic token rule), then structured PII.
 */
export function redactPii(text: string): string {
  if (!text) return text;
  let out = text;

  // 1) Explicit secret ASSIGNMENTS: password=..., api_key: ..., token is "...".
  //    Only an actual assignment separator (`:`, `=`, or the word `is`) counts —
  //    a bare space does NOT, so legitimate prose like "auth services",
  //    "token bucket", or "secret sauce" is left intact. Capture the label +
  //    separator, redact the value (to end of quote / whitespace run).
  out = out.replace(
    /\b(pass(?:word|wd|phrase)?|secret|api[_-]?key|access[_-]?key|token|bearer|authorization|client[_-]?secret|private[_-]?key|credential)s?\b(\s*[:=]\s*|\s+is\s+)(["']?)([^\s"']{4,})\3/gi,
    (_m, label: string, sep: string) => `${label}${sep}[REDACTED-SECRET]`,
  );

  // 2) Bearer / Authorization header style: "Bearer eyJ..." already covered above,
  //    but also catch standalone JWT-ish and long hex/base64 secrets.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\b/g, "[REDACTED-TOKEN]");
  // Common provider key prefixes (sk-, pk-, ghp_, xoxb-, AKIA…, AIza…).
  out = out.replace(
    /\b(?:sk|pk|rk)[-_][A-Za-z0-9]{16,}\b/g,
    "[REDACTED-TOKEN]",
  );
  out = out.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "[REDACTED-TOKEN]");
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED-TOKEN]");
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED-TOKEN]");
  out = out.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED-TOKEN]");
  // Generic long hex (>=32) or base64-ish (>=32) run that looks like a secret.
  out = out.replace(/\b[0-9a-fA-F]{32,}\b/g, "[REDACTED-TOKEN]");

  // 3) Emails.
  out = out.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    "[REDACTED-EMAIL]",
  );

  // 4) Phone numbers (international + common separators, 7+ digits).
  out = out.replace(
    /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\w)/g,
    (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15 ? "[REDACTED-PHONE]" : m;
    },
  );

  return out;
}
