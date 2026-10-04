import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { TWIN_MODEL_FALLBACK, TWIN_MODEL_HAIKU } from "@/lib/sdk-defaults";
import { currentProvider, directAnthropicAllowed, modelForProvider, providerEnvForAgentSdk } from "@/lib/model-provider";

const MEMORY_ROOT = path.join(process.cwd(), "data", "memory");
const DEFAULT_LIMIT = 5;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const RRF_K = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Reinforcement + decay (Memongo "importance decay" / access tracking) ─────
// Frequently-recalled cards stay salient; untouched ones fade. We keep the
// mutable reinforcement signal in a small sidecar (access.json) so the canonical
// cards.jsonl stays an append-only, race-free log — the same denormalized split
// Memongo uses between its canonical collections and `access_events`.
const DEFAULT_HALF_LIFE_DAYS = 14; // a card's decay halves every N days since last touch
const REINFORCE_GAIN = 0.5; // how hard repeated recalls boost salience

// ─── Dedup-on-write (Memongo near-duplicate prune, cosine > 0.92) ─────────────
const DEFAULT_DEDUP_THRESHOLD = 0.92;
const DEDUP_SCAN_LIMIT = 200; // only the recent tail is checked for duplicates

// ─── Relevance gate (abstention) ─────────────────────────────────────────────
// Salience is a MODIFIER, not a qualifier. `ranksByScore` drops zero-score
// cards, but salience is always > 0 — so before this gate every card earned a
// salience rank, every card scored > 0, and `searchTwinMemory` always returned
// a full `limit` of cards. A query with nothing relevant in the corpus still
// got 5 "memories" injected into the twin's prompt, which it then reasoned
// over as if they were context. A card must now clear at least one RELEVANCE
// signal to be eligible; salience only reorders what already survived.
const DEFAULT_MIN_KEYWORD = 0; // strict floor — default admits any shared non-stopword token
const DEFAULT_MIN_SEMANTIC = 0.25; // cosine floor; unrelated embedding pairs sit well below this

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
  /** Base salience at write time (default 1). Reinforcement lives in the
   *  access sidecar, not here — this stays an immutable per-card baseline. */
  importance?: number;
  createdAt: string;
};

/** Mutable per-card reinforcement, stored in data/memory/<id>/access.json. */
type AccessRecord = { count: number; lastAccessedAt: string };
type AccessMap = Record<string, AccessRecord>;

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
  salienceScore: number;
};

// ─── Recall profiles (ported from Memongo MEMONGO_MONGODB_RECALL_PROFILE) ─────
// Tune the fusion weights for the three signals. `balanced` is the default.
type FusionWeights = { keyword: number; semantic: number; salience: number };
const RECALL_PROFILES: Record<string, FusionWeights> = {
  latency: { keyword: 1, semantic: 0.5, salience: 0.5 },
  balanced: { keyword: 1, semantic: 1, salience: 0.5 },
  proof: { keyword: 1, semantic: 1.5, salience: 0.25 },
};

function recallWeights(): FusionWeights {
  const profile = (process.env.TWIN_MEMORY_RECALL_PROFILE ?? "balanced").toLowerCase();
  return RECALL_PROFILES[profile] ?? RECALL_PROFILES.balanced;
}

