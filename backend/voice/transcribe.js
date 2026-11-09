// Speech-to-text through an OpenAI-compatible /audio/transcriptions endpoint (Whisper and compatibles).
// Text-to-speech runs in the renderer with the platform's speech synthesis voices.
import { PROVIDER_PRESETS, LLM_KEY } from "../services/llm/factory.js";

export class TranscribeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function transcribe({ audio, mimeType, filename = "speech.webm", language }, settings, secrets, { signal } = {}) {
  const s = await settings.all();
  const provider = s.llm_provider;
  if (!provider || !PROVIDER_PRESETS[provider]) throw new TranscribeError("Voice input needs a model provider. Open Settings and choose one first.");
  if (provider === "anthropic") throw new TranscribeError("Voice input needs an OpenAI-compatible provider with a transcription endpoint (for example OpenAI Whisper). The Anthropic API has no speech-to-text.");
  const preset = PROVIDER_PRESETS[provider];
  const base = (s.llm_base_url || preset.baseUrl).replace(/\/+$/, "");
  const key = secrets.get(LLM_KEY);
  if (preset.needsKey && !key) throw new TranscribeError(`The ${provider} provider needs an API key. Add it in Settings.`);
  if ((s.operating_mode || "online") === "offline" && preset.cloud) throw new TranscribeError("Offline mode is on and the selected provider is a cloud service.");

  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimeType || "audio/webm" }), filename);
  form.append("model", s.stt_model || "whisper-1");
  if (language) form.append("language", language.split("-")[0]); // OpenAI wants "hi", not "hi-IN"
  let res;
  try {
    res = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
  } catch (e) { throw new TranscribeError(`Could not reach the transcription endpoint: ${e.cause?.code || e.message}`, 502); }
  const body = await res.text();
  if (!res.ok) throw new TranscribeError(`The transcription service answered ${res.status}: ${body.slice(0, 200)}`, 502);
  let text;
  try { text = JSON.parse(body).text; } catch { text = body; }
  if (typeof text !== "string") throw new TranscribeError("The transcription service returned an unexpected response.", 502);
  return { text: text.trim() };
}
