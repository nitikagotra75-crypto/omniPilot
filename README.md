# OmniPilot

**One assistant. Your whole computer. Just talk to it.**

OmniPilot is a voice-first AI assistant that does real work on your computer. You tap the mic and say
*"Open img4 from download folder"*. It finds the file, opens it, and answers back in your language (Hindi, English or Hinglish).

 Speech comes in through **Gnani Prisma** and goes out through
**Gnani Timbre**. The whole project is JavaScript (no Python).

> OmniPilot never says "done" unless it checked. If it cannot check, the result is shown as **unverified**.

---

## What it can do

| Area | Examples (say or type) |
|---|---|
| **Answer questions** | "What is useState in raect?" |
| **Know your laptop** | "whats app running now in my laptop?" · "Memory kitni use ho rahi hai?" · "Internet chal raha hai?" |
| **Files** | "Downloads me saari PDF dhundho" · "notes.txt banao" · "Downloads se img4 kholo" |
| **Delete (safely)** | "Ye file delete karo" → it **asks first**, then moves it to a trash folder |
| **PDF** | merge, compress, extract pages, info |
| **Images** | info, convert, resize |
| **Documents** | read and write Word (.docx) and Excel/CSV |
| **Apps** | open a program from a fixed allowlist |
| **Browser** | search, open, read, click, fill forms, download (Playwright) |
| **Screen control** | screenshot, mouse, keyboard, focus a window (Windows, after you allow it) |
| **Memory** | remembers preferences, only after you approve |
| **Voice** | tap the mic to talk, tap again to send. It talks back. |

---

## How it works

```
 you speak ─► [Gnani Prisma]  speech ─► text
                    │
                    ▼
             LLM "brain" (Groq / Gemini / OpenAI / Anthropic / local)
                    │  plans the task, picks a tool
                    ▼
        ┌── permission check ── ask you if it is sensitive
        ▼
   tool registry: files · PDF · docs · images · system · apps · browser · screen · memory
        │
        ▼
     verify the result  ──►  reply in text  +  [Gnani Timbre]  text ─► speech
```

- **Orchestrator:** plan → act → verify loop with retries, a step limit, per-task cancel and an emergency stop.
- **Tool registry:** every tool has a JSON schema (checked with Ajv), a permission, a timeout, and a way to verify its own effect.
- **Live UI:** progress steps, approval dialogs and results stream over Socket.IO.

### Folder layout

```
frontend/   React + Vite + Tailwind. The UI (prebuilt into frontend/dist).
backend/    Node.js + Express + Socket.IO + Mongoose.
  orchestrator/  the plan/act/verify loop and prompts
  tools/         all tools (files, pdf, images, system, apps, browser, computer ...)
  computer/      mouse, keyboard, screen, window control and the emergency stop
  voice/         Gnani Prisma and Timbre, and the fallback transcription
  services/      LLM providers, permissions, path guard, encrypted secrets, settings
  tests/         automated tests
README.md
```

---

## Quick start (Windows)

**You need:** Node.js 22 LTS (20.12+ also works) and MongoDB running on your computer.

1. Keep the `frontend` and `backend` folders **side by side**.
2. Double-click **`backend\start-windows.bat`**.
   First time it installs packages, creates `backend\.env` and opens it.
3. Open **http://127.0.0.1:3939** in your browser. Type the `http://` part yourself.
4. In the app, open **Settings → AI model**. Pick a provider, paste your API key, press **Save and connect**.

Without the .bat:

```
cd backend
npm install
npm run web
```

Optional, for the browser agent: `npx playwright install chromium`

---

## Connecting an AI model

Two ways. Use only one.

**A. In the app (easiest).** Settings → AI model → provider, model, API key → Save.
The key is stored encrypted on your computer.

**B. In `backend\.env`.** The app then shows the model as read-only.

| Provider | `.env` lines |
|---|---|
| **Groq** | `OMNIPILOT_LLM_PROVIDER=groq` · `OMNIPILOT_LLM_MODEL=openai/gpt-oss-120b` · `OMNIPILOT_LLM_API_KEY=...` |
| **Gemini** | `OMNIPILOT_LLM_PROVIDER=custom` · `OMNIPILOT_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/` · `OMNIPILOT_LLM_MODEL=gemini-3.8-flash` · `OMNIPILOT_LLM_API_KEY=...` |
| **OpenAI / Anthropic / OpenRouter** | `OMNIPILOT_LLM_PROVIDER=openai` (or `anthropic`, `openrouter`) plus model and key |
| **Local (Ollama, LM Studio)** | `OMNIPILOT_LLM_PROVIDER=ollama` and a model name. No key needed. |

Model names change often. If you get "model not found", copy the current name from your provider's dashboard.
The model must support **tool calling**.

---

## Voice (Gnani AI)

Add your Gnani key in **Settings → Voice**, or in `.env`:

