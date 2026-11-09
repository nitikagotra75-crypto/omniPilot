// Gnani voice (Prisma STT, Timbre TTS) against a local stand-in server, and the open_file tool.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { sttLanguage, ttsLanguage } from "../voice/gnani.js";
import { ScriptedProvider, localSite, setup, toolCtx } from "./helpers.js";

let c, gnani, seen;
const KEY = "gn-test-key";

beforeEach(async () => {
  seen = [];
  gnani = await localSite(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const body = Buffer.concat(chunks);
    seen.push({ url: req.url, key: req.headers["x-api-key-id"], type: req.headers["content-type"], body });
    if (req.headers["x-api-key-id"] !== KEY) return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ detail: { error_code: "INVALID_API_KEY", message: "bad key" } }));
    if (req.url === "/stt/v3") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, transcript: " नमस्ते दुनिया ", detected_language_code: "hi-IN" }));
    if (req.url === "/api/v1/tts/inference") return res.writeHead(200, { "content-type": "audio/mpeg" }).end(Buffer.from("ID3-fake-mp3"));
    res.writeHead(404).end();
  });
  process.env.OMNIPILOT_GNANI_BASE_URL = gnani.url;
  c = await setup({ provider: new ScriptedProvider([]) });
});
afterEach(async () => {
  delete process.env.OMNIPILOT_GNANI_BASE_URL;
  await gnani.close();
  await c.teardown();
});

const form = () => {
  const f = new FormData();
  f.append("audio", new Blob(["RIFFfakewav"], { type: "audio/wav" }), "speech.wav");
  f.append("language", "hi-IN");
  return f;
};
const transcribe = () => fetch(`${c.base}/api/voice/transcribe`, { method: "POST", headers: { authorization: "Bearer test-token" }, body: form() });

describe("Gnani voice", () => {
  test("language helpers", () => {
    assert.equal(sttLanguage("auto", "prisma-v3.0"), "indic-auto");
    assert.equal(sttLanguage("auto", "prisma-v2.5"), "en-IN");
    assert.equal(sttLanguage("en-US", "prisma-v3.0"), "en-IN");
    assert.equal(sttLanguage("hi-IN", "prisma-v3.0"), "hi-IN");
    assert.equal(ttsLanguage("नमस्ते, आप कैसे हैं?"), "hi-IN");
    assert.equal(ttsLanguage("Hello there"), "en-IN");
  });

  test("without a key the app uses the browser voice and the speak route says so", async () => {
    assert.deepEqual((await c.req("GET", "/api/status")).json.voice, { stt: "provider", tts: "browser" });
    assert.equal((await c.req("POST", "/api/voice/speak", { text: "hi" })).status, 404);
  });

  test("with a key: Prisma gets the audio with the right fields, and the transcript comes back", async () => {
    c.container.secrets.set("gnani_api_key", KEY);
    assert.deepEqual((await c.req("GET", "/api/status")).json.voice, { stt: "gnani", tts: "gnani" });
    const res = await transcribe();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: "नमस्ते दुनिया", language: "hi-IN" });
    const req = seen[0];
    assert.equal(req.url, "/stt/v3"); assert.equal(req.key, KEY); assert.match(req.type, /^multipart\/form-data/);
    const raw = req.body.toString("latin1");
    for (const needle of ['name="audio_file"', "RIFFfakewav", "prisma-v3.0", "hi-IN", "transcribe"]) assert.ok(raw.includes(needle), needle);
  });

  test("a wrong key becomes a clear error, never a crash, and the key is not echoed", async () => {
    c.container.secrets.set("gnani_api_key", "wrong-key");
    const res = await transcribe();
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.match(text, /rejected the API key/); assert.ok(!text.includes("wrong-key"));
  });

  test("Timbre: Hindi text uses the Hindi voice, returns mp3 bytes, and sends the documented body", async () => {
    c.container.secrets.set("gnani_api_key", KEY);
    const res = await fetch(`${c.base}/api/voice/speak`, { method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify({ text: "नमस्ते" }) });
    assert.equal(res.status, 200); assert.equal(res.headers.get("content-type"), "audio/mpeg");
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "ID3-fake-mp3");
    const sent = JSON.parse(seen[0].body.toString());
    assert.equal(seen[0].url, "/api/v1/tts/inference"); assert.equal(seen[0].key, KEY);
    assert.deepEqual({ model: sent.model, voice: sent.voice, language: sent.language, container: sent.audio_config.container }, { model: "timbre-v2.5", voice: "Nalini", language: "hi-IN", container: "mp3" });
    await fetch(`${c.base}/api/voice/speak`, { method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify({ text: "Hello" }) });
    assert.equal(JSON.parse(seen[1].body.toString()).voice, "Kaveri");
  });

  test("speak validates input and needs the app token", async () => {
    c.container.secrets.set("gnani_api_key", KEY);
    assert.equal((await c.req("POST", "/api/voice/speak", { text: "  " })).status, 422);
    assert.equal((await c.req("POST", "/api/voice/speak", { text: "x" }, {})).status, 401);
  });
});

