import { LLMNotConfigured } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openaiCompat.js";

export const PROVIDER_PRESETS = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", needsKey: true, cloud: true },
  openai: { baseUrl: "https://api.openai.com/v1", needsKey: true, cloud: true },
  anthropic: { baseUrl: "https://api.anthropic.com", needsKey: true, cloud: true },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", needsKey: true, cloud: true },
  ollama: { baseUrl: "http://localhost:11434/v1", needsKey: false, cloud: false },
  lmstudio: { baseUrl: "http://localhost:1234/v1", needsKey: false, cloud: false },
  custom: { baseUrl: "", needsKey: false, cloud: true },
};
export const LLM_KEY = "llm_api_key";

export function buildProvider(settings, secrets) {
  const { llm_provider: provider, llm_model: model } = settings;
  if (!provider || !PROVIDER_PRESETS[provider]) throw new LLMNotConfigured("No AI model is configured yet. Open Settings and choose a provider and model.");
  if (!model) throw new LLMNotConfigured("No model name is set. Open Settings and enter a model name.");
  const preset = PROVIDER_PRESETS[provider];
  const baseUrl = settings.llm_base_url || preset.baseUrl;
  const apiKey = secrets.get(LLM_KEY);
  if (preset.needsKey && !apiKey) throw new LLMNotConfigured(`The ${provider} provider needs an API key. Add it in Settings.`);
  if ((settings.operating_mode || "online") === "offline" && preset.cloud)
    throw new LLMNotConfigured("Offline mode is on, but the selected provider is a cloud service. Pick a local provider (Ollama / LM Studio) or switch the mode to Online.");
  if (provider === "anthropic") return new AnthropicProvider({ baseUrl, model, apiKey });
  if (!baseUrl) throw new LLMNotConfigured("A base URL is required for the custom provider.");
  return new OpenAICompatProvider({ baseUrl, model, apiKey });
}