function halfLifeDays(): number {
  const raw = Number.parseFloat(process.env.TWIN_MEMORY_HALF_LIFE_DAYS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HALF_LIFE_DAYS;
}

function dedupThreshold(): number {
  const raw = Number.parseFloat(process.env.TWIN_MEMORY_DEDUP_THRESHOLD ?? "");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_DEDUP_THRESHOLD;
}

/** Escape hatch: `TWIN_MEMORY_RELEVANCE_GATE=0` restores pre-gate behaviour
 *  (always return `limit` cards, ranked by salience when nothing matches). */
function relevanceGateEnabled(): boolean {
  return process.env.TWIN_MEMORY_RELEVANCE_GATE !== "0";
}

function minKeyword(): number {
  const raw = Number.parseFloat(process.env.TWIN_MEMORY_MIN_KEYWORD ?? "");
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_MIN_KEYWORD;
}

function minSemantic(): number {
  const raw = Number.parseFloat(process.env.TWIN_MEMORY_MIN_SEMANTIC ?? "");
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_MIN_SEMANTIC;
}

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

function accessPath(employeeId: string): string {
  return path.join(memoryDir(employeeId), "access.json");
}

function structuredPath(employeeId: string): string {
  return path.join(memoryDir(employeeId), "structured.jsonl");
}

function readAccessMap(employeeId: string): AccessMap {
  try {
    const file = accessPath(employeeId);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AccessMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Reinforce the given cards: bump their recall count and last-touch time.
 *  Best-effort — failures are swallowed so recall never breaks on a write. */
function reinforce(employeeId: string, cardIds: string[]): void {
  if (cardIds.length === 0) return;
  try {
    const map = readAccessMap(employeeId);
    const now = new Date().toISOString();
    for (const id of cardIds) {
      const prev = map[id];
      map[id] = { count: (prev?.count ?? 0) + 1, lastAccessedAt: now };
    }
    ensureDir(employeeId);
    fs.writeFileSync(accessPath(employeeId), JSON.stringify(map), "utf8");
  } catch {
    /* reinforcement is advisory; never throw into the recall path */
  }
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
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
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

// Kept deliberately in sync with the list in `org-brain-search.ts` (that module
// is `server-only`, so it can't be imported here or by the bench harness). The
// short list this replaced let question scaffolding — "how do we", "what is our"
// — count as topical overlap: an unrelated query scored 0.42 keyword similarity
// against a card purely on how/do/we/data/new, which is why recall could not
// tell a distractor from a match.
const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "all",
  "also",
  "any",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "can",
  "cannot",
  "could",
  "did",
  "does",
  "doing",
  "done",
  "down",
  "during",
  "each",
  "from",
  "get",
  "gets",
  "had",
  "her",
  "here",
  "him",
  "his",
  "how",
  "into",
  "its",
  "just",
  "like",
  "make",
  "makes",
  "many",
  "may",
  "might",
  "more",
  "most",
  "much",
  "must",
  "need",
  "needs",
  "new",
  "not",
  "now",
  "off",
  "one",
  "only",
  "onto",
  "other",
  "our",
  "ours",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "some",
  "such",
  "than",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "those",
  "through",
  "too",
  "under",
  "until",
  "use",
  "used",
  "uses",
  "very",
  "want",
  "way",
  "well",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whose",
  "why",
  "will",
  "with",
  "would",
  "your",
  "yours",
  "the",
  "and",
  "for",
  "that",
  "this",
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

/**
 * Corpus-local, IDF-weighted keyword coverage. A match on a term that appears
 * in few memories contributes more than a match on one that appears nearly
 * everywhere, while dividing by all query-term weights keeps the score in
 * [0, 1] for the relevance gate and fusion lanes.
 */
function scoreKeywords(query: string, corpus: readonly string[]): number[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0 || corpus.length === 0) return corpus.map(() => 0);

  const corpusTokens = corpus.map((entry) => new Set(tokenize(entry)));
  const documentCount = corpusTokens.length;
  const weights = new Map<string, number>();
  let totalWeight = 0;
  for (const token of queryTokens) {
    let documentFrequency = 0;
    for (const tokens of corpusTokens) {
      if (tokens.has(token)) documentFrequency++;
    }
    const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
    weights.set(token, idf);
    totalWeight += idf;
  }
  if (totalWeight === 0) return corpus.map(() => 0);

  return corpusTokens.map((contentTokens) => {
    let matchedWeight = 0;
    for (const token of queryTokens) {
      if (contentTokens.has(token)) matchedWeight += weights.get(token) ?? 0;
    }
    return matchedWeight / totalWeight;
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
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
  score: (card: TwinMemoryCard) => number,
  // Tie-break equal scores deterministically. Without this, RRF would order
  // ties by array position — so a heavily-reinforced card could lose a pure
  // keyword tie to whichever card happened to be written first. Breaking ties
  // by salience lets reinforcement actually decide when relevance is equal.
  tiebreak?: (a: TwinMemoryCard, b: TwinMemoryCard) => number
): Map<string, number> {
  const ranked = cards
    .map((card) => ({ card, score: score(card) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (tiebreak ? tiebreak(a.card, b.card) : 0));

  return new Map(ranked.map((item, index) => [item.card.id, index]));
}

/** Like `ranksByScore`, but carries lexical coverage into the RRF distance.
 *
 * Pure ordinal ranks made a card that matched one ubiquitous token nearly as
 * strong as one that covered the decisive query terms: the salience lane could
 * erase that one-place difference. Dividing each ordinal position by its
 * normalized keyword coverage preserves the existing RRF fusion while giving
 * weak lexical matches a proportionally larger distance.
 */
function keywordRanksByScore(
  cards: TwinMemoryCard[],
  score: (card: TwinMemoryCard) => number,
  tiebreak?: (a: TwinMemoryCard, b: TwinMemoryCard) => number
): Map<string, number> {
  const ranked = cards
    .map((card) => ({ card, score: score(card) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (tiebreak ? tiebreak(a.card, b.card) : 0));

  return new Map(
    ranked.map((item, index) => [item.card.id, (index + 1) / item.score - 1])
  );
}

/**
 * Salience = base importance × time-decay × reinforcement.
 *
 *   decay         halves every `halfLifeDays` since the card was last touched
 *                 (recall OR write), so a frequently-recalled card never decays.
 *   reinforcement grows logarithmically with recall count, so the 10th recall
 *                 matters less than the 1st — mirrors Memongo's importance decay.
 *
 * This single signal subsumes the old standalone recency rank (a fresh card has
 * lastTouch ≈ createdAt → decay ≈ 1).
 */
export function salience(card: TwinMemoryCard, access: AccessMap, nowMs: number): number {
  const base = card.importance ?? 1;
  const rec = access[card.id];
  const lastTouch = rec?.lastAccessedAt ?? card.createdAt;
  const lastTouchMs = new Date(lastTouch).getTime();
  const ageDays = Number.isFinite(lastTouchMs)
    ? Math.max(0, (nowMs - lastTouchMs) / DAY_MS)
    : 0;
  const decay = Math.pow(0.5, ageDays / halfLifeDays());
  const reinforcement = 1 + Math.log1p(rec?.count ?? 0) * REINFORCE_GAIN;
  return base * decay * reinforcement;
}

// ─── Agentic rerank ──────────────────────────────────────────────────────────
// The gate above can only measure lexical/semantic overlap, and on our own
// bench those two distributions do not separate: distractor cards score up to
// 0.33 keyword similarity while genuine paraphrase matches drop to 0.15. No
// single threshold splits them, because "how do we run a GDPR deletion" and
// "how do we import customer data" share vocabulary but not subject. Judging
// that needs reading, not scoring — so we optionally spend one cheap model call
// to read the shortlist and say which cards are actually about the question.
// Off by default: this call sits in the response path, ahead of the twin's
// first token, so it is a latency trade the operator opts into.
// Haiku for the same reason the Dreamer uses it: this is a cheap per-turn
// classification, and it sits in the latency path.
const RERANK_MODEL_DEFAULT = TWIN_MODEL_HAIKU;
const DEFAULT_RERANK_CANDIDATES = 12;

function agenticRerankEnabled(): boolean {
  return (
    process.env.TWIN_MEMORY_AGENTIC_RERANK === "1" && directAnthropicAllowed() && !!process.env.ANTHROPIC_API_KEY
  );
}

function rerankCandidates(): number {
  const raw = Number.parseInt(process.env.TWIN_MEMORY_RERANK_CANDIDATES ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 40);
  return DEFAULT_RERANK_CANDIDATES;
}

// `subject` comes FIRST on purpose. Structured outputs are generated in schema
// order, so naming the question's subject before choosing indices gives the
// model somewhere to commit to the topic before it starts matching. Without it
// the one-shot call almost never returns an empty list — it reaches for the
// closest card rather than concluding nothing fits.
const RERANK_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "The specific subject of the question, in under 10 words",
    },
    relevant: {
      type: "array",
      description: "1-based indices of the memories that are about that same subject",
      items: { type: "integer" },
    },
  },
  required: ["subject", "relevant"],
  additionalProperties: false,
} as const;

const RERANK_SYSTEM = [
  "You filter a shortlist of retrieved memories for a digital twin. You are given a QUESTION and a numbered list of MEMORIES that a keyword search returned.",
  "First state the question's subject in a few words. Then return the 1-based indices of ONLY the memories about that same subject.",
  "Work in ANY language — Hebrew and English are both first-class, and a memory in one language can be relevant to a question in the other.",
  "Shared vocabulary is NOT relevance. Two items about 'customer data' are unrelated if one is about GDPR deletion and the other about CSV import.",
  "Returning an empty list is the correct, expected answer when nothing on the shortlist is on-topic. Never pad the list to look useful — an irrelevant memory actively misleads the twin.",
  "Do not explain, rank, or rewrite anything. Indices only.",
].join("\n");

/** Filter a lexical shortlist down to what is actually on-topic.
 *  Returns null to mean "no judgement" (disabled, no key, or the call failed) —
 *  distinct from `[]`, which is a real verdict that nothing is relevant. */
async function agenticRerank(
  query: string,
  shortlist: TwinMemoryHit[]
): Promise<TwinMemoryHit[] | null> {
  if (!agenticRerankEnabled()) return null;
  if (shortlist.length === 0) return null;

  try {
    // The Agent SDK spawns a subprocess per call — ~14s, which is fine for the
    // Dreamer (it runs after the answer) but not here, ahead of the twin's
    // first token. This is a one-shot classification, so it goes straight to
    // the Messages API instead: same model, no subprocess.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: process.env.TWIN_MEMORY_RERANK_MODEL ?? RERANK_MODEL_DEFAULT,
      // The answer is a subject line plus a few integers, but this is a ceiling
      // rather than a spend — kept generous so TWIN_MEMORY_RERANK_MODEL can be
      // pointed at a model that thinks (whose thinking counts against it too).
      max_tokens: 1024,
      system: RERANK_SYSTEM,
      output_config: { format: { type: "json_schema", schema: RERANK_SCHEMA } },
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            question: truncate(query, 1000),
            memories: shortlist.map((hit, index) => ({
              n: index + 1,
              text: truncate(hit.card.content, 400),
            })),
          }),
        },
      ],
    });

    // A refusal or a token-capped response is "no judgement", not "nothing is
    // relevant" — fall back to the lexical ranking rather than silently
    // dropping every card.
    if (response.stop_reason !== "end_turn") return null;

    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) return null;
    const picked = (JSON.parse(text) as { relevant?: unknown }).relevant;
    if (!Array.isArray(picked)) return null;

    // Keep the lexical ordering; the model only decides membership. Indices are
    // 1-based and dedup'd, and anything out of range is dropped rather than
    // trusted — a hallucinated index must never resurface a filtered card.
    const keep = new Set(
      picked
        .filter((n): n is number => Number.isInteger(n))
        .map((n) => n - 1)
        .filter((i) => i >= 0 && i < shortlist.length)
    );
    return shortlist.filter((_, index) => keep.has(index));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn(`[twin-memory] agentic rerank failed: ${message}`);
    return null;
  }
}

