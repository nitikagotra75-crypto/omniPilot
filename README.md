# OmniPilot

**One Assistant. Your Entire Digital World.**

A desktop AI assistant that acts on your computer through permissioned, verified tools. 100% JavaScript — no Python anywhere.

```
frontend/   React + Vite + Tailwind  (the UI, prebuilt into dist/)
backend/    Node.js + Express + Socket.IO + Mongoose (orchestrator, tools, browser agent, permissions)
README.md
```

```
Browser/React ──REST + Socket.IO (bearer token, localhost)──► Express ──► LLM provider (cloud or local)
                                                                  │
                                         orchestrator ──► tool registry ──► files · PDF · docs · images · system · apps · browser · memory
                                                                  │
                                    permissions · approvals · action log · MongoDB
```

The model picks tools; the backend validates arguments (Ajv), checks permissions, asks you to approve sensitive actions,
runs the tool with a timeout and reports success only when the tool's own verification passed. Tool/web output is passed
back to the model wrapped as untrusted content.

## Requirements

- Node 20+
- **MongoDB** reachable at `MONGODB_URI` (default `mongodb://127.0.0.1:27017/omnipilot`). If MongoDB is unreachable the backend exits and the UI shows why.
- Playwright Chromium for the browser agent: `cd backend && npx playwright install chromium`

## Run (Windows)

Needs **Node.js 22 LTS** (20.12+ works) and **MongoDB** running (or an Atlas string in `MONGODB_URI`).

1. Double-click `backend\start-windows.bat`. The first time it installs packages and creates `backend\.env` from `.env.example`, then opens it.
2. In `.env` set the AI model once: `OMNIPILOT_LLM_PROVIDER`, `OMNIPILOT_LLM_MODEL`, `OMNIPILOT_LLM_API_KEY` (and `OMNIPILOT_LLM_BASE_URL` for OpenAI-compatible services such as Groq). Save, then run the .bat again.
3. Open **http://127.0.0.1:3939** (type `http://`).

You can also skip `.env` for the model: open **Settings** in the app, pick a provider (Groq, OpenAI, …), paste the API key and save (the key is stored encrypted on this computer). If `OMNIPILOT_LLM_*` is set in `.env`, those values win and the form is read-only.
**Voice (optional):** add `OMNIPILOT_GNANI_API_KEY=` to `.env` to use Gnani **Prisma** for speech-to-text and **Timbre** for spoken replies (Hindi and English). `OMNIPILOT_SPEAK_REPLIES` decides when the agent speaks its answer (e.g. "ho gaya"): `voice` (default, after you spoke to it), `always`, or `off`. Without a Gnani key the app uses the browser's own voice and the model provider's transcription. The thinking stays with the model above; Gnani Evon is not used because it has no public API documentation.

Do not share your `.env` or zip it with a real key inside.
Without the .bat: `cd backend && npm install && npm run web`. Optional, for the browser agent: `npx playwright install chromium`.

The backend serves the prebuilt UI from `frontend/dist`; keep `frontend` and `backend` side by side.
**Changing the UI:** `cd frontend && npm install && npm run build`, or `npm run dev` (hot reload on :5173, backend must be running); `npm run format` formats the source.
**Backend tests:** `cd backend && npm test` (set `$env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017"`; the real mouse/keyboard tests only run on a Linux display).

No tray, global shortcuts or installer in this version; use the Emergency stop button.

## What works (tested)

- Conversation, tool-calling orchestrator with plan → act → verify, retries, step cap, per-task cancel, emergency stop.
- Computer control (`backend/computer`, tools `computer_*`): screenshot (sent to vision-capable models; stored nowhere), window list, mouse move/click/double/right-click/drag/scroll, typing (Unicode via clipboard paste), key combos, focus window, wait, and on Windows a UI Automation control list. Every action is permission-gated (`computer.screen` / `computer.input`, default ask), can carry an `expect` check (window title / screen change) that decides `verified`, and the emergency stop halts input and releases held keys. Blocked: Win+R/X/L, Ctrl+Alt+Del, typing into terminals/Run box.
- Tools: file list/find/read/write/copy/move/delete (delete = move to trash, always confirmed), PDF info/compress/merge/extract, Excel/CSV and Word read/write, image info/convert/resize, system info/processes, allowlisted app launch, memory (user-approved), and a Playwright browser agent (open/read/click/fill/screenshot/search/download, visible mode, sign-in hand-off).
- Security: path allowlist with symlink-safe checks, never overwrites originals, browser SSRF policy (private/loopback blocked, incl. redirects), passwords never typed by the agent, token-protected localhost API and WebSocket, secrets in AES-256-GCM store, no shell tool.
- Voice: browser speech synthesis (incl. Hindi); microphone → WAV → `/api/voice/transcribe`; with a Gnani key, Prisma STT and Timbre TTS (`/api/voice/speak`) — tested against a local stand-in server only.
- `open_file`: opens a document, photo or folder inside the allowed folders with the OS default app (e.g. find `img4` in Downloads, then open it). Programs and scripts are refused; the result is reported as *unverified* because the OS gives no confirmation.
- Earlier end-to-end run of the (now removed) Electron shell, and a browser-mode run (Chrome, Vite dev proxy and the backend-served build) against a scripted fake model (`backend/tests/fixtures/fake-model.mjs`): approval dialog, verified badge, chat round-trip.

## Honest status — not done or not verified

- **Tests ran against FerretDB (SQLite), not real MongoDB.**
- **Computer control caveats:** tested only on Linux/X11 under Xvfb (real injected clicks, typing, drag, scroll and screenshots verified through a real browser page's DOM). **The Windows path has not been run**: window titles/focus, active-window verification, UI Automation (`computer_ui_elements`), DPI scaling and clipboard-based Unicode typing are untested. Without a vision model the agent sees only window titles/UI Automation text. No OCR. Passwords are not auto-detected in arbitrary windows (the agent is told never to type them; UIA skips password fields).
- **Not implemented:** developer/research/productivity agents, creative/media tools beyond images, dynamic tool creation with sandboxing, offline/hybrid auto-routing (offline mode only blocks cloud providers). `backend/computer`, `agents`, `integrations`, `memory`, `file-processing` are placeholders.
- **Unverified on Windows:** tray, global shortcuts, app launching, installer. `npm run dist` has never been run; bundling backend `node_modules` and Playwright browsers into the installer is unfinished.
- Real cloud-LLM calls and the real Gnani service were not exercised (no keys here); tests use scripted providers and a stand-in Gnani server. Browser recording → WAV conversion was not run in a real browser.

## Adding a tool

Add an object `{name, description, input_schema, permissions, timeout, handler}` in `backend/tools/` and include it in `backend/tools/index.js`. State-changing tools must verify their own effect and return `verified: true` only if they observed it.
