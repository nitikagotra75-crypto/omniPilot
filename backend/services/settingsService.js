import { Setting } from "../models/index.js";

export const SETTING_KEYS = new Set([
  "llm_provider", "llm_model", "llm_base_url", "operating_mode", "allowed_roots", "language",
  "stt_model", "tts_voice", "vision", "push_to_talk_key", "wake_word_enabled", "start_minimized", "launch_at_login", "theme",
]);

export class SettingsService {
  /** @param overrides settings fixed from the environment (.env); they win over stored values and cannot be changed in the app. */
  constructor(overrides = {}) { this.overrides = overrides; }
  get managedKeys() { return Object.keys(this.overrides); }
  async all() { return { ...Object.fromEntries((await Setting.find().lean()).map((s) => [s.key, s.value])), ...this.overrides }; }
  async get(key, fallback = undefined) {
    if (key in this.overrides) return this.overrides[key];
    return (await Setting.findOne({ key }).lean())?.value ?? fallback;
  }
  async set(key, value) { await Setting.updateOne({ key }, { $set: { value } }, { upsert: true }); }
}
