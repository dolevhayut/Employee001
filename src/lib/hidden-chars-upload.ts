// Hidden-character cleaning for uploaded file bytes. A twin reads any
// uploaded file that isn't a binary format as text, whatever its extension,
// so every upload that decodes as text is cleaned, in its own encoding.
// Pure (no fs), so the rules can be tested byte for byte.

import path from "path";
import { addHiddenCharCounts, stripHiddenChars, type HiddenCharCounts } from "./hidden-chars";

/** Extensions read as text whatever their bytes look like (a NUL byte in a
 *  .txt must not switch cleaning off). */
const TEXT_EXTS = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".text", ".csv", ".tsv", ".json", ".jsonl", ".ndjson",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties", ".xml", ".html", ".htm",
  ".xhtml", ".svg", ".eml", ".mbox", ".ics", ".vcf", ".log", ".rst", ".adoc", ".org", ".tex",
  ".rtf", ".srt", ".vtt", ".sql", ".graphql", ".proto", ".css", ".scss", ".py", ".rb", ".go",
  ".java", ".kt", ".swift", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".pl", ".lua",
  ".r", ".diff", ".patch", ".ipynb",
]);

const startsWith = (data: Buffer, ...bytes: number[]) => bytes.every((b, i) => data[i] === b);
const ascii = (data: Buffer, offset: number, text: string) =>
  data.length >= offset + text.length && data.toString("latin1", offset, offset + text.length) === text;
