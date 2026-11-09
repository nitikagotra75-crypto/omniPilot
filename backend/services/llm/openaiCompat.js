// OpenAI-compatible chat API (OpenAI, Ollama /v1, LM Studio, OpenRouter, vLLM...).
import { LLMError, postJson } from "./base.js";

export class OpenAICompatProvider {
  name = "openai-compatible";
  constructor({ baseUrl, model, apiKey }) { this.baseUrl = baseUrl.replace(/\/+$/, ""); this.model = model; this.apiKey = apiKey; }

  static toWire(messages) {
    return messages.map((m) => {
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      if (m.role === "assistant" && m.toolCalls?.length)
        return {
          role: "assistant", content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })),
        };
      if (m.images?.length) return { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] };
      return { role: m.role, content: m.content };
    });
  }

  async complete(messages, tools = [], { signal, temperature = 0.2 } = {}) {
    const body = { model: this.model, messages: OpenAICompatProvider.toWire(messages), temperature };
    if (tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const headers = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    const data = await postJson(`${this.baseUrl}/chat/completions`, body, headers, { signal });
    const choice = data?.choices?.[0];
    if (!choice?.message) throw new LLMError(`Unexpected model response format: ${JSON.stringify(data).slice(0, 300)}`);
    const toolCalls = (choice.message.tool_calls || []).map((tc) => {
      let args;
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = { __invalid_json__: tc.function.arguments }; }
      return { id: tc.id || crypto.randomUUID(), name: tc.function.name, arguments: args };
    });
    return { text: choice.message.content || "", toolCalls, stopReason: choice.finish_reason || "stop" };
  }
}
