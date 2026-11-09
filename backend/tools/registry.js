// Tool registry: every capability is a registered tool with schema, permissions, timeout and handler.
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: false, strict: false, coerceTypes: false });

export const ok = (data = {}, verification = "", verified = true) => ({ ok: true, data, error: null, recoverable: false, verified, verification });
export const unverified = (data, note) => ({ ok: true, data, error: null, recoverable: false, verified: false, verification: note });
export const fail = (error, { recoverable = false, data = {} } = {}) => ({ ok: false, data, error, recoverable, verified: false, verification: "" });

export class ToolRegistry {
  #tools = new Map();

  register(tool) {
    for (const k of ["name", "description", "inputSchema", "permissions", "handler"]) if (!tool[k]) throw new Error(`Tool is missing '${k}': ${tool.name ?? "?"}`);
    if (this.#tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    const validate = ajv.compile(tool.inputSchema); // throws on an invalid schema
    this.#tools.set(tool.name, { timeout: 60, category: "general", outputSchema: { type: "object" }, ...tool, validate });
  }
  get(name) { return this.#tools.get(name); }
  all() { return [...this.#tools.values()].sort((a, b) => a.name.localeCompare(b.name)); }

  validateArgs(tool, args) {
    if (tool.validate(args)) return null;
    const e = tool.validate.errors[0];
    return `Invalid arguments for ${tool.name}: ${e.instancePath || "arguments"} ${e.message}`;
  }
  describeCall(tool, args) {
    try { if (tool.summarize) return tool.summarize(args); } catch { /* fall through */ }
    return `${tool.name}(${Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`;
  }

  /** Runs a handler with its timeout. Never throws except for user cancellation (AbortError). */
  async run(tool, args, ctx) {
    const timeoutSignal = AbortSignal.timeout(tool.timeout * 1000);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeoutSignal]) : timeoutSignal;
    const abortP = new Promise((_, reject) => {
      const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    });
    abortP.catch(() => {});
    try {
      return await Promise.race([Promise.resolve(tool.handler(args, { ...ctx, signal })), abortP]);
    } catch (e) {
      if (ctx.signal?.aborted) throw e; // the user cancelled the task
      if (timeoutSignal.aborted) return fail(`${tool.name} timed out after ${tool.timeout}s`, { recoverable: true });
      return fail(`${tool.name} failed: ${e.name}: ${e.message}`);
    }
  }
}
