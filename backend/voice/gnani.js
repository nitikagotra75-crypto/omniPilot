// Gnani (api.vachana.ai): Prisma speech-to-text and Timbre text-to-speech.
// Docs: https://docs.gnani.ai/api/introduction/quick-start  (auth header X-API-Key-ID).
export const GNANI_KEY = "gnani_api_key";
const DEVANAGARI = /[ऀ-ॿ]/g;
const STT_TIMEOUT_MS = 60_000;
const TTS_TIMEOUT_MS = 60_000;
export const MAX_TTS_CHARS = 1500;

// Voice names come from Gnani's voice catalog. Voices only work with their own model (v2.5 voices differ from v3.0 voices).
const VOICES = {
  "timbre-v2.5": { hi: "Nalini", en: "Kaveri" },
  "timbre-v3.0": { hi: "Shivani", en: "Shivani" },
};

export class GnaniError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "GnaniError";
    this.status = status;
  }
}

/** Settings for the Gnani voice services, or null when no API key is configured. */
export function gnaniSettings(env, secrets) {
  const apiKey = secrets.get(GNANI_KEY);
  if (!apiKey) return null;
  const ttsModel = env.OMNIPILOT_GNANI_TTS_MODEL || "timbre-v2.5";
  const defaults = VOICES[ttsModel] ?? VOICES["timbre-v2.5"];
  return {
    apiKey,
    baseUrl: (env.OMNIPILOT_GNANI_BASE_URL || "https://api.vachana.ai").replace(/\/+$/, ""),
    sttModel: env.OMNIPILOT_GNANI_STT_MODEL || "prisma-v3.0",
    ttsModel,
    voices: { hi: env.OMNIPILOT_GNANI_VOICE_HI || defaults.hi, en: env.OMNIPILOT_GNANI_VOICE_EN || defaults.en },
  };
}

/** Human-readable reason from Gnani's several error shapes. */
function reason(status, body) {
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* not JSON */ }
  const message = parsed?.error?.message || parsed?.detail?.message || parsed?.message || (typeof parsed?.detail === "string" ? parsed.detail : "") || body.slice(0, 200);
  if (status === 401 || status === 403) return `Gnani rejected the API key or the account has no credit (${message || status}).`;
  if (status === 429) return "Gnani says too many requests right now. Try again in a moment.";
  return `Gnani answered ${status}: ${message}`;
}

async function call(url, init, timeoutMs, signal) {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...init, signal: sig });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new GnaniError(`Could not reach Gnani: ${e.cause?.code || e.message}`);
  }
}

/** The app's language setting ("auto", "hi-IN", "en-US"...) as a Prisma language_code. */
export function sttLanguage(language, model) {
  if (!language || language === "auto") return model === "prisma-v3.0" ? "indic-auto" : "en-IN";
  return language.startsWith("en") ? "en-IN" : language;
}

export async function gnaniTranscribe({ audio, mimeType, language }, cfg, { signal } = {}) {
  const form = new FormData();
  const ext = (mimeType || "").includes("wav") ? "wav" : (mimeType || "").split("/")[1]?.split(";")[0] || "wav";
  form.append("audio_file", new Blob([audio], { type: mimeType || "audio/wav" }), `speech.${ext}`);
  form.append("model", cfg.sttModel);
  form.append("language_code", sttLanguage(language, cfg.sttModel));
  form.append("format", "transcribe");
  const res = await call(`${cfg.baseUrl}/stt/v3`, { method: "POST", headers: { "X-API-Key-ID": cfg.apiKey }, body: form }, STT_TIMEOUT_MS, signal);
  const body = await res.text();
  if (!res.ok) throw new GnaniError(reason(res.status, body), res.status === 429 ? 429 : 502);
  let data;
  try { data = JSON.parse(body); } catch { throw new GnaniError("Gnani returned something that is not JSON."); }
  if (typeof data.transcript !== "string") throw new GnaniError("Gnani returned an unexpected speech-to-text response.");
  return { text: data.transcript.trim(), language: data.detected_language_code ?? null };
}

/** Hindi when the text is mostly Devanagari, otherwise Indian English. */
export function ttsLanguage(text) {
  const letters = text.replace(/[\s\d\p{P}]/gu, "").length || 1;
  return (text.match(DEVANAGARI)?.length ?? 0) / letters > 0.3 ? "hi-IN" : "en-IN";
}

export async function gnaniSpeak({ text }, cfg, { signal } = {}) {
  const clean = text.trim().slice(0, MAX_TTS_CHARS);
  if (!clean) throw new GnaniError("There is no text to speak.", 422);
  const language = ttsLanguage(clean);
  const body = { text: clean, model: cfg.ttsModel, voice: cfg.voices[language === "hi-IN" ? "hi" : "en"], language, speed: 1.0, audio_config: { container: "mp3", bitrate: "64k", sample_rate: 24000 } };
  const res = await call(`${cfg.baseUrl}/api/v1/tts/inference`, { method: "POST", headers: { "X-API-Key-ID": cfg.apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) }, TTS_TIMEOUT_MS, signal);
  if (!res.ok) throw new GnaniError(reason(res.status, await res.text()), res.status === 429 ? 429 : 502);
  return { audio: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || "audio/mpeg" };
}