```
OMNIPILOT_GNANI_API_KEY=your_key
```

| Without a Gnani key | With a Gnani key |
|---|---|
| Speech to text: the model provider's transcription | **Gnani Prisma** (`prisma-v3.0`, automatic Indian-language detection) |
| Spoken replies: the browser's own voice | **Gnani Timbre** (`timbre-v2.5`, Hindi and English voices) |

**How to talk:** tap the mic, speak, tap again. Your message is sent straight away and the answer is spoken back.
Recordings are limited to 28 seconds.

`OMNIPILOT_SPEAK_REPLIES` controls spoken answers: `voice` (default, after you spoke), `always`, or `off`.

Gnani Evon is not used because no public API documentation was available.

---

## Safety

OmniPilot is built to earn trust, not just to be powerful.

- **Permission first.** Opening apps, mouse/keyboard control and screen capture ask you by default.
- **Deleting always asks**, and only deletes **one file** at a time. The file goes to a trash folder, it is not erased.
- **Allowed folders only.** File tools work only inside folders you allow (Settings → Folders). Links that escape them are refused.
- **No shell tool.** The model cannot run arbitrary commands. Programs and scripts (`.exe`, `.bat`, `.ps1` ...) are never opened by `open_file`.
- **Emergency stop.** One button cancels tasks, denies pending approvals, and releases mouse and keyboard.
- **Verified results.** Every action is checked, or clearly marked *unverified*.
- **Web pages are untrusted.** Page text is treated as data, never as instructions. Private and local addresses are blocked in the browser agent.
- **Keys are protected.** API keys live in an encrypted store or `.env`. They are never sent to the browser or written to logs.
- **Local only.** The engine listens on your computer and every call needs a session token.
- Blocked key combinations: Win+R, Win+X, Win+L, Ctrl+Alt+Del. The agent refuses to type into terminals.

Never share your `.env` or put it in a zip.

---

## Configuration reference (`backend/.env`)

| Variable | Meaning |
|---|---|
| `OMNIPILOT_LLM_PROVIDER` / `_MODEL` / `_BASE_URL` / `_API_KEY` | The AI model. If set, the app cannot change it. |
| `OMNIPILOT_GNANI_API_KEY` | Turns on Gnani Prisma and Timbre. |
| `OMNIPILOT_GNANI_STT_MODEL` / `_TTS_MODEL` | Override the Gnani model names. |
| `OMNIPILOT_SPEAK_REPLIES` | `voice`, `always` or `off`. |
| `MONGODB_URI` | Default `mongodb://127.0.0.1:27017/omnipilot`. |
| `PORT` | Default `3939`. |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Cannot GET /" | `frontend` must sit next to `backend` and contain `dist`. Rebuild with `npm run build` in `frontend`. |
| Page does not load or shows an SSL error | Type the full address `http://127.0.0.1:3939`. |
| Engine does not start, mentions MongoDB | Start MongoDB, or set `MONGODB_URI` (for example an Atlas string). |
| "Connect an AI model first" | Settings → AI model → save a provider and key. |
| Model not found | Use the current model name from your provider. It must support tools. |
| Mic does nothing | Allow microphone access in the browser. Use `127.0.0.1` or `localhost`. |
| Port 3939 busy | Set `PORT` in `.env`. |

---

## Development

```
cd frontend && npm install && npm run dev        # hot reload on :5173 (backend must be running)
cd frontend && npm run build                     # rebuild frontend/dist
cd frontend && npm run format                    # Prettier

cd backend  && npm test                          # automated tests
```

Tests need a MongoDB: `$env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017"`. The real mouse and keyboard tests run only on a Linux display.

**Add a tool:** create an object `{ name, description, inputSchema, permissions, timeout, handler }` in `backend/tools/` and register it in `backend/tools/index.js`.
A tool that changes something must check its own effect and return `verified: true` only if it saw it.

---

## Honest status

**Tested (93 automated backend tests passing):** orchestrator, tool validation, permissions and approvals, emergency stop,
path safety, browser agent (real Chromium), computer control on Linux (real mouse, keyboard and screenshots), the API,
`open_file`, and the Gnani voice calls against a stand-in server.

**Not verified yet**
- Tests ran against FerretDB (SQLite), not a real MongoDB.
- The **real Gnani service** and real cloud models were not called during testing. Check them with your own keys.
- **Windows:** mouse/keyboard control, window titles, UI Automation, `open_file` and the .bat were not run on Windows.
- Browser recording to WAV conversion was not run in a real browser.
- `open_file` cannot confirm that a window appeared, so it reports *unverified*.

**Not built yet:** developer, research and productivity agents; dynamic tool creation in a sandbox; automatic offline/hybrid routing;
tray icon, global shortcuts and installer. The folders `agents`, `integrations`, `memory` and `file-processing` are placeholders.

---