describe("open_file", () => {
  const fakeSpawn = (log) => (cmd, args) => {
    log.push([cmd, args]);
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  const open = (p, platform = "win32", log = []) => {
    const tool = c.container.registry.get("open_file");
    return tool.handler({ path: p }, toolCtx(c), { platform, spawnFn: fakeSpawn(log) }).then((r) => ({ r, log }));
  };

  test("opens a photo with the OS opener, passing the path as a single argument (no shell)", async () => {
    const file = path.join(c.config.workspaceDir, "img4 (final) & more.jpg");
    fs.writeFileSync(file, "x");
    const { r, log } = await open(file);
    assert.equal(r.ok, true); assert.equal(r.verified, false); assert.match(r.verification, /not checked/);
    assert.deepEqual(log, [["explorer.exe", [fs.realpathSync(file)]]]);
    assert.equal((await open(file, "darwin")).log[0][0], "open");
    assert.equal((await open(file, "linux")).log[0][0], "xdg-open");
  });

  test("refuses programs and scripts, missing files and paths outside the allowed folders", async () => {
    for (const name of ["setup.exe", "run.bat", "x.ps1", "evil.lnk", "tool.py"]) {
      const f = path.join(c.config.workspaceDir, name); fs.writeFileSync(f, "x");
      const { r, log } = await open(f);
      assert.equal(r.ok, false, name); assert.equal(log.length, 0);
    }
    assert.match((await open(path.join(c.config.workspaceDir, "nope.jpg"))).r.error, /Not found/);
    const outside = (await open("/etc/hostname")).r;
    assert.equal(outside.ok, false);
  });

  test("a folder can be opened and the tool asks for permission", async () => {
    assert.equal((await open(c.config.workspaceDir)).r.data.kind, "folder");
    assert.deepEqual(c.container.registry.get("open_file").permissions, ["app.launch"]);
  });
});

describe("spoken replies policy", () => {
  test("OMNIPILOT_SPEAK_REPLIES controls when the app talks back", async () => {
    try {
      assert.equal((await c.req("GET", "/api/status")).json.speak_replies, "voice");
      process.env.OMNIPILOT_SPEAK_REPLIES = "ALWAYS";
      assert.equal((await c.req("GET", "/api/status")).json.speak_replies, "always");
      process.env.OMNIPILOT_SPEAK_REPLIES = "banana";
      assert.equal((await c.req("GET", "/api/status")).json.speak_replies, "voice");
    } finally {
      delete process.env.OMNIPILOT_SPEAK_REPLIES;
    }
  });
});

describe("keys entered in the app", () => {
  test("the Gnani key can be saved and removed from the app, and the Groq preset exists", async () => {
    assert.equal((await c.req("GET", "/api/providers")).json.groq.base_url, "https://api.groq.com/openai/v1");
    assert.equal((await c.req("PUT", "/api/secrets/gnani_api_key", { value: "k1" })).status, 200);
    assert.equal((await c.req("GET", "/api/settings")).json.secrets.gnani_api_key, true);
    assert.equal((await c.req("GET", "/api/status")).json.voice.stt, "gnani");
    assert.equal((await c.req("DELETE", "/api/secrets/gnani_api_key")).status, 200);
    assert.equal((await c.req("GET", "/api/status")).json.voice.stt, "provider");
  });
});
