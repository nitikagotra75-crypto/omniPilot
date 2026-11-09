import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDb } from "../config/db.js";
import { loadConfig } from "../config/index.js";
import { buildContainer } from "../services/container.js";
import { SecretStore } from "../services/secretStore.js";

export const MONGO = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27018";
export const TOKEN = "test-token";
export const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

/** Scripted LLM: returns queued responses, records what it was sent. */
export class ScriptedProvider {
  constructor(responses = []) { this.responses = [...responses]; this.calls = []; }
  async complete(messages, tools) {
    this.calls.push({ messages: structuredClone(messages), tools });
    return this.responses.shift() ?? { text: "done", toolCalls: [] };
  }
}
export const text = (t) => ({ text: t, toolCalls: [] });
export const call = (name, args = {}, id = `call_${name}`) => ({ text: "", toolCalls: [{ id, name, arguments: args }] });

export async function setup({ provider, browser, env = {} } = {}) {
  const dbName = "t_" + Math.random().toString(36).slice(2, 10);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnipilot-test-"));
  await connectDb(`${MONGO}/${dbName}`);
  const config = { ...loadConfig({ OMNIPILOT_DATA_DIR: dataDir, OMNIPILOT_TOKEN: TOKEN, ...env }) };
  const container = await buildContainer(config, {
    secrets: new SecretStore({ file: config.secretsFile, masterKey: "" , env: {} }),
    providerFactory: provider ? async () => provider : undefined,
    browser,
  });
  container.orchestrator.sleepFn = async () => {};
  const api = createApp(container);
  await new Promise((r) => api.httpServer.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${api.httpServer.address().port}`;
  const req = async (method, url, body, headers = H) => {
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await res.text();
    let json; try { json = JSON.parse(t); } catch { json = t; }
    return { status: res.status, json, text: t };
  };
  const teardown = async () => {
    await api.close();
    await new Promise((r) => api.httpServer.close(r));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { container, config, api, base, req, teardown, dataDir };
}

export async function until(fn, ms = 8000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export function localSite(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }));
  });
}

export const toolCtx = (c, extra = {}) => ({ taskId: "t", guard: c.container.guard, config: c.config, signal: new AbortController().signal, ...extra });
export const runTool = (c, name, args, extra) => c.container.registry.run(c.container.registry.get(name), args, toolCtx(c, extra));
