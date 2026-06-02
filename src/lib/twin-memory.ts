import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const MEMORY_ROOT = path.join(process.cwd(), "data", "memory");
const DEFAULT_LIMIT = 5;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const RRF_K = 50;

export type TwinMemorySurface = "chat" | "background" | "council" | "task";

export type TwinMemoryCard = {
  id: string;
  employeeId: string;
  runId: string;
  surface: TwinMemorySurface;
  content: string;
  question: string;
  answerPreview: string;
  embedding?: number[];
  embeddingModel?: string;
  createdAt: string;
};

export type TwinMemoryEpisode = {
  id: string;
  employeeId: string;
  runId: string;
  surface: TwinMemorySurface;
  question: string;
  answer: string;
  createdAt: string;
};

export type TwinMemoryHit = {
  card: TwinMemoryCard;
  score: number;
  keywordScore: number;
  semanticScore: number;
};

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
};

function isEnabled(): boolean {
  return process.env.TWIN_MEMORY_ENABLED !== "false";
}

function searchLimit(): number {
  const raw = Number.parseInt(process.env.TWIN_MEMORY_SEARCH_LIMIT ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 10);
  return DEFAULT_LIMIT;
}

function memoryDir(employeeId: string): string {
  return path.join(MEMORY_ROOT, safeSegment(employeeId));
}

function cardsPath(employeeId: string): string {
  return path.join(memoryDir(employeeId), "cards.jsonl");
}

function episodesPath(employeeId: string): string {
  return path.join(memoryDir(employeeId), "episodes.jsonl");
}

