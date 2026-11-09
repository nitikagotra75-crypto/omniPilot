// Secret storage. AES-256-GCM encrypted file keyed by a master key that the Electron shell keeps in the
// OS credential store (safeStorage). With no master key, secrets live in process memory only.
// Secrets are write-only through the API: callers can learn whether one is configured, never its value.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class SecretStore {
  #mem = new Map();
  constructor({ file, masterKey, env = process.env } = {}) {
    this.file = file;
    this.env = env;
    this.key = masterKey ? crypto.createHash("sha256").update(masterKey).digest() : null;
  }
  get backend() { return this.key && this.file ? "encrypted-file" : "process-memory"; }
  static envName(name) { return "OMNIPILOT_SECRET_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_"); }
  /** Friendlier names accepted in .env besides OMNIPILOT_SECRET_<NAME>. */
  static ENV_ALIASES = { llm_api_key: ["OMNIPILOT_LLM_API_KEY"], gnani_api_key: ["OMNIPILOT_GNANI_API_KEY"] };
  #fromEnv(name) {
    for (const key of [SecretStore.envName(name), ...(SecretStore.ENV_ALIASES[name] ?? [])]) if (this.env[key]) return this.env[key];
    return null;
  }

  #load() {
    if (!this.key || !this.file || !fs.existsSync(this.file)) return {};
    try {
      const { iv, tag, data } = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const d = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
      d.setAuthTag(Buffer.from(tag, "base64"));
      return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8"));
    } catch { return {}; } // wrong key or corrupt file: treat as empty rather than crash
  }
  #save(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
  }

  set(name, value) {
    if (this.backend === "encrypted-file") this.#save({ ...this.#load(), [name]: value });
    else this.#mem.set(name, value);
  }
  get(name) {
    if (this.backend === "encrypted-file") { const v = this.#load()[name]; if (v) return v; }
    return this.#mem.get(name) || this.#fromEnv(name);
  }
  isConfigured(name) { return !!this.get(name); }
  delete(name) {
    this.#mem.delete(name);
    if (this.backend === "encrypted-file") { const o = this.#load(); delete o[name]; this.#save(o); }
  }
}
