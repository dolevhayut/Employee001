import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { isSafeDocxZip } from "./knowledge-files";

function centralDirectoryOffsets(zip: Buffer): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset <= zip.length - 4; offset += 1) {
    if (zip.readUInt32LE(offset) === 0x02014b50) offsets.push(offset);
  }
  return offsets;
}

async function docxLikeZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

function declareSizes(zip: Buffer, entry: number, compressed: number, uncompressed: number): Buffer {
  const copy = Buffer.from(zip);
  const offset = centralDirectoryOffsets(copy)[entry];
  if (offset === undefined) throw new Error("ZIP entry was not found");
  copy.writeUInt32LE(compressed, offset + 20);
  copy.writeUInt32LE(uncompressed, offset + 24);
  return copy;
}

describe("isSafeDocxZip", () => {
  it("accepts a normal small DOCX-like ZIP", async () => {
    await expect(isSafeDocxZip(await docxLikeZip({ "word/document.xml": "<w:document />" }))).toBe(true);
  });

  it("rejects an entry declaring more than 50 MB uncompressed", async () => {
    const zip = await docxLikeZip({ "word/document.xml": "small" });
    expect(isSafeDocxZip(declareSizes(zip, 0, 1024 * 1024, 51 * 1024 * 1024))).toBe(false);
  });

  it("rejects archives declaring more than 100 MB in total", async () => {
    const zip = await docxLikeZip({ a: "a", b: "b", c: "c" });
    let declared = zip;
    for (let entry = 0; entry < 3; entry += 1) {
      declared = declareSizes(declared, entry, 1024 * 1024, 40 * 1024 * 1024);
    }
    expect(isSafeDocxZip(declared)).toBe(false);
  });

  it("rejects an entry declaring a compression ratio above 200x", async () => {
    const zip = await docxLikeZip({ "word/document.xml": "small" });
    expect(isSafeDocxZip(declareSizes(zip, 0, 1, 201))).toBe(false);
  });

  it("rejects bytes that are not a ZIP", () => {
    expect(isSafeDocxZip(Buffer.from("not a zip"))).toBe(false);
  });
});
