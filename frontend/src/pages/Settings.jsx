import { useCallback, useEffect, useState } from "react";
import { useStore } from "../context/useStore";
import { del, get, patch, post, put } from "../services/api";

const ALWAYS_CONFIRM = new Set(["fs.delete", "publish", "finance"]);
const CATEGORIES = ["preference", "project", "instruction", "workflow", "context"];
const MODES = {
  online: "Uses the configured AI model. Local tools (files, PDF, system info, apps) always run on this computer.",
  offline: "Only local models are allowed. Cloud models are blocked.",
  hybrid: "Uses local processing where possible. Automatic routing between local and cloud models is not built yet.",
};

function Section({ title, hint, children }) {
  return (
    <section className="card p-5">
      <h2 className="font-display text-lg">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

const MODEL_HINTS = {
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  openrouter: [],
  ollama: [],
  lmstudio: [],
  custom: [],
};

function ModelForm({ settings, configured, onSaved, onError }) {
  const [provider, setProvider] = useState(settings.llm_provider || "groq");
  const [model, setModel] = useState(settings.llm_model || MODEL_HINTS.groq[0]);
  const [baseUrl, setBaseUrl] = useState(settings.llm_base_url || "");
  const [key, setKey] = useState("");
  const hasKey = !!settings.secrets?.llm_api_key;
  const local = provider === "ollama" || provider === "lmstudio";

  const submit = async () => {
    try {
      if (key.trim()) await put("/secrets/llm_api_key", { value: key.trim() });
      await put("/settings", {
        llm_provider: provider,
        llm_model: model.trim(),
        llm_base_url: provider === "custom" ? baseUrl.trim() : "",
      });
      setKey("");
      await onSaved("Saved. You can start chatting.");
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Provider</label>
          <select
            className="field"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel(MODEL_HINTS[e.target.value]?.[0] ?? "");
            }}
          >
            {Object.keys(MODEL_HINTS).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Model</label>
          <input className="field" list="model-hints" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="model-hints">
            {(MODEL_HINTS[provider] ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>
      {provider === "custom" && (
        <div>
          <label className="label">Base URL</label>
          <input className="field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
        </div>
      )}
      {!local && (
        <div>
          <label className="label">API key {hasKey && <span className="text-ink-faint">(saved — leave empty to keep it)</span>}</label>
          <input
            className="field"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? "••••••••" : "Paste your key"}
          />
        </div>
      )}
      <button className="btn-primary" disabled={!model.trim() || (!local && !hasKey && !key.trim())} onClick={() => void submit()}>
        {configured ? "Update" : "Save and connect"}
      </button>
    </div>
  );
}

function GnaniKey({ configured, onSaved, onError }) {
  const [key, setKey] = useState("");
  const run = async (fn, text) => {
    try {
      await fn();
      setKey("");
      await onSaved(text);
    } catch (e) {
      onError(e.message);
    }
  };
  return (
    <div>
      <label className="label">Gnani API key (optional) {configured && <span className="text-ink-faint">— saved</span>}</label>
      <div className="flex gap-2">
        <input
          className="field"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={configured ? "••••••••" : "Paste your Gnani key"}
        />
        <button
          className="btn-primary"
          disabled={!key.trim()}
          onClick={() => void run(() => put("/secrets/gnani_api_key", { value: key.trim() }), "Gnani voice is on.")}
        >
          Save
        </button>
        {configured && (
          <button className="btn-ghost" onClick={() => void run(() => del("/secrets/gnani_api_key"), "Gnani key removed.")}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const refreshStatus = useStore((s) => s.refreshStatus);
  const status = useStore((s) => s.status);
  const setLanguage = useStore((s) => s.setLanguage);
  const [settings, setSettings] = useState(null);
  const [perms, setPerms] = useState({});
  const [memories, setMemories] = useState([]);
  const [roots, setRoots] = useState([]);
  const [newMemory, setNewMemory] = useState({ category: "preference", content: "" });
  const [message, setMessage] = useState(null);

  const flash = (ok, text) => {
    setMessage({ ok, text });
    window.setTimeout(() => setMessage(null), 4000);
  };

  const load = useCallback(async () => {
    const [s, p, m] = await Promise.all([get("/settings"), get("/permissions"), get("/memories")]);
    setSettings(s);
    setPerms(p);
    setMemories(m);
    setRoots(s.allowed_roots);
  }, []);

  useEffect(() => {
    load().catch((e) => flash(false, e.message));
  }, [load]);

  if (!settings) return <p className="p-10 text-ink-faint">Loading…</p>;

  const save = async (body, okText = "Saved.") => {
    try {
      setSettings(await put("/settings", body));
      await refreshStatus();
      flash(true, okText);
    } catch (e) {
      flash(false, e.message);
    }
  };

  const mode = settings.operating_mode ?? "online";

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-3xl space-y-5 pb-16">
        <div className="flex items-end justify-between">
          <h1 className="font-display text-3xl">Settings</h1>
          {message && <p className={`chip ${message.ok ? "bg-mint-500/30" : "border-rose-400 text-rose-400"}`}>{message.text}</p>}
        </div>

        <Section
          title="AI model"
          hint={
            status?.model_managed ? "Set in backend/.env by whoever installed OmniPilot." : "Choose a provider, paste its API key and save."
          }
        >
          {status?.model_managed ? (
            <p className="text-sm">
              <span className="font-semibold">{status.provider}</span> · {status.model}
            </p>
          ) : (
            <ModelForm
              settings={settings}
              configured={!!status?.llm_configured}
              onSaved={async (t) => {
                setSettings(await get("/settings"));
                await refreshStatus();
                flash(true, t);
              }}
              onError={(t) => flash(false, t)}
            />
          )}
        </Section>

        <Section
          title="Voice"
          hint="With a Gnani key, Prisma listens and Timbre speaks. Without it, the AI provider transcribes and this computer's voices speak."
        >
          <GnaniKey
            configured={!!settings.secrets?.gnani_api_key}
            onSaved={async (t) => {
              setSettings(await get("/settings"));
              await refreshStatus();
              flash(true, t);
            }}
            onError={(t) => flash(false, t)}
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Language</label>
              <select
                className="field"
                value={settings.language ?? "auto"}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  void save({ language: e.target.value });
                }}
              >
                <option value="auto">Automatic</option>
                <option value="en-IN">English (India)</option>
                <option value="en-US">English (US)</option>
                <option value="hi-IN">Hindi (हिन्दी)</option>
              </select>
            </div>
            <div>
              <label className="label">Transcription model</label>
              <input
                className="field"
                defaultValue={settings.stt_model ?? ""}
                placeholder="whisper-1"
                onBlur={(e) => e.target.value !== (settings.stt_model ?? "") && void save({ stt_model: e.target.value.trim() })}
              />
            </div>
          </div>
        </Section>

        <Section title="Operating mode">
          <div className="grid grid-cols-3 gap-2">
            {Object.keys(MODES).map((m) => (
              <button
                key={m}
                onClick={() => void save({ operating_mode: m })}
                className={`rounded-xl border-2 px-4 py-2.5 text-left text-sm font-semibold capitalize transition ${mode === m ? "border-ink bg-lemon/50" : "border-ink/20 text-ink-soft hover:border-ink/50"}`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-sm text-ink-soft">{MODES[mode]}</p>
        </Section>

        <Section title="Permissions" hint="“Ask” prompts you each time. Deleting, publishing and financial actions always ask.">
          <div className="divide-y divide-ink/10 rounded-xl border-2 border-ink/15">
            {Object.entries(perms)
              .sort()
              .map(([name, value]) => (
                <div key={name} className="flex items-center justify-between px-4 py-2">
                  <code className="text-sm">{name}</code>
                  <select
                    className="field !w-28 !py-1"
                    value={value}
                    onChange={async (e) => {
                      try {
                        setPerms(await put(`/permissions/${name}`, { mode: e.target.value }));
                      } catch (err) {
                        flash(false, err.message);
                      }
                    }}
                  >
                    {!ALWAYS_CONFIRM.has(name) && <option value="allow">Allow</option>}
                    <option value="ask">Ask</option>
                    <option value="deny">Deny</option>
                  </select>
                </div>
              ))}
          </div>
        </Section>

        <Section title="Folders OmniPilot can use" hint="File tools only work inside these folders.">
          <ul className="space-y-1.5">
            {roots.map((r) => (
              <li key={r} className="flex items-center justify-between rounded-lg bg-lilac/50 px-3 py-2 text-sm">
                <span className="truncate" title={r}>
                  {r}
                </span>
                <button className="text-ink-faint hover:text-rose-400" onClick={() => setRoots(roots.filter((x) => x !== r))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              className="btn-outline"
              onClick={() => {
                const folder = window.prompt("Full path of the folder to allow, e.g. C:\\Users\\you\\Documents");
                if (folder?.trim() && !roots.includes(folder.trim())) setRoots([...roots, folder.trim()]);
              }}
            >
              Add folder
            </button>
            <button
              className="btn-primary"
              disabled={roots.length === 0 || JSON.stringify(roots) === JSON.stringify(settings.allowed_roots)}
              onClick={() => void save({ allowed_roots: roots }, "Folders updated.")}
            >
              Save folders
            </button>
          </div>
        </Section>

        <Section title="Memory" hint="Only what you add here is remembered. Never store passwords or secrets.">
          <div className="space-y-2">
            {memories.length === 0 && <p className="text-sm text-ink-faint">Nothing stored.</p>}
            {memories.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="chip w-24 shrink-0 justify-center bg-lilac">{m.category}</span>
                <input
                  className="field"
                  defaultValue={m.content}
                  onBlur={async (e) => {
                    const content = e.target.value.trim();
                    if (content && content !== m.content) {
                      await patch(`/memories/${m.id}`, { content });
                      flash(true, "Memory updated.");
                    }
                  }}
                />
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    await del(`/memories/${m.id}`);
                    setMemories(memories.filter((x) => x.id !== m.id));
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <select
              className="field !w-36"
              value={newMemory.category}
              onChange={(e) => setNewMemory({ ...newMemory, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              className="field"
              placeholder="e.g. Reply in Hindi unless I write in English"
              value={newMemory.content}
              onChange={(e) => setNewMemory({ ...newMemory, content: e.target.value })}
            />
            <button
              className="btn-primary"
              disabled={!newMemory.content.trim()}
              onClick={async () => {
                await post("/memories", newMemory);
                setNewMemory({ ...newMemory, content: "" });
                setMemories(await get("/memories"));
              }}
            >
              Add
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