export async function searchTwinMemory(
  employeeId: string,
  query: string,
  limit = searchLimit()
): Promise<TwinMemoryHit[]> {
  if (!isEnabled()) return [];

  const cards = readJsonl<TwinMemoryCard>(cardsPath(employeeId));
  if (cards.length === 0) return [];

  const access = readAccessMap(employeeId);
  const nowMs = Date.now();
  const weights = recallWeights();

  const queryEmbedding = await createEmbedding(query, employeeId);
  const cardCorpus = cards.map((card) => card.content);
  const keywordValues = scoreKeywords(query, cardCorpus);
  const keywordScores = new Map(
    cards.map((card, index) => [card.id, keywordValues[index] ?? 0])
  );
  const semanticScores = new Map(
    cards.map((card) => [
      card.id,
      queryEmbedding && card.embedding
        ? cosineSimilarity(queryEmbedding, card.embedding)
        : 0,
    ])
  );
  // Abstention: keep only cards with real lexical or semantic overlap. When
  // nothing qualifies we return [] and the caller injects no memory block at
  // all — silence is a better answer than five confidently-irrelevant cards.
  const candidates = relevanceGateEnabled()
    ? cards.filter(
        (card) =>
          (keywordScores.get(card.id) ?? 0) > minKeyword() ||
          (semanticScores.get(card.id) ?? 0) >= minSemantic()
      )
    : cards;
  if (candidates.length === 0) return [];

  const salienceScores = new Map(
    candidates.map((card) => [card.id, salience(card, access, nowMs)])
  );

  // Relevance lanes (keyword, semantic) break ties by salience, so among
  // equally-relevant cards the more reinforced one ranks higher. The salience
  // lane breaks its own ties by recency.
  const bySalience = (a: TwinMemoryCard, b: TwinMemoryCard) =>
    (salienceScores.get(b.id) ?? 0) - (salienceScores.get(a.id) ?? 0);
  const byRecency = (a: TwinMemoryCard, b: TwinMemoryCard) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  const keywordRanks = keywordRanksByScore(
    candidates,
    (card) => keywordScores.get(card.id) ?? 0,
    bySalience
  );
  const semanticRanks = ranksByScore(candidates, (card) => semanticScores.get(card.id) ?? 0, bySalience);
  const salienceRanks = ranksByScore(candidates, (card) => salienceScores.get(card.id) ?? 0, byRecency);

  const ranked = candidates
    .map((card) => {
      const score =
        rrf(keywordRanks.get(card.id), weights.keyword) +
        rrf(semanticRanks.get(card.id), weights.semantic) +
        rrf(salienceRanks.get(card.id), weights.salience);
      return {
        card,
        score,
        keywordScore: keywordScores.get(card.id) ?? 0,
        semanticScore: semanticScores.get(card.id) ?? 0,
        salienceScore: salienceScores.get(card.id) ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Optional second pass: have a cheap model read the shortlist and drop what
  // is only lexically similar. Returns null when disabled or on failure, in
  // which case the lexical ranking stands unchanged.
  const judged = await agenticRerank(query, ranked.slice(0, rerankCandidates()));
  const hits = (judged ?? ranked).slice(0, limit);
  if (hits.length === 0) return [];

  // Reinforce what we surfaced — recall is itself a signal of usefulness.
  reinforce(employeeId, hits.map((hit) => hit.card.id));

  return hits;
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

  // The episode log is the raw, immutable history — always append it.
  appendJsonl(episodesPath(input.employeeId), episode);

  // Promote durable typed facts (the "Dreamer") regardless of card dedup.
  // Extraction is async (an LLM call when a key is present). We await it here so
  // the fact is persisted before rememberTwinRun resolves — no lost facts. The
  // whole of rememberTwinRun is already `void`-ed by its caller (council-runner),
  // so this never blocks the twin's response. promoteStructuredMemory swallows
  // its own errors and never throws.
  await promoteStructuredMemory({
    employeeId: input.employeeId,
    runId: input.runId,
    createdAt,
    question,
    answer,
  });

  const content = cardContent(question, answer);
  const embedding = await createEmbedding(content, input.employeeId);

  // ─── Dedup-on-write — reinforce instead of duplicating ────────────────────
  // If a near-identical card already exists, bump its reinforcement rather than
  // appending a twin. Bounds growth and lets repeated topics rise in salience.
  if (embedding) {
    const recent = readJsonl<TwinMemoryCard>(cardsPath(input.employeeId)).slice(
      -DEDUP_SCAN_LIMIT
    );
    const threshold = dedupThreshold();
    let best: { id: string; sim: number } | null = null;
    for (const existing of recent) {
      if (!existing.embedding) continue;
      const sim = cosineSimilarity(embedding, existing.embedding);
      if (!best || sim > best.sim) best = { id: existing.id, sim };
    }
    if (best && best.sim >= threshold) {
      reinforce(input.employeeId, [best.id]);
      return;
    }
  }

  const card: TwinMemoryCard = {
    id: randomUUID(),
    employeeId: input.employeeId,
    runId: input.runId,
    surface: input.surface,
    content,
    question: truncate(question, 500),
    answerPreview: truncate(answer, 900),
    importance: 1,
    ...(embedding
      ? {
          embedding,
          embeddingModel:
            process.env.TWIN_MEMORY_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
        }
      : {}),
    createdAt,
  };

  appendJsonl(cardsPath(input.employeeId), card);
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured memory — the "Dreamer" (Memongo consolidation, Phase 2)
//
// A lightweight, LLM-free consolidator: rule-based regex patterns promote raw
// Q/A text into durable, typed facts (decisions, preferences, open todos, …).
// These are surfaced as a HIGHER-authority prompt block than episodic memory —
// they're the distilled, long-lived knowledge about the twin, not transient
// recall. Stored in data/memory/<id>/structured.jsonl.
// ─────────────────────────────────────────────────────────────────────────────

export type TwinStructuredType =
  | "decision"
  | "preference"
  | "fact"
  | "contact"
  | "todo"
  | "milestone"
  | "problem"
  | "emotional";

export type TwinStructuredFact = {
  id: string;
  employeeId: string;
  runId: string;
  type: TwinStructuredType;
  /** Short slug derived from the value — a stable handle for dedup. */
  key: string;
  value: string;
  confidence: number;
  source: "user" | "agent";
  createdAt: string;
};

// Confidence by who said it — the CEO's own words outrank the twin's inference.
// Ported from Memongo's CONFIDENCE_BY_SOURCE.
const STRUCTURED_CONFIDENCE: Record<TwinStructuredFact["source"], number> = {
  user: 0.8,
  agent: 0.6,
};

// Conservative rule patterns (false negatives OK, false positives NOT OK).
// Ported from Memongo's consolidator CATEGORY_PATTERNS (8 categories).
const STRUCTURED_PATTERNS: Array<{ type: TwinStructuredType; pattern: RegExp }> = [
  {
    type: "decision",
    pattern: /\b(?:I\s+(?:decided|chose|picked|selected|went with))\s+(.+)/i,
  },
  {
    type: "preference",
    pattern: /\b(?:I\s+(?:prefer|like|want|always use|love))\s+(.+)/i,
  },
  {
    type: "fact",
    pattern: /\b(?:The\s+\w+\s+(?:uses?|is|has|runs?|supports?|requires?))\s+(.+)/i,
  },
  {
    type: "contact",
    pattern: /\b(?:(?:contact|reach|email|call|ask)\s+\w+\s+(?:at|for|about))\s+(.+)/i,
  },
  {
    type: "todo",
    pattern: /\b(?:TODO|FIXME|need\s+to|have\s+to|must|should)\s*:?\s+(.+)/i,
  },
  {
    type: "milestone",
    pattern:
      /\b(?:(?:shipped|launched|released|completed|finished|deployed)\s+(.+))/i,
  },
  {
    type: "problem",
    pattern:
      /\b(?:(?:there\s+is\s+a\s+(?:bug|issue|problem|error)|(?:bug|issue|problem|error)\s+in))\s+(.+)/i,
  },
  {
    type: "emotional",
    pattern:
      /\b(?:I'm\s+(?:frustrated|happy|excited|worried|concerned|anxious|confused|delighted))\s*(.+)/i,
  },
];

// Guard clauses — the patterns were designed (in Memongo) to run inside a gated
// consolidation pipeline over curated event bodies. Applied raw to conversation
// turns, they over-fire on questions, hypotheticals, negations, and narration
// about other people. Since the contract is "false negatives OK, false positives
// NOT OK", we drop any segment that looks like one of those before matching.
const GUARD_INTERROGATIVE =
  /^(?:what|why|how|when|where|who|which|should|could|would|can|is|are|am|do|does|did|have|has|whether|wonder(?:ing)?)\b/i;
const GUARD_CONDITIONAL = /^(?:if|suppose|imagine|assuming|maybe|perhaps)\b/i;
const GUARD_NEGATION =
  /\b(?:not|never|no|none|cannot|can't|don't|doesn't|didn't|won't|wouldn't|haven't|hasn't|isn't|aren't|wasn't|weren't|shouldn't)\b/i;
// Narration about third parties / the past — not the speaker's own state.
const GUARD_NARRATION =
  /\b(?:the\s+author|the\s+article|the\s+docs?|the\s+readme|the\s+previous\s+team|another\s+team|last\s+(?:quarter|week|month|year))\b/i;

function isGuardedSegment(segment: string): boolean {
  return (
    GUARD_INTERROGATIVE.test(segment) ||
    GUARD_CONDITIONAL.test(segment) ||
    GUARD_NEGATION.test(segment) ||
    GUARD_NARRATION.test(segment)
  );
}

const MAX_FACTS_PER_TEXT = 4;
const STRUCTURED_VALUE_MIN = 4;
const STRUCTURED_VALUE_MAX = 200;
// Long agent answers are scanned only at the top to keep extraction tight.
const STRUCTURED_ANSWER_SCAN = 1500;

function structuredEnabled(): boolean {
  return process.env.TWIN_MEMORY_STRUCTURED_ENABLED !== "false";
}

function slugFromValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .slice(0, 60);
}

function extractFactsFrom(
  text: string,
  source: TwinStructuredFact["source"]
): Array<Pick<TwinStructuredFact, "type" | "key" | "value" | "confidence" | "source">> {
  const out: Array<
    Pick<TwinStructuredFact, "type" | "key" | "value" | "confidence" | "source">
  > = [];
  const seen = new Set<string>();
  // Split on sentence + clause boundaries (incl. ? and ! so interrogative and
  // exclamatory clauses isolate) so a pattern anchored on "I decided …" matches
  // per claim and a guarded clause doesn't poison its neighbours.
  const lines = text.split(/[\n.;?!]+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (out.length >= MAX_FACTS_PER_TEXT) break;
    if (isGuardedSegment(line)) continue;
    for (const { type, pattern } of STRUCTURED_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const value = truncate(match[1] ?? "", STRUCTURED_VALUE_MAX);
      if (value.length < STRUCTURED_VALUE_MIN) continue;
      const key = slugFromValue(value);
      const dedupKey = `${type}::${key}`;
      if (!key || seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push({ type, key, value, confidence: STRUCTURED_CONFIDENCE[source], source });
      break; // one fact per line — first matching category wins
    }
  }
  return out;
}

// ─── LLM Dreamer (multilingual) ───────────────────────────────────────────────
// The regex patterns above are English-only — Hebrew (our primary user base)
// extracts at 0%. When an Anthropic key is present we distill facts with Claude
// instead: it handles Hebrew + English natively and judges questions, negations
// and hypotheticals far better than the guard regexes. We deliberately reuse the
// ONE key the CLI already collects (Anthropic) — no OpenAI dependency. Falls back
// to the regex patterns when there's no key (offline / cost-capped). Mirrors the
// query() + json_schema pattern in employee-intent-planner.ts.
type RawFact = Pick<
  TwinStructuredFact,
  "type" | "key" | "value" | "confidence" | "source"
>;

const DREAMER_MODEL_DEFAULT = TWIN_MODEL_HAIKU; // cheap/fast; runs per turn
const DREAMER_FALLBACK_MODEL = TWIN_MODEL_FALLBACK;

const DREAMER_TYPES: ReadonlySet<string> = new Set<TwinStructuredType>([
  "decision",
  "preference",
  "fact",
  "contact",
  "todo",
  "milestone",
  "problem",
  "emotional",
]);

const DREAMER_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...DREAMER_TYPES] },
          value: {
            type: "string",
            description: "the fact in its ORIGINAL language, ≤ 200 chars",
          },
          source: { type: "string", enum: ["user", "agent"] },
        },
        required: ["type", "value", "source"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

const DREAMER_SYSTEM = [
  "You distill durable, long-lived facts from a single conversation turn between a CEO (user) and their digital twin (agent), for Employee001's structured memory.",
  "Work in ANY language — Hebrew and English are both first-class. Keep each fact's value in its ORIGINAL language, ≤ 200 chars.",
  "Extract ONLY durable knowledge worth remembering long-term, each classified as exactly one of: decision, preference, fact, contact, todo, milestone, problem, emotional.",
  "Set source to 'user' for things the CEO stated and 'agent' for things the twin asserted.",
  "Do NOT extract from questions, hypotheticals (if/suppose/maybe), negations (\"we did NOT decide\"), or narration about third parties. When unsure, omit it — false positives are worse than misses.",
  'Return {"facts": []} when the turn has no durable facts (small talk, acknowledgements, pure Q&A).',
].join(" ");

function dreamerLlmEnabled(): boolean {
  return (
    (currentProvider() !== "anthropic" || !!process.env.ANTHROPIC_API_KEY) &&
    process.env.TWIN_MEMORY_DREAMER_LLM !== "0"
  );
}

function sanitizeLlmFacts(value: unknown): RawFact[] {
  const facts = (value as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(facts)) return [];
  const out: RawFact[] = [];
  const seen = new Set<string>();
  for (const raw of facts) {
    if (out.length >= MAX_FACTS_PER_TEXT * 2) break;
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const type = String(o.type) as TwinStructuredType;
    if (!DREAMER_TYPES.has(type)) continue;
    const source =
      o.source === "user" ? "user" : o.source === "agent" ? "agent" : null;
    if (!source) continue;
    const val = truncate(
      typeof o.value === "string" ? o.value.trim() : "",
      STRUCTURED_VALUE_MAX
    );
    if (val.length < STRUCTURED_VALUE_MIN) continue;
    const key = slugFromValue(val);
    const dedupKey = `${type}::${key}`;
    if (!key || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({ type, key, value: val, confidence: STRUCTURED_CONFIDENCE[source], source });
  }
  return out;
}

/** LLM extraction over one Q/A pair. Returns null (not []) to signal the caller
 *  to fall back to the regex patterns — e.g. no API key or the call failed.
 *  An empty array means "the model ran and found no durable facts". */
async function extractFactsViaLLM(
  question: string,
  answer: string
): Promise<RawFact[] | null> {
  if (!dreamerLlmEnabled()) return null;
  try {
    // Dynamic import keeps the heavy Agent SDK off the recall hot path — it only
    // loads when extraction actually runs.
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const model = modelForProvider(process.env.TWIN_MEMORY_DREAMER_MODEL ?? DREAMER_MODEL_DEFAULT);
    const prompt = JSON.stringify({
      user: truncate(question, 2000),
      agent: truncate(answer.slice(0, STRUCTURED_ANSWER_SCAN), STRUCTURED_ANSWER_SCAN),
    });

    let structuredOutput: unknown = null;
    const stream = query({
      prompt,
      options: {
        model,
        fallbackModel: modelForProvider(DREAMER_FALLBACK_MODEL),
        systemPrompt: DREAMER_SYSTEM,
        allowedTools: [],
        // Structured-output extraction needs a couple of internal turns (the
        // model answers, then the SDK has it conform to the schema); 1–2 flaked
        // ~12% of the time → silent regex fallback. 4 gives reliable headroom
        // and stays cheap on Haiku.
        maxTurns: 4,
        outputFormat: { type: "json_schema", schema: DREAMER_SCHEMA },
        permissionMode: "bypassPermissions",
        settingSources: [],
        env: { ...process.env, ...providerEnvForAgentSdk() },
      },
    });

    for await (const message of stream) {
      if (message.type === "result") {
        if (
          (message as { subtype?: string }).subtype ===
          "error_max_structured_output_retries"
        ) {
          return null;
        }
        structuredOutput =
          (message as { structured_output?: unknown }).structured_output ?? null;
      }
    }

    if (structuredOutput == null) return null;
    return sanitizeLlmFacts(structuredOutput);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn(`[twin-memory] dreamer LLM extraction failed: ${message}`);
    return null;
  }
}

/** Run the Dreamer over one Q/A pair and append any new durable facts.
 *  LLM-first (multilingual) with a regex fallback when there's no API key.
 *  Best-effort — never throws into the run path. */
async function promoteStructuredMemory(input: {
  employeeId: string;
  runId: string;
  createdAt: string;
  question: string;
  answer: string;
}): Promise<void> {
  if (!structuredEnabled()) return;
  try {
    const llmFacts = await extractFactsViaLLM(input.question, input.answer);
    const candidates: RawFact[] =
      llmFacts !== null
        ? llmFacts
        : [
            ...extractFactsFrom(input.question, "user"),
            ...extractFactsFrom(
              input.answer.slice(0, STRUCTURED_ANSWER_SCAN),
              "agent"
            ),
          ];
    if (candidates.length === 0) return;

    const existing = readJsonl<TwinStructuredFact>(structuredPath(input.employeeId));
    const known = new Set(existing.map((fact) => `${fact.type}::${fact.key}`));

    for (const cand of candidates) {
      const dedupKey = `${cand.type}::${cand.key}`;
      if (known.has(dedupKey)) continue;
      known.add(dedupKey);
      const fact: TwinStructuredFact = {
        id: randomUUID(),
        employeeId: input.employeeId,
        runId: input.runId,
        createdAt: input.createdAt,
        ...cand,
      };
      appendJsonl(structuredPath(input.employeeId), fact);
    }
  } catch {
    /* consolidation is advisory; never break the run */
  }
}

/** Recall durable facts for a query: keyword-overlap first, then backfill with
 *  the most recent high-confidence facts so identity/preferences always surface. */
export function searchStructuredMemory(
  employeeId: string,
  query: string,
  limit = 6
): TwinStructuredFact[] {
  if (!isEnabled() || !structuredEnabled()) return [];
  const facts = readJsonl<TwinStructuredFact>(structuredPath(employeeId));
  if (facts.length === 0) return [];

  const factCorpus = facts.map((fact) => `${fact.key} ${fact.value}`);
  const scores = scoreKeywords(query, factCorpus);
  const scored = facts.map((fact, index) => ({
    fact,
    score: scores[index] ?? 0,
  }));

  const matched = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || cmpRecent(a.fact, b.fact))
    .map((item) => item.fact);

  if (matched.length >= limit) return matched.slice(0, limit);

  // Backfill with recent, confident facts not already matched.
  const picked = new Set(matched.map((fact) => fact.id));
  const backfill = [...facts]
    .filter((fact) => !picked.has(fact.id))
    .sort((a, b) => b.confidence - a.confidence || cmpRecent(a, b))
    .slice(0, limit - matched.length);

  return [...matched, ...backfill];
}

function cmpRecent(a: TwinStructuredFact, b: TwinStructuredFact): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export function formatStructuredMemoryBlock(facts: TwinStructuredFact[]): string {
  if (facts.length === 0) return "";

  const lines = facts
    .map((fact) => {
      const created = fact.createdAt.slice(0, 10);
      return `- [${fact.type}] ${fact.value} _(conf ${fact.confidence}, ${created})_`;
    })
    .join("\n");

  return `# Durable facts about this twin

Consolidated, typed facts distilled from past interactions (decisions,
preferences, open todos, known problems). Treat these as higher authority than
the episodic memory below — but still below the profile files if they conflict.

${lines}`;
}
