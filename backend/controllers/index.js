import fs from "node:fs";
import path from "node:path";
import { __version } from "../utils/version.js";
import { dbConnected } from "../config/db.js";
import { HttpError } from "../middleware/errors.js";
import { ActionLog, Conversation, MEMORY_CATEGORIES, Memory, Message, Task } from "../models/index.js";
import { PathNotAllowed } from "../services/pathGuard.js";
import { LLM_KEY, PROVIDER_PRESETS } from "../services/llm/factory.js";
import { SETTING_KEYS } from "../services/settingsService.js";
import { conversationJson, logJson, memoryJson, taskJson } from "../utils/serialize.js";
import { GNANI_KEY, GnaniError, gnaniSettings, gnaniSpeak, gnaniTranscribe } from "../voice/gnani.js";
import { TranscribeError, transcribe } from "../voice/transcribe.js";

const ALLOWED_SECRETS = new Set([LLM_KEY, GNANI_KEY]);
// Only the model key is locked when the model is configured in backend/.env.
const lockedSecret = (settings, name) => name === LLM_KEY && settings.managedKeys.includes("llm_model");
const MODES = new Set(["online", "offline", "hybrid"]);
const safeName = (n) => path.basename(n).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "upload";

export function controllers(c) {
  const { orchestrator: orch, settings, secrets, perms, approvals, guard, registry, config } = c;

  const gnani = () => gnaniSettings(process.env, secrets);
  // When the agent speaks its replies on its own: "voice" (only after the user dictated), "always" or "off".
  const speakPolicy = () => (/^(always|off)$/i.test(process.env.OMNIPILOT_SPEAK_REPLIES || "") ? process.env.OMNIPILOT_SPEAK_REPLIES.toLowerCase() : "voice");
  const voiceEngines = () => (gnani() ? { stt: "gnani", tts: "gnani" } : { stt: "provider", tts: "browser" });

  const settingsView = async () => ({
    ...(await settings.all()),
    allowed_roots: (await settings.get("allowed_roots")) || guard.roots,
    managed: settings.managedKeys,
    secrets: Object.fromEntries([...ALLOWED_SECRETS].map((n) => [n, secrets.isConfigured(n)])),
  });

  return {
    health: (req, res) => res.json({ status: "ok", version: __version, db: dbConnected() }),

    status: async (req, res) => {
      const s = await settings.all();
      const preset = PROVIDER_PRESETS[s.llm_provider] || {};
      const configured = !!(s.llm_provider && s.llm_model && (!preset.needsKey || secrets.isConfigured(LLM_KEY)));
      res.json({ version: __version, llm_configured: configured, provider: s.llm_provider ?? null, model: s.llm_model ?? null,
        model_managed: settings.managedKeys.includes("llm_model"), voice: voiceEngines(), speak_replies: speakPolicy(),  mode: s.operating_mode || "online", tool_count: registry.all().length, secret_backend: secrets.backend, db: dbConnected() });
    },
    providers: (req, res) => res.json(Object.fromEntries(Object.entries(PROVIDER_PRESETS).map(([k, v]) => [k, { base_url: v.baseUrl, needs_key: v.needsKey, cloud: v.cloud }]))),
    tools: (req, res) => res.json(registry.all().map((t) => ({ name: t.name, description: t.description, category: t.category, permissions: t.permissions, timeout: t.timeout, input_schema: t.inputSchema }))),

    getSettings: async (req, res) => res.json(await settingsView()),
    putSettings: async (req, res) => {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const bad = Object.keys(body).filter((k) => !SETTING_KEYS.has(k));
      if (bad.length) throw new HttpError(400, `Unknown settings: ${bad.sort().join(", ")}`);
      const locked = Object.keys(body).filter((k) => settings.managedKeys.includes(k));
      if (locked.length) throw new HttpError(409, `${locked.sort().join(", ")} is set in backend/.env and cannot be changed here.`);
      if ("operating_mode" in body && !MODES.has(body.operating_mode)) throw new HttpError(400, "operating_mode must be online, offline or hybrid");
      if ("llm_provider" in body && !PROVIDER_PRESETS[body.llm_provider] && body.llm_provider !== "") throw new HttpError(400, "Unknown llm_provider");
      if ("allowed_roots" in body) {
        const r = body.allowed_roots;
        if (!Array.isArray(r) || !r.length || !r.every((x) => typeof x === "string")) throw new HttpError(400, "allowed_roots must be a non-empty list of paths");
        guard.setRoots(r);
      }
      for (const [k, v] of Object.entries(body)) await settings.set(k, v);
      res.json(await settingsView());
    },

    putSecret: async (req, res) => {
      if (!ALLOWED_SECRETS.has(req.params.name)) throw new HttpError(404, "Unknown secret");
      if (lockedSecret(settings, req.params.name)) throw new HttpError(409, "The API key is set in backend/.env and cannot be changed here.");
      const v = req.body?.value;
      if (typeof v !== "string" || !v || v.length > 4096) throw new HttpError(422, "value must be a non-empty string");
      secrets.set(req.params.name, v);
      res.json({ name: req.params.name, configured: true }); // the value is never echoed back
    },
    deleteSecret: async (req, res) => {
      if (!ALLOWED_SECRETS.has(req.params.name)) throw new HttpError(404, "Unknown secret");
      if (lockedSecret(settings, req.params.name)) throw new HttpError(409, "The API key is set in backend/.env and cannot be changed here.");
      secrets.delete(req.params.name);
      res.json({ name: req.params.name, configured: false });
    },

    getPermissions: async (req, res) => res.json(await perms.grants()),
    putPermission: async (req, res) => {
      try { await perms.setGrant(req.params.permission, req.body?.mode); } catch (e) { throw new HttpError(400, e.message); }
      res.json(await perms.grants());
    },

    createTask: async (req, res) => {
      const m = req.body?.message;
      if (typeof m !== "string" || !m.trim() || m.length > 8000) throw new HttpError(422, "message must be 1-8000 characters");
      const { taskId, conversationId } = await orch.startTask(m, req.body.conversation_id);
      res.json({ task_id: taskId, conversation_id: conversationId });
    },
    listTasks: async (req, res) => res.json((await Task.find().select("-steps").sort({ createdAt: -1 }).limit(50).lean()).map((t) => taskJson(t))),
    getTask: async (req, res) => {
      const t = await Task.findById(req.params.id).lean();
      if (!t) throw new HttpError(404, "Task not found");
      res.json(taskJson(t, { steps: true }));
    },
    cancelTask: (req, res) => res.json({ cancelled: orch.cancel(req.params.id) }),
    pendingApprovals: (req, res) => res.json(approvals.pending()),
    answerApproval: (req, res) => {
      if (!approvals.resolve(req.params.id, !!req.body?.approved)) throw new HttpError(404, "No such pending approval");
      res.json({ ok: true });
    },
    emergencyStop: async (req, res) => res.json({ cancelled_tasks: await orch.emergencyStop() }),

    conversations: async (req, res) => res.json((await Conversation.find().sort({ createdAt: -1 }).limit(50).lean()).map(conversationJson)),
    conversationMessages: async (req, res) =>
      res.json((await Message.find({ conversationId: req.params.id }).sort({ createdAt: 1, _id: 1 }).lean()).map((m) => ({ role: m.role, content: m.content, created_at: new Date(m.createdAt).getTime() / 1000 }))),
    actionLog: async (req, res) => res.json((await ActionLog.find().sort({ _id: -1 }).limit(100).lean()).map(logJson)),

    listMemories: async (req, res) => {
      const q = req.query.category ? { category: String(req.query.category) } : {};
      res.json((await Memory.find(q).sort({ updatedAt: -1 }).lean()).map(memoryJson));
    },
    addMemory: async (req, res) => {
      const { category, content } = req.body || {};
      if (!MEMORY_CATEGORIES.includes(category)) throw new HttpError(400, `category must be one of ${[...MEMORY_CATEGORIES].sort().join(", ")}`);
      if (typeof content !== "string" || !content.trim() || content.length > 2000) throw new HttpError(422, "content must be 1-2000 characters");
      res.json({ id: String((await Memory.create({ category, content: content.trim(), source: "user" }))._id) });
    },
    patchMemory: async (req, res) => {
      const content = req.body?.content;
      if (typeof content !== "string" || !content.trim() || content.length > 2000) throw new HttpError(422, "content must be 1-2000 characters");
      if (!(await Memory.findByIdAndUpdate(req.params.id, { content: content.trim() }))) throw new HttpError(404, "Memory not found");
      res.json({ ok: true });
    },
    deleteMemory: async (req, res) => {
      if (!(await Memory.findByIdAndDelete(req.params.id))) throw new HttpError(404, "Memory not found");
      res.json({ ok: true });
    },

    // File upload (drag & drop) lands in the workspace uploads folder, which is always inside the allowed roots.
    upload: async (req, res) => {
      if (!req.file) throw new HttpError(422, "Send the file in a form field named 'file'.");
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      const target = guard.uniqueOutput(path.join(config.uploadsDir, safeName(req.file.originalname)), "");
      guard.resolve(target);
      fs.writeFileSync(target, req.file.buffer);
      res.json({ path: target, bytes: req.file.size });
    },
    download: async (req, res) => {
      let p;
      try { p = guard.resolve(String(req.query.path || "")); } catch (e) { if (e instanceof PathNotAllowed) throw new HttpError(403, e.message); throw e; }
      if (!fs.statSync(p, { throwIfNoEntry: false })?.isFile()) throw new HttpError(404, "File not found");
      res.download(p);
    },

    transcribe: async (req, res) => {
      if (!req.file) throw new HttpError(422, "Send the recording in a form field named 'audio'.");
      const input = { audio: req.file.buffer, mimeType: req.file.mimetype, language: req.body?.language };
      try {
        const cfg = gnani();
        res.json(cfg ? await gnaniTranscribe(input, cfg) : await transcribe(input, settings, secrets));
      } catch (e) {
        if (e instanceof TranscribeError || e instanceof GnaniError) throw new HttpError(e.status, e.message);
        throw e;
      }
    },

    speak: async (req, res) => {
      const cfg = gnani();
      if (!cfg) throw new HttpError(404, "No Gnani voice is configured; the app uses the browser's own voice.");
      const text = req.body?.text;
      if (typeof text !== "string" || !text.trim()) throw new HttpError(422, "text must be a non-empty string");
      try {
        const { audio, contentType } = await gnaniSpeak({ text }, cfg);
        res.set("Cache-Control", "no-store").type(contentType).send(audio);
      } catch (e) {
        if (e instanceof GnaniError) throw new HttpError(e.status, e.message);
        throw e;
      }
    },
  };
}
