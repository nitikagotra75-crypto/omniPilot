// Runtime configuration. Secrets never live here; only locations and switches.
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelOverrides } from "./env.js";

export function loadConfig(env = process.env) {
  const dataDir = env.OMNIPILOT_DATA_DIR || path.join(os.homedir(), ".omnipilot");
  const workspaceDir = path.join(dataDir, "workspace");
  // Browser (no-Electron) mode: the engine serves the built UI itself and creates its own session token and master key.
  const web = env.OMNIPILOT_WEB === "1";
  if (web) { env = { ...env }; env.OMNIPILOT_TOKEN ||= crypto.randomBytes(24).toString("hex"); env.OMNIPILOT_MASTER_KEY ||= persistentKey(dataDir); }
  return {
    webRoot: web ? (env.OMNIPILOT_WEB_ROOT || findWebRoot()) : null,
    port: Number(env.PORT || (web ? 3939 : 0)),
    apiToken: env.OMNIPILOT_TOKEN || "",
    modelOverrides: modelOverrides(env),
    mongoUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017/omnipilot",
    dataDir,
    workspaceDir,
    outputsDir: path.join(workspaceDir, "outputs"),
    uploadsDir: path.join(workspaceDir, "uploads"),
    trashDir: path.join(dataDir, "trash"),
    browserProfilesDir: path.join(dataDir, "browser_profiles"),
    secretsFile: path.join(dataDir, "secrets.enc.json"),
    masterKey: env.OMNIPILOT_MASTER_KEY || "",
    maxAgentSteps: Number(env.OMNIPILOT_MAX_STEPS || 12),
    browserHeadless: env.OMNIPILOT_BROWSER_HEADED !== "1",
    allowLocalBrowse: env.OMNIPILOT_ALLOW_LOCAL_BROWSE === "1",
    parentPid: env.OMNIPILOT_PARENT_PID ? Number(env.OMNIPILOT_PARENT_PID) : null,
  };
}

/** The prebuilt UI: <project>/frontend/dist next to backend/ (also accepts a renamed frontend1 folder). */
function findWebRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = ["frontend", "frontend1"].map((n) => path.resolve(here, "..", "..", n, "dist"));
  return candidates.find((c) => fs.existsSync(path.join(c, "index.html"))) || candidates[0];
}

/** Master key for the encrypted API-key store, kept in the user's data folder (weaker than the OS keychain used by Electron). */
function persistentKey(dataDir) {
  const file = path.join(dataDir, "master.key");
  try { return fs.readFileSync(file, "utf8").trim(); } catch { /* first run */ }
  const key = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}
