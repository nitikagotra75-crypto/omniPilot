export class LLMError extends Error {
  constructor(message, { recoverable = false } = {}) { super(message); this.name = "LLMError"; this.recoverable = recoverable; }
}
export class LLMNotConfigured extends LLMError {
  constructor(message) { super(message); this.name = "LLMNotConfigured"; }
}

/** POST JSON and map transport/HTTP failures onto LLMError (recoverable for transient ones). */
export async function postJson(url, body, headers, { timeoutMs = 120000, signal } = {}) {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: sig });
  } catch (e) {
    if (signal?.aborted) throw e; // user cancellation, not an LLM failure
    if (e.name === "TimeoutError") throw new LLMError(`Model request timed out after ${timeoutMs / 1000}s`, { recoverable: true });
    throw new LLMError(`Could not reach the model endpoint ${new URL(url).origin}: ${e.cause?.code || e.message}`, { recoverable: true });
  }
  const text = await res.text();
  if ([429, 500, 502, 503, 504, 529].includes(res.status)) throw new LLMError(`Model service error ${res.status}: ${text.slice(0, 300)}`, { recoverable: true });
  if (res.status >= 400) throw new LLMError(`Model request failed (${res.status}): ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new LLMError(`The model endpoint returned something that is not JSON: ${text.slice(0, 200)}`); }
}
