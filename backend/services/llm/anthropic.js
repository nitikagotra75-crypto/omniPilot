// Anthropic Messages API.
import { LLMError, postJson } from "./base.js";

export class AnthropicProvider {
  name = "anthropic";
  constructor({ baseUrl = "https://api.anthropic.com", model, apiKey, maxTokens = 4096 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, ""); this.model = model; this.apiKey = apiKey; this.maxTokens = maxTokens;
  }

  static toWire(messages) {
    const system = [];
    const out = [];
    for (const m of messages) {
      if (m.role === "system") system.push(m.content);
      else if (m.role === "tool") {
        const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
        const last = out[out.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
        else out.push({ role: "user", content: [block] });
      } else if (m.role === "assistant") {
        const blocks = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls || []) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
      } else if (m.images?.length) {
        out.push({ role: "user", content: [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.base64 } }))] });
      } else out.push({ role: "user", content: m.content });
    }
    return { system: system.join("\n\n"), messages: out };
  }

  async complete(messages, tools = [], { signal, temperature = 0.2 } = {}) {
    const { system, messages: wire } = AnthropicProvider.toWire(messages);
    const body = { model: this.model, max_tokens: this.maxTokens, messages: wire, temperature };
    if (system) body.system = system;
    if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const data = await postJson(`${this.baseUrl}/v1/messages`, body, { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, { signal });
    if (!Array.isArray(data?.content)) throw new LLMError(`Unexpected Anthropic response: ${JSON.stringify(data).slice(0, 300)}`);
    const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const toolCalls = data.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, arguments: b.input || {} }));
    return { text, toolCalls, stopReason: data.stop_reason || "stop" };
  }
}
