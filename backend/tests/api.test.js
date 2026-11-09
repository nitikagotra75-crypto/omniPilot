import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { io as connect } from "socket.io-client";
import { H, ScriptedProvider, call, localSite, setup, text, until } from "./helpers.js";

let c;
before(async () => { c = await setup({ provider: new ScriptedProvider([]) }); });
after(() => c.teardown());
const waitTask = async (id) => until(async () => { const t = (await c.req("GET", `/api/tasks/${id}`)).json; return t.status !== "running" ? t : null; });

describe("auth and secrets", () => {
  test("health is open, everything else needs the token", async () => {
    assert.equal((await c.req("GET", "/api/health", undefined, {})).json.status, "ok");
    assert.equal((await c.req("GET", "/api/status", undefined, {})).status, 401);
    assert.equal((await c.req("GET", "/api/status", undefined, { authorization: "Bearer nope" })).status, 401);
    assert.equal((await c.req("GET", "/api/status")).status, 200);
    assert.equal((await c.req("GET", "/api/nothing-here")).status, 404);
  });
  test("API keys are write-only and never persisted in the database", async () => {
    const r = await c.req("PUT", "/api/secrets/llm_api_key", { value: "sk-supersecret" });
    assert.deepEqual(r.json, { name: "llm_api_key", configured: true });
    const s = await c.req("GET", "/api/settings");
    assert.equal(s.json.secrets.llm_api_key, true);
    assert.ok(!s.text.includes("sk-supersecret"));
    const { Setting } = await import("../models/index.js");
    assert.ok(!JSON.stringify(await Setting.find().lean()).includes("sk-supersecret"));
    assert.equal((await c.req("PUT", "/api/secrets/other", { value: "x" })).status, 404);
    assert.equal((await c.req("DELETE", "/api/secrets/llm_api_key")).json.configured, false);
  });
  test("malformed JSON is a 400, not a crash", async () => {
    const res = await fetch(c.base + "/api/settings", { method: "PUT", headers: H, body: "{nope" });
    assert.equal(res.status, 400);
  });
});

describe("settings and permissions", () => {
  test("validation", async () => {
    assert.equal((await c.req("PUT", "/api/settings", { bogus: 1 })).status, 400);
    assert.equal((await c.req("PUT", "/api/settings", { operating_mode: "weird" })).status, 400);
    assert.equal((await c.req("PUT", "/api/settings", { allowed_roots: [] })).status, 400);
    const ok = await c.req("PUT", "/api/settings", { llm_provider: "ollama", llm_model: "llama3" });
    assert.equal(ok.json.llm_provider, "ollama");
    assert.equal((await c.req("GET", "/api/status")).json.llm_configured, true);
  });
  test("permissions endpoint refuses allow for delete", async () => {
    assert.equal((await c.req("PUT", "/api/permissions/fs.delete", { mode: "allow" })).status, 400);
    assert.equal((await c.req("PUT", "/api/permissions/app.launch", { mode: "allow" })).json["app.launch"], "allow");
  });
  test("the tool list is exposed with schemas and permissions", async () => {
    const tools = (await c.req("GET", "/api/tools")).json;
    assert.ok(tools.length >= 30);
    assert.ok(tools.every((t) => t.name && t.description && t.input_schema && Array.isArray(t.permissions)));
  });
});