const zip = (d: Buffer) => startsWith(d, 0x50, 0x4b, 0x03, 0x04) || startsWith(d, 0x50, 0x4b, 0x05, 0x06) || startsWith(d, 0x50, 0x4b, 0x07, 0x08);
const ole = (d: Buffer) => startsWith(d, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const isoMedia = (d: Buffer) => ascii(d, 4, "ftyp");
const riff = (d: Buffer, kind: string) => ascii(d, 0, "RIFF") && ascii(d, 8, kind);

/** Binary formats, by extension AND signature: a file only counts as binary
 *  (left byte for byte) when its bytes really are that format. */
const BINARY_FORMATS: Array<{ exts: string[]; matches: (data: Buffer) => boolean }> = [
  { exts: [".pdf"], matches: (d) => d.subarray(0, 1024).includes("%PDF") },
  { exts: [".docx", ".xlsx", ".pptx", ".zip", ".odt", ".ods", ".odp", ".epub", ".pages", ".key", ".numbers", ".xlsm", ".docm"], matches: zip },
  { exts: [".doc", ".xls", ".ppt", ".msg"], matches: ole },
  { exts: [".png"], matches: (d) => startsWith(d, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  { exts: [".jpg", ".jpeg"], matches: (d) => startsWith(d, 0xff, 0xd8, 0xff) },
  { exts: [".gif"], matches: (d) => ascii(d, 0, "GIF87a") || ascii(d, 0, "GIF89a") },
  { exts: [".webp"], matches: (d) => riff(d, "WEBP") },
  { exts: [".wav"], matches: (d) => riff(d, "WAVE") },
  { exts: [".avi"], matches: (d) => riff(d, "AVI ") },
  { exts: [".bmp"], matches: (d) => ascii(d, 0, "BM") },
  { exts: [".tif", ".tiff"], matches: (d) => startsWith(d, 0x49, 0x49, 0x2a, 0x00) || startsWith(d, 0x4d, 0x4d, 0x00, 0x2a) },
  { exts: [".ico"], matches: (d) => startsWith(d, 0x00, 0x00, 0x01, 0x00) },
  { exts: [".mp4", ".m4a", ".m4v", ".mov", ".heic", ".heif", ".avif"], matches: isoMedia },
  { exts: [".mp3"], matches: (d) => ascii(d, 0, "ID3") || (d[0] === 0xff && (d[1] & 0xe0) === 0xe0) },
  { exts: [".ogg", ".oga", ".opus"], matches: (d) => ascii(d, 0, "OggS") },
  { exts: [".flac"], matches: (d) => ascii(d, 0, "fLaC") },
  { exts: [".gz", ".tgz"], matches: (d) => startsWith(d, 0x1f, 0x8b) },
  { exts: [".7z"], matches: (d) => startsWith(d, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) },
  { exts: [".rar"], matches: (d) => ascii(d, 0, "Rar!") },
  { exts: [".sqlite", ".db"], matches: (d) => ascii(d, 0, "SQLite format 3") },
  { exts: [".woff"], matches: (d) => ascii(d, 0, "wOFF") },
  { exts: [".woff2"], matches: (d) => ascii(d, 0, "wOF2") },
  { exts: [".ttf"], matches: (d) => startsWith(d, 0x00, 0x01, 0x00, 0x00) || ascii(d, 0, "true") },
  { exts: [".otf"], matches: (d) => ascii(d, 0, "OTTO") },
];

export type UploadTextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be";

/** Has a control character no text file has (NUL and the other C0 controls
 *  apart from tab, newlines, form feed and escape; DEL)? */
function hasBinaryControl(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x08 || (code >= 0x0e && code <= 0x1f && code !== 0x1b) || code === 0x7f) return true;
  }
  return false;
}

/**
 * UTF-16 without a byte-order mark. Spaces, newlines, digits and ASCII
 * punctuation put a zero in the high byte of their code unit (odd offsets
 * for little-endian, even for big-endian), so zeros pile up on one side.
 * Even mostly-Hebrew or Arabic text has them between words. The bytes must
 * also decode as valid UTF-16 with no NUL or binary control characters, so
 * a binary file with many zero bytes is not taken for text.
 *
 * Claude Code's Read decodes a file without a BOM as UTF-8, so that reading
 * must stay covered: when the bytes read as UTF-8 carry hidden characters,
 * they are cleaned as UTF-8, as before (a few NUL bytes in a UTF-8 file must
 * not switch its cleaning to another encoding).
 */
function bomlessUtf16(whole: Buffer): "utf-16le" | "utf-16be" | null {
  // An odd trailing byte doesn't make it something else: decode() keeps it
  // as a tail, so judge the even-length body (one appended byte must not
  // switch the detection off).
  const data = whole.length % 2 ? whole.subarray(0, whole.length - 1) : whole;
  if (data.length < 4) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < data.length; i += 2) {
    if (data[i] === 0) even += 1;
    if (data[i + 1] === 0) odd += 1;
  }
  const encoding = odd >= even ? "utf-16le" : "utf-16be";
  const highByte = encoding === "utf-16le" ? 1 : 0;
  const high = Math.max(odd, even);
  const low = Math.min(odd, even);
  // Surrogate pairs (tag characters, emoji) never hold a zero byte, so they
  // don't count against the ratio: padding with tags can't hide a file.
  let units = 0;
  for (let i = highByte; i < data.length; i += 2) if (data[i] < 0xd8 || data[i] > 0xdf) units += 1;
  // At least one code unit in 20 has a zero high byte, and the other side
  // (U+xx00 characters only) has almost none.
  if (high === 0 || high * 20 < units || low * 8 > high) return null;
  try {
    const text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(data);
    if (hasBinaryControl(text)) return null;
  } catch {
    return null;
  }
  return stripHiddenChars(whole.toString("utf-8")).total === 0 ? encoding : null;
}

/** How an upload will be read: as text in some encoding, or as binary. */
export function detectUploadEncoding(name: string, data: Buffer): UploadTextEncoding | "binary" {
  const ext = path.extname(name).toLowerCase();
  if (BINARY_FORMATS.some((format) => format.exts.includes(ext) && format.matches(data))) return "binary";
  // A byte-order mark settles it. UTF-32LE before UTF-16LE: its BOM starts
  // with the UTF-16LE one.
  if (startsWith(data, 0xff, 0xfe, 0x00, 0x00)) return "utf-32le";
  if (startsWith(data, 0x00, 0x00, 0xfe, 0xff)) return "utf-32be";
  if (startsWith(data, 0xff, 0xfe)) return "utf-16le";
  if (startsWith(data, 0xfe, 0xff)) return "utf-16be";
  // Before the extension check: a .txt saved as UTF-16 without a BOM would
  // otherwise be read as UTF-8, where its hidden characters don't show up.
  const utf16 = bomlessUtf16(data);
  if (utf16) return utf16;
  if (TEXT_EXTS.has(ext)) return "utf-8";
  // Unknown (or mislabelled) file: text unless it has a NUL byte, which no
  // UTF-8 text has and almost every binary format does.
  return data.includes(0) ? "binary" : "utf-8";
}

