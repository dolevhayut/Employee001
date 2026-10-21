import { NextRequest } from "next/server";
import {
  STT_ERROR_STATUS,
  STT_FORM_OVERHEAD,
  STT_MAX_BYTES,
  declaredTooLarge,
  readCapped,
  sttFileName,
  sttModel,
  transcriptOf,
  validateSttUpload,
} from "@/lib/stt";

// POST /api/stt — one spoken question in, its transcript out.
// Body: multipart/form-data with `audio` (the recorded clip) and an optional
// `language` (ISO-639-1/3). The clip goes to ElevenLabs Speech to Text with the
// server's key; the key never reaches the browser.

export const runtime = "nodejs";

const UPSTREAM = "https://api.elevenlabs.io/v1/speech-to-text";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ELEVENLABS_API_KEY is not configured" }, { status: 500 });
  }

  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    return Response.json({ error: "expected multipart/form-data" }, { status: 415 });
  }
  if (declaredTooLarge(request.headers.get("content-length"))) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  // Enforce the cap while reading too: the declared length can be missing or wrong.
  const raw = await readCapped(request.body, STT_MAX_BYTES + STT_FORM_OVERHEAD);
  if (!raw) return Response.json({ error: "too_large" }, { status: 413 });

  let form: FormData;
  try {
    form = await new Response(raw, { headers: { "content-type": type } }).formData();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const audio = form.get("audio");
  const languageField = form.get("language");
  const language = typeof languageField === "string" ? languageField.trim().toLowerCase() : null;
  const file = audio instanceof Blob ? audio : null;
  const invalid = validateSttUpload(file ? { size: file.size, type: file.type, language } : null);
  if (invalid || !file) {
    const code = invalid ?? "missing";
    return Response.json({ error: code }, { status: STT_ERROR_STATUS[code] });
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, sttFileName(file.type));
  upstreamForm.append("model_id", sttModel());
  upstreamForm.append("tag_audio_events", "false");
  if (language) upstreamForm.append("language_code", language);

  let upstream: Response;
  try {
    // Give up after 30s, or as soon as the browser hangs up.
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: upstreamForm,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
  } catch (err) {
    console.error("[stt] ElevenLabs unreachable", err instanceof Error ? err.message : err);
    return Response.json({ error: "Speech to text is unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("[stt] ElevenLabs error", upstream.status, detail.slice(0, 500));
    return Response.json({ error: `Speech to text failed: ${upstream.status}` }, { status: 502 });
  }

  const text = transcriptOf(await upstream.json().catch(() => null));
  return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
}
