import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { ActionLog, Message, Task } from "../models/index.js";
import { LLMError } from "../services/llm/base.js";
import { ScriptedProvider, call, setup, text, until } from "./helpers.js";

let c;
afterEach(() => c?.teardown());
const run = async (provider, msg = "hi") => {
  c = await setup({ provider });
  const events = []; c.container.bus.subscribe((e) => events.push(e));
  const { taskId, conversationId } = await c.container.orchestrator.startTask(msg);
  return { taskId, conversationId, events };
};
const finish = async (taskId) => { await c.container.orchestrator.wait(taskId); return Task.findById(taskId).lean(); };
const approve = async (answer) => {
  const p = await until(() => c.container.approvals.pending()[0]);
  c.container.approvals.resolve(p.approval_id, answer);
  return p;
};

describe("orchestrator", () => {
  test("conversational answer uses no tools and is stored", async () => {
    const { taskId, conversationId } = await run(new ScriptedProvider([text("Hooks let function components use state.")]), "Explain React hooks");
    const t = await finish(taskId);
    assert.equal(t.status, "completed"); assert.equal(t.steps.length, 0);
    assert.deepEqual((await Message.find({ conversationId }).sort({ _id: 1 })).map((m) => m.role), ["user", "assistant"]);
  });

  test("tool call really runs, verified step recorded, result fed back as untrusted", async () => {
    c = await setup({ provider: new ScriptedProvider([]) });
    const d = await PDFDocument.create(); d.addPage([300, 300]);
    const pdf = path.join(c.config.workspaceDir, "a.pdf"); fs.writeFileSync(pdf, await d.save());
    const prov = new ScriptedProvider([call("pdf_compress", { path: pdf }), text("Compressed it.")]);
    c.container.orchestrator.providerFactory = async () => prov;
    const events = []; c.container.bus.subscribe((e) => events.push(e.type));
    const { taskId } = await c.container.orchestrator.startTask("Compress this PDF");
    const t = await finish(taskId);
    assert.equal(t.status, "completed"); assert.equal(t.steps.length, 1); assert.ok(t.steps[0].verified);
    assert.ok(fs.existsSync(path.join(c.config.workspaceDir, "a-compressed.pdf")));
    const last = prov.calls.at(-1).messages.at(-1);
    assert.equal(last.role, "tool"); assert.match(last.content, /^<untrusted_content>/);
    assert.ok(events.includes("step.result") && events.includes("task.completed"));
  });

  test("sensitive tool waits for approval; decline is respected and logged", async () => {
    c = await setup({ provider: new ScriptedProvider([]) });
    const victim = path.join(c.config.workspaceDir, "keep.txt"); fs.writeFileSync(victim, "important");
    c.container.orchestrator.providerFactory = async () => new ScriptedProvider([call("delete_file", { path: victim }), text("Okay, not deleting.")]);
    const { taskId } = await c.container.orchestrator.startTask("delete keep.txt");
    const p = await approve(false);
    assert.equal(p.tool, "delete_file");
    const t = await finish(taskId);
    assert.ok(fs.existsSync(victim)); assert.equal(t.steps[0].ok, false);
    assert.ok(await ActionLog.exists({ tool: "delete_file", approved: false }));
  });

  test("approved delete runs", async () => {
    c = await setup({ provider: new ScriptedProvider([]) });
    const victim = path.join(c.config.workspaceDir, "bye.txt"); fs.writeFileSync(victim, "x");
    c.container.orchestrator.providerFactory = async () => new ScriptedProvider([call("delete_file", { path: victim }), text("Deleted.")]);
    const { taskId } = await c.container.orchestrator.startTask("delete bye.txt");
    assert.ok(fs.existsSync(victim)); // nothing happens before approval
    await approve(true); await finish(taskId);
    assert.ok(!fs.existsSync(victim));
  });

  test("denied permission blocks without asking", async () => {
    c = await setup({ provider: new ScriptedProvider([call("list_directory", { path: "/tmp" }), text("blocked")]) });
    await c.container.perms.setGrant("fs.read", "deny");
    const { taskId } = await c.container.orchestrator.startTask("list");
    const t = await finish(taskId);
    assert.equal(t.steps[0].ok, false); assert.equal(c.container.approvals.pending().length, 0);
  });

  test("unknown tools, bad arguments and paths outside the boundary fail cleanly", async () => {
    const { taskId } = await run(new ScriptedProvider([call("rm_rf_everything", {}, "a"), call("list_directory", {}, "b"), call("read_text_file", { path: "/etc/passwd" }, "c"), text("ok")]));
    const t = await finish(taskId);
    assert.deepEqual(t.steps.map((s) => s.ok), [false, false, false]);
    assert.match(t.steps[2].result.error, /outside/);
  });

  test("not configured fails with a clear code", async () => {
    c = await setup({});
    const events = []; c.container.bus.subscribe((e) => events.push(e));
    const { taskId } = await c.container.orchestrator.startTask("hello");
    const t = await finish(taskId);
    assert.equal(t.status, "failed"); assert.match(t.error, /Settings/);
    assert.ok(events.some((e) => e.type === "task.failed" && e.code === "not_configured"));
  });

  test("LLM errors are reported; recoverable ones are retried", async () => {
    let { taskId } = await run({ complete: async () => { throw new LLMError("bad key"); } });
    assert.equal((await finish(taskId)).status, "failed");
    await c.teardown();
    let n = 0;
    ({ taskId } = await run({ complete: async () => { if (++n === 1) throw new LLMError("rate limit", { recoverable: true }); return text("recovered"); } }));
    const t = await finish(taskId);
    assert.equal(t.result, "recovered"); assert.equal(n, 2);
  });

  test("cancel and emergency stop interrupt a stuck model call", async () => {
    const slow = { complete: (m, t, { signal } = {}) => new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 30000)) };
    c = await setup({ provider: slow });
    const o = c.container.orchestrator;
    // provider that honours the abort signal like fetch does
    const abortable = { complete: (m, t, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) };
    o.providerFactory = async () => abortable;
    const a = await o.startTask("a");
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(o.cancel(a.taskId));
    assert.equal((await finish(a.taskId)).status, "cancelled");
    const b = await o.startTask("b");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await o.emergencyStop(), 1);
    assert.equal((await finish(b.taskId)).status, "cancelled");
  });

  test("cancelling while an approval is pending denies it and stops", async () => {
    c = await setup({ provider: new ScriptedProvider([call("delete_file", { path: "/tmp/x" }), text("never")]) });
    const { taskId } = await c.container.orchestrator.startTask("x");
    await until(() => c.container.approvals.pending()[0]);
    c.container.orchestrator.cancel(taskId);
    assert.equal((await finish(taskId)).status, "cancelled");
  });

  test("approved memories are injected into the prompt; step cap is enforced", async () => {
    c = await setup({ provider: new ScriptedProvider([]) });
    const { Memory } = await import("../models/index.js");
    await Memory.create({ category: "preference", content: "Prefers Hindi replies" });
    const prov = new ScriptedProvider(Array.from({ length: 50 }, () => call("system_info")));
    c.container.orchestrator.providerFactory = async () => prov;
    c.config.maxAgentSteps = 3;
    const { taskId } = await c.container.orchestrator.startTask("loop");
    const t = await finish(taskId);
    assert.match(prov.calls[0].messages[0].content, /Prefers Hindi replies/);
    assert.equal(t.steps.length, 3); assert.match(t.result, /maximum number of steps/);
  });

  test("a tool timeout is reported as recoverable and retried once", async () => {
    c = await setup({ provider: new ScriptedProvider([call("slow_tool"), text("it timed out")]) });
    let runs = 0;
    c.container.registry.register({ name: "slow_tool", description: "x", permissions: ["system.read"], timeout: 0.1,
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: () => { runs++; return new Promise(() => {}); } });
    const { taskId } = await c.container.orchestrator.startTask("x");
    const t = await finish(taskId);
    assert.equal(runs, 2); assert.match(t.steps[0].result.error, /timed out/);
  });
});
