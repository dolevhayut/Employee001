/**
 * May text a model wrote load this image on its own? A twin's reply, a
 * profile file or a preview can carry text from a poisoned email, folder
 * file or document, and a remote image is fetched the moment it renders: a
 * way to send data out that never passes the WebFetch approval. Only
 * same-origin paths and inline data are loaded; everything else is shown as
 * text the person can open on purpose.
 */
export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== "string") return false;
  const value = src.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(value)) return true;
  if (/^blob:/i.test(value)) return true;
  // "/path" but not "//host/path" (protocol-relative) or "/\host".
  return /^\/(?![/\\])/.test(value);
}

/** CSS that fetches a resource: url(...), image-set(...), @import. */
export function styleLoadsResource(style: string): boolean {
  return /url\s*\(|image-set\s*\(|@import/i.test(style);
}
