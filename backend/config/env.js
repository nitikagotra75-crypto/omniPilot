// Reads backend/.env (if present) into process.env without overriding variables that are already set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");

export function loadDotEnv(file = ENV_FILE) {
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

/** Model settings fixed by the person who installed OmniPilot (OMNIPILOT_LLM_* variables). Empty values are ignored. */
export function modelOverrides(env = process.env) {
  const pairs = { llm_provider: env.OMNIPILOT_LLM_PROVIDER, llm_model: env.OMNIPILOT_LLM_MODEL, llm_base_url: env.OMNIPILOT_LLM_BASE_URL };
  return Object.fromEntries(Object.entries(pairs).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v.trim()]));
}