function decodeUtf32(data: Buffer, littleEndian: boolean): string {
  const parts: string[] = [];
  for (let i = 4; i + 4 <= data.length; i += 4) {
    const cp = littleEndian ? data.readUInt32LE(i) : data.readUInt32BE(i);
    parts.push(cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : "\uFFFD");
  }
  return parts.join("");
}

function encodeUtf32(text: string, littleEndian: boolean): Buffer {
  const cps = [...text].map((ch) => ch.codePointAt(0)!);
  const out = Buffer.alloc(4 * (cps.length + 1));
  const write = (value: number, offset: number) => (littleEndian ? out.writeUInt32LE(value, offset) : out.writeUInt32BE(value, offset));
  write(0xfeff, 0);
  cps.forEach((cp, i) => write(cp, 4 * (i + 1)));
  return out;
}

function decode(data: Buffer, encoding: UploadTextEncoding): { text: string; bom: Buffer; tail: Buffer } {
  const none = Buffer.alloc(0);
  switch (encoding) {
    case "utf-32le":
    case "utf-32be": {
      const usable = data.length - ((data.length - 4) % 4);
      return { text: decodeUtf32(data.subarray(0, usable), encoding === "utf-32le"), bom: none, tail: data.subarray(usable) };
    }
    case "utf-16le":
    case "utf-16be": {
      const usable = data.length - (data.length % 2);
      // With or without a BOM: a BOM-less file is written back without one.
      const bomLength = startsWith(data, ...(encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff])) ? 2 : 0;
      // Decodes lone surrogates lossily.
      const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(data.subarray(bomLength, usable));
      return { text, bom: data.subarray(0, bomLength), tail: data.subarray(usable) };
    }
    default: {
      const bom = startsWith(data, 0xef, 0xbb, 0xbf) ? data.subarray(0, 3) : none;
      // Lossy on invalid UTF-8 (a stray byte must not switch cleaning off).
      return { text: data.subarray(bom.length).toString("utf-8"), bom, tail: none };
    }
  }
}

function encode(text: string, encoding: UploadTextEncoding): Buffer {
  switch (encoding) {
    case "utf-32le":
    case "utf-32be":
      return encodeUtf32(text, encoding === "utf-32le");
    case "utf-16le":
      return Buffer.from(text, "utf16le");
    case "utf-16be":
      return Buffer.from(text, "utf16le").swap16();
    default:
      return Buffer.from(text, "utf-8");
  }
}

/**
 * Remove hidden characters from an uploaded file's bytes, keeping its
 * encoding (and BOM). Binary files are returned untouched. The bytes are
 * only rewritten when something was removed, so a clean file in any
 * encoding (Latin-1 included) is stored byte for byte.
 */
export function cleanUploadedBytes(
  name: string,
  data: Buffer,
): { data: Buffer; encoding: UploadTextEncoding | "binary"; removed?: HiddenCharCounts } {
  const encoding = detectUploadEncoding(name, data);
  if (encoding === "binary") return { data, encoding };
  const { text, bom, tail } = decode(data, encoding);
  const clean = stripHiddenChars(text);
  if (clean.total === 0) return { data, encoding };
  const body = encode(clean.text, encoding);
  // encodeUtf32 writes its own BOM.
  const head = encoding.startsWith("utf-32") ? Buffer.alloc(0) : bom;
  const out = Buffer.concat([head, body, tail]);
  // UTF-16 without a BOM is still read as UTF-8 by Claude Code. Removing
  // code units can join UTF-8 bytes they kept apart into a hidden character,
  // so that reading is cleaned too (lossy, but only a file built for this
  // has anything to remove there).
  if (encoding.startsWith("utf-16") && bom.length === 0) {
    const asUtf8 = stripHiddenChars(out.toString("utf-8"));
    if (asUtf8.total > 0) {
      return { data: Buffer.from(asUtf8.text, "utf-8"), encoding, removed: addHiddenCharCounts(clean.removed, asUtf8.removed) };
    }
  }
  return { data: out, encoding, removed: clean.removed };
}
