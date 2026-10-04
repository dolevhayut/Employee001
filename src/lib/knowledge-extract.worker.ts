import mammoth from "mammoth";
import { parentPort, workerData } from "node:worker_threads";
import { extractTextItems, getDocumentProxy } from "unpdf";
import { textFromPositionedPdfItems } from "@/lib/rtl-text";

type WorkerInput = {
  ext: ".pdf" | ".docx";
  data: Buffer;
  maxTextBytes: number;
};

function capText(text: string, maxTextBytes: number) {
  const bytes = Buffer.from(text, "utf-8");
  if (bytes.length <= maxTextBytes) return { body: text, truncated: false };
  return {
    body: bytes.subarray(0, maxTextBytes).toString("utf-8"),
    truncated: true,
  };
}

async function extract({ ext, data, maxTextBytes }: WorkerInput) {
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

void extract(workerData as WorkerInput).then(
  (result) => parentPort?.postMessage(result),
  (error: unknown) => {
    throw error;
  }
);