describe("tasks, memory, realtime", () => {
  test("task round trip, history, action log, conversation messages", async () => {
    c.container.orchestrator.providerFactory = async () => new ScriptedProvider([text("pong")]);
    const r = (await c.req("POST", "/api/tasks", { message: "ping" })).json;
    const t = await waitTask(r.task_id);
    assert.equal(t.status, "completed"); assert.equal(t.result, "pong"); assert.equal(typeof t.created_at, "number");
    assert.equal((await c.req("GET", "/api/tasks")).json[0].id, r.task_id);
    assert.deepEqual((await c.req("GET", `/api/conversations/${r.conversation_id}/messages`)).json.map((m) => m.role), ["user", "assistant"]);
    assert.equal((await c.req("POST", "/api/tasks", { message: "" })).status, 422);
    assert.equal((await c.req("GET", "/api/tasks/not-an-id")).status, 404);
  });
  test("memory CRUD with validation", async () => {
    const id = (await c.req("POST", "/api/memories", { category: "preference", content: "likes dark mode" })).json.id;
    assert.equal((await c.req("PATCH", `/api/memories/${id}`, { content: "likes light mode" })).status, 200);
    assert.equal((await c.req("GET", "/api/memories")).json[0].content, "likes light mode");
    assert.equal((await c.req("DELETE", `/api/memories/${id}`)).status, 200);
    assert.deepEqual((await c.req("GET", "/api/memories")).json, []);
    assert.equal((await c.req("POST", "/api/memories", { category: "nope", content: "x" })).status, 400);
    assert.equal((await c.req("DELETE", `/api/memories/${id}`)).status, 404);
  });
  test("Socket.IO requires the token and streams task events and approvals", async () => {
    const bad = connect(c.base, { auth: { token: "wrong" }, reconnection: false });
    await new Promise((res) => bad.once("connect_error", (e) => { assert.match(e.message, /unauthorized/); res(); }));
    bad.close();
    const s = connect(c.base, { auth: { token: "test-token" }, reconnection: false });
    const seen = []; s.on("event", (e) => seen.push(e));
    await new Promise((r) => s.once("connect", r));
    const victim = path.join(c.config.workspaceDir, "ws.txt"); fs.writeFileSync(victim, "x");
    c.container.orchestrator.providerFactory = async () => new ScriptedProvider([call("delete_file", { path: victim }), text("deleted")]);
    const { task_id } = (await c.req("POST", "/api/tasks", { message: "delete it" })).json;
    const ap = await until(() => seen.find((e) => e.type === "approval.requested"));
    assert.equal(ap.tool, "delete_file");
    assert.equal((await c.req("GET", "/api/approvals")).json.length, 1);
    assert.equal((await c.req("POST", `/api/approvals/${ap.approval_id}`, { approved: true })).status, 200);
    await waitTask(task_id);
    await until(() => seen.some((e) => e.type === "task.completed"));
    assert.deepEqual(["task.started", "approval.requested", "step.started", "step.result", "task.completed"].filter((t) => !seen.some((e) => e.type === t)), []);
    assert.ok(!fs.existsSync(victim));
    assert.equal((await c.req("POST", "/api/approvals/nope", { approved: true })).status, 404);
    s.close();
  });
  test("emergency stop cancels running tasks", async () => {
    c.container.orchestrator.providerFactory = async () => ({ complete: (m, t, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))) });
    const { task_id } = (await c.req("POST", "/api/tasks", { message: "stuck" })).json;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await c.req("POST", "/api/emergency-stop")).json.cancelled_tasks, 1);
    assert.equal((await waitTask(task_id)).status, "cancelled");
  });
});

describe("files and voice", () => {
  test("upload lands inside allowed folders; download is guarded", async () => {
    const form = new FormData(); form.append("file", new Blob(["hello"]), "../../evil name.txt");
    const up = await fetch(c.base + "/api/files/upload", { method: "POST", headers: { authorization: H.authorization }, body: form });
    const { path: p } = await up.json();
    assert.ok(p.startsWith(fs.realpathSync(c.config.uploadsDir)) && fs.readFileSync(p, "utf8") === "hello");
    const dl = await fetch(`${c.base}/api/files/download?path=${encodeURIComponent(p)}`, { headers: { authorization: H.authorization } });
    assert.equal(await dl.text(), "hello");
    const bad = await fetch(`${c.base}/api/files/download?path=${encodeURIComponent("/etc/passwd")}`, { headers: { authorization: H.authorization } });
    assert.equal(bad.status, 403);
  });
  test("transcription forwards audio to an OpenAI-compatible endpoint and reports setup problems", async () => {
    const form = () => { const f = new FormData(); f.append("audio", new Blob([Buffer.from("fakeaudio")], { type: "audio/webm" }), "s.webm"); return f; };
    const post = (f) => fetch(c.base + "/api/voice/transcribe", { method: "POST", headers: { authorization: H.authorization }, body: f }).then(async (r) => ({ status: r.status, json: await r.json() }));
    await c.req("PUT", "/api/settings", { llm_provider: "anthropic", llm_model: "x" });
    assert.match((await post(form())).json.detail, /OpenAI-compatible/);
    let seen;
    const stt = await localSite(async (req, res) => {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      seen = { url: req.url, body: Buffer.concat(chunks).toString("latin1") };
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: " नमस्ते दुनिया " }));
    });
    await c.req("PUT", "/api/settings", { llm_provider: "custom", llm_model: "x", llm_base_url: stt.url + "/v1", stt_model: "whisper-test" });
    const r = await post(form());
    assert.equal(r.json.text, "नमस्ते दुनिया");
    assert.equal(seen.url, "/v1/audio/transcriptions"); assert.match(seen.body, /whisper-test/); assert.match(seen.body, /fakeaudio/);
    await stt.close();
    assert.equal((await post(form())).status, 502); // endpoint gone
  });
});
