import { parentPort, workerData } from "node:worker_threads";
import { extractKnowledgeText, type KnowledgeExtractInput } from "@/lib/knowledge-extract-core";

void extractKnowledgeText(workerData as KnowledgeExtractInput).then(
  (result) => parentPort?.postMessage(result),
  (error: unknown) => {
    throw error;
  }
);