function ensureDir(employeeId: string): void {
  fs.mkdirSync(memoryDir(employeeId), { recursive: true });
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function appendJsonl(filePath: string, value: unknown): void {
  const line = `${JSON.stringify(value)}\n`;
  fs.appendFileSync(filePath, line, "utf8");
  // Mirror to Fabric lakehouse when STORAGE_BACKEND=fabric. Lazy-loaded to
  // avoid a circular import (storage/onelake-client → audit-log → twin-memory).
  if (process.env.STORAGE_BACKEND === "fabric") {
    void (async () => {
      try {
        const mod = await import("@/lib/storage/onelake-client");
        if (!mod.isOneLakeConfigured()) return;
        // Path convention: twin_memory/<employeeId>/<filename>.jsonl
        const rel = path
          .relative(path.join(process.cwd(), "data"), filePath)
          .replace(/\\/g, "/");
        const segments = rel.split("/");
        const filename = segments.pop() ?? "memory.jsonl";
        const table = ["twin_memory", ...segments.slice(1)].join("/");
        await mod.appendOneLake({ table, filename, data: line });
      } catch (err) {
        console.warn(
          `[twin-memory] Fabric mirror failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    })();
  }
}

function truncate(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trim()}...`;
}

function sanitize(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{16,}/g, "[redacted_openai_key]")
    .replace(/sk-ant-[a-zA-Z0-9_-]{16,}/g, "[redacted_anthropic_key]")
    .replace(/ak_[a-zA-Z0-9_-]{12,}/g, "[redacted_api_key]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{16,}/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key["'\s:=]+)[a-zA-Z0-9._-]{12,}/gi, "$1[redacted]")
    .replace(/(token["'\s:=]+)[a-zA-Z0-9._-]{12,}/gi, "$1[redacted]");
}

function cardContent(question: string, answer: string): string {
  return [
    `CEO asked: ${truncate(question, 500)}`,
    `Twin answered: ${truncate(answer, 900)}`,
  ].join("\n");
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return matches.filter((token) => !STOPWORDS.has(token));
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "של",
  "על",
  "עם",
  "את",
  "זה",
  "זו",
  "אני",
  "אנחנו",
  "הוא",
  "היא",
  "מה",
  "איך",
]);

function keywordScore(query: string, content: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;

  const contentTokens = new Set(tokenize(content));
  let hits = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) hits++;
  }
  return hits / queryTokens.size;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function createEmbedding(input: string, employeeId: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const model = process.env.TWIN_MEMORY_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions = Number.parseInt(
    process.env.TWIN_MEMORY_EMBEDDING_DIMENSIONS ?? "",
    10
  );

  const body: Record<string, unknown> = {
    input: truncate(input.replace(/\n/g, " "), 6000),
    model,
    encoding_format: "float",
    user: employeeId,
  };
  if (Number.isFinite(dimensions) && dimensions > 0) {
    body.dimensions = dimensions;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json()) as EmbeddingResponse;
    if (!response.ok) {
      console.warn(
        `[twin-memory] embedding failed: ${json.error?.message ?? response.statusText}`
      );
      return null;
    }

    return json.data?.[0]?.embedding ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[twin-memory] embedding failed: ${message}`);
    return null;
  }
}

function rrf(rank: number | undefined, weight = 1): number {
  if (rank === undefined) return 0;
  return weight / (RRF_K + rank + 1);
}

function ranksByScore(
  cards: TwinMemoryCard[],
  score: (card: TwinMemoryCard) => number
): Map<string, number> {
  const ranked = cards
    .map((card) => ({ card, score: score(card) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return new Map(ranked.map((item, index) => [item.card.id, index]));
}

export async function searchTwinMemory(
  employeeId: string,
  query: string,
  limit = searchLimit()
): Promise<TwinMemoryHit[]> {
  if (!isEnabled()) return [];

  const cards = readJsonl<TwinMemoryCard>(cardsPath(employeeId));
  if (cards.length === 0) return [];

  const queryEmbedding = await createEmbedding(query, employeeId);
  const keywordScores = new Map(
    cards.map((card) => [card.id, keywordScore(query, card.content)])
  );
  const semanticScores = new Map(
    cards.map((card) => [
      card.id,
      queryEmbedding && card.embedding
        ? cosineSimilarity(queryEmbedding, card.embedding)
        : 0,
    ])
  );

  const keywordRanks = ranksByScore(cards, (card) => keywordScores.get(card.id) ?? 0);
  const semanticRanks = ranksByScore(cards, (card) => semanticScores.get(card.id) ?? 0);
  const recencyRanks = new Map(
    [...cards]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .map((card, index) => [card.id, index])
  );

  return cards
    .map((card) => {
      const score =
        rrf(keywordRanks.get(card.id), 1) +
        rrf(semanticRanks.get(card.id), 1) +
        rrf(recencyRanks.get(card.id), 0.25);
      return {
        card,
        score,
        keywordScore: keywordScores.get(card.id) ?? 0,
        semanticScore: semanticScores.get(card.id) ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatTwinMemoryBlock(hits: TwinMemoryHit[]): string {
  if (hits.length === 0) return "";

  const memories = hits
    .map((hit, index) => {
      const created = hit.card.createdAt.slice(0, 10);
      return `${index + 1}. (${created}, ${hit.card.surface}) ${hit.card.content}`;
    })
    .join("\n\n");

  return `# Relevant episodic memory

These are prior interactions or task outcomes for this same twin. Use them only
when relevant. Treat profile files as higher authority if there is a conflict.

${memories}`;
}

export async function rememberTwinRun(input: {
  employeeId: string;
  runId: string;
  surface: TwinMemorySurface;
  question: string;
  answer: string;
}): Promise<void> {
  if (!isEnabled()) return;

  const question = sanitize(truncate(input.question, 4000));
  const answer = sanitize(truncate(input.answer, 6000));
  if (!question || !answer) return;

  ensureDir(input.employeeId);
  const createdAt = new Date().toISOString();
  const episode: TwinMemoryEpisode = {
    id: randomUUID(),
    employeeId: input.employeeId,
    runId: input.runId,
    surface: input.surface,
    question,
    answer,
    createdAt,
  };

  const content = cardContent(question, answer);
  const embedding = await createEmbedding(content, input.employeeId);
  const card: TwinMemoryCard = {
    id: randomUUID(),
    employeeId: input.employeeId,
    runId: input.runId,
    surface: input.surface,
    content,
    question: truncate(question, 500),
    answerPreview: truncate(answer, 900),
    ...(embedding
      ? {
          embedding,
          embeddingModel:
            process.env.TWIN_MEMORY_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
        }
      : {}),
    createdAt,
  };

  appendJsonl(episodesPath(input.employeeId), episode);
  appendJsonl(cardsPath(input.employeeId), card);
}
