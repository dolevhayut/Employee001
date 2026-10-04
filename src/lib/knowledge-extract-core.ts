// PDF/DOCX → text, shared by the extraction worker (production) and the
// inline path (next dev, where the bundled worker can't boot). Keep it free
// of request/Next.js state so it runs in either place.

import mammoth from "mammoth";
import { extractTextItems, getDocumentProxy } from "unpdf";
import { textFromPositionedPdfItems } from "@/lib/rtl-text";

export type KnowledgeExtractInput = {
  ext: ".pdf" | ".docx";
  data: Buffer;
  maxTextBytes: number;
};

export type KnowledgeExtractResult = { body: string; truncated: boolean };

function capText(text: string, maxTextBytes: number): KnowledgeExtractResult {
  const bytes = Buffer.from(text, "utf-8");
  if (bytes.length <= maxTextBytes) return { body: text, truncated: false };
  return {
    body: bytes.subarray(0, maxTextBytes).toString("utf-8"),
    truncated: true,
  };
}

export async function extractKnowledgeText({
  ext,
  data,
  maxTextBytes,
}: KnowledgeExtractInput): Promise<KnowledgeExtractResult> {
  if (ext === ".pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    try {
      const { items } = await extractTextItems(pdf);
      return capText(items.map(textFromPositionedPdfItems).join("\n"), maxTextBytes);
    } finally {
      await pdf.loadingTask.destroy();
    }
  }

  const { value } = await mammoth.extractRawText({ buffer: data });
  return capText(value, maxTextBytes);
}
