// Hidden-character cleaning for uploaded file bytes. A twin reads any
// uploaded file that isn't a binary format as text, whatever its extension,
// so every upload that decodes as text is cleaned, in its own encoding.
// Pure (no fs), so the rules can be tested byte for byte.

import path from "path";
import { stripHiddenChars, type HiddenCharCounts } from "./hidden-chars";

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
  if (TEXT_EXTS.has(ext)) return "utf-8";
  // Unknown (or mislabelled) file: text unless it has a NUL byte, which no
  // UTF-8 text has and almost every binary format does.
  return data.includes(0) ? "binary" : "utf-8";
}

function decodeUtf32(data: Buffer, littleEndian: boolean): string {
  const parts: string[] = [];
  for (let i = 4; i + 4 <= data.length; i += 4) {
    const cp = littleEndian ? data.readUInt32LE(i) : data.readUInt32BE(i);
    parts.push(cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : "�");
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
      // TextDecoder drops the BOM and decodes lone surrogates lossily.
      const text = new TextDecoder(encoding).decode(data.subarray(2, usable));
      return { text, bom: data.subarray(0, 2), tail: data.subarray(usable) };
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
  return { data: Buffer.concat([head, body, tail]), encoding, removed: clean.removed };
}
