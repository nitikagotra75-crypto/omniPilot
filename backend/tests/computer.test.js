// Computer-control tests. Real OS-level input is injected (nut-js / X11 under Xvfb) into a real headed Chromium page,
// and the page's own DOM proves whether the click/keystrokes actually arrived. Run with: xvfb-run -a npm test
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { chromium } from "playwright";
import { ComputerController } from "../computer/controller.js";
import { loadNutDriver } from "../computer/driver.js";
import { isBlockedCombo, parseCombo } from "../computer/keys.js";
import { parseUia } from "../computer/uia.js";
import { ActionLog, Task } from "../models/index.js";
import { ScriptedProvider, call, runTool, setup, text, until } from "./helpers.js";

const hasDisplay = !!process.env.DISPLAY;
const PAGE = `<!doctype html><body style="margin:0;height:3000px;font:16px sans-serif">
<button id="b" style="position:absolute;left:100px;top:100px;width:200px;height:60px" onclick="this.dataset.n=(+this.dataset.n||0)+1;document.body.style.background='#9cf'">Press</button>
<input id="i" style="position:absolute;left:100px;top:200px;width:300px;height:40px">
<div id="d" style="position:absolute;left:100px;top:300px;width:400px;height:120px;background:#eee"></div>
<script>window.ev=[];const d=document.getElementById('d');
d.addEventListener('mousedown',e=>ev.push(['down',e.clientX,e.clientY]));d.addEventListener('mouseup',e=>ev.push(['up',e.clientX,e.clientY]));
document.addEventListener('mouseup',e=>{});</script></body>`;

let browser, page, controller, origin;
const real = (rect) => page.evaluate((r) => [window.screenX + r.x + r.w / 2, window.screenY + (window.outerHeight - window.innerHeight) + r.y + r.h / 2], rect);
const center = async (sel) => {
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel);
  const [x, y] = await real(r);
  const v = await controller.view();
  return { x: Math.round(x * v.scale), y: Math.round(y * v.scale) };
};

describe("key parsing and safety (no display needed)", () => {
  test("parses combos, rejects unknown keys, blocks dangerous ones", () => {
    assert.deepEqual(parseCombo("Ctrl + Shift+S"), ["ctrl", "shift", "s"]);
    assert.throws(() => parseCombo("ctrl+banana"), /Unknown key/);
    assert.throws(() => parseCombo("a+b"), /at most one non-modifier/);
    assert.throws(() => parseCombo("ctrl+alt+shift+win+a"), /At most 4/);
    for (const k of ["win+r", "Windows+R", "win+x", "win+l", "ctrl+alt+delete"]) assert.ok(isBlockedCombo(parseCombo(k)), k);
    assert.ok(!isBlockedCombo(parseCombo("ctrl+s")));
  });
  test("UIA output parser handles one element, many and empty", () => {
    assert.deepEqual(parseUia(""), []);
    assert.equal(parseUia('{"name":"OK","type":"Button","x":1,"y":2,"w":3,"h":4}').length, 1);
    assert.equal(parseUia('[{"name":"A"},{"name":"B"},{"nope":1}]').length, 2);
  });
});

describe("controller logic with a fake driver", () => {
  const fake = (over = {}) => {
    const log = [];
    const d = {
      log, size: { width: 2560, height: 1440 }, title: "Notes", pos: { x: 0, y: 0 },
      screenSize: async () => d.size, grab: async () => ({ width: 64, height: 40, rgba: Buffer.alloc(64 * 40 * 4, 128) }),
      cursor: async () => d.pos, move: async (x, y) => { log.push(["move", x, y]); d.pos = { x, y }; },
      click: async (x, y, o) => { log.push(["click", x, y, o]); d.pos = { x, y }; },
      drag: async () => {}, scroll: async () => {}, typeAscii: async (t) => log.push(["type", t]), pasteText: async (t) => log.push(["paste", t]),
      pressCombo: async (p) => log.push(["key", p]), releaseAll: async () => log.push(["release"]), windows: async () => [], activeWindowTitle: async () => d.title,
      focusWindow: async () => null, ...over,
    };
    return d;
  };
  const mk = (d) => new ComputerController({ driverLoader: async () => d, settleMs: 1 });

  test("view coordinates are scaled to real pixels and bounds are enforced", async () => {
    const d = fake(); const c = mk(d);
    const v = await c.view(); assert.equal(v.width, 1280); assert.equal(v.height, 720);
    const r = await c.move(640, 360); assert.deepEqual(d.pos, { x: 1280, y: 720 }); assert.ok(r.verified);
    await assert.rejects(c.move(1280, 10), /outside the screen view/);
    await assert.rejects(c.click(-1, 5), /outside the screen view/);
  });
  test("expectation decides the result: met vs not met", async () => {
    const d = fake(); const c = mk(d);
    const ok = await c.click(10, 10, { expect: { window_title_contains: "notes" } });
    assert.equal(ok.expectation_met, true);
    c.settleMs = 1;
    const miss = await Promise.race([c.click(10, 10, { expect: { window_title_contains: "Calculator" } }), new Promise((r) => setTimeout(() => r("slow"), 6000))]);
    assert.equal(miss.expectation_met, false);
  });
  test("refuses terminals, oversize text and blocked keys; non-ASCII goes through the clipboard", async () => {
    const d = fake({ title: "Windows PowerShell" }); const c = mk(d);
    await assert.rejects(c.type("rm -rf /"), /Refusing to type/);
    d.title = "Notes";
    await assert.rejects(c.type("x".repeat(2001)), /longer than 2000/);
    await assert.rejects(c.key("win+r"), /blocked/);
    assert.equal((await c.type("नमस्ते")).method, "clipboard-paste");
    assert.equal((await c.type("hello")).method, "keystrokes");
    assert.ok(d.log.some((l) => l[0] === "paste") && d.log.some((l) => l[0] === "type"));
    assert.ok(!d.log.some((l) => l[0] === "key"));
  });
  test("halt stops every action and releases held keys; reset resumes", async () => {
    const d = fake(); const c = mk(d);
    await c.halt();
    assert.ok(d.log.some((l) => l[0] === "release"));
    for (const f of [() => c.move(5, 5), () => c.click(5, 5), () => c.type("a"), () => c.key("enter"), () => c.screenshot()]) await assert.rejects(f(), /emergency stop/);
    assert.ok(!d.log.some((l) => l[0] === "click" || l[0] === "type"));
    c.reset(); await c.move(5, 5);
  });
});

describe("real OS input into a real browser window", { skip: !hasDisplay && "needs a display (xvfb-run -a npm test)" }, () => {
  before(async () => {
    controller = new ComputerController({ driverLoader: loadNutDriver });
    browser = await chromium.launch({ headless: false, args: ["--window-position=0,0", "--window-size=1100,760", "--no-sandbox"] });
    page = await browser.newPage({ viewport: null });
    await page.setContent(PAGE);
    await page.bringToFront();
    await new Promise((r) => setTimeout(r, 800));
  });
  after(async () => { await browser?.close(); });

  test("screenshot is a real, non-blank PNG at view scale", async () => {
    const s = await controller.screenshot();
    assert.equal(s.png.subarray(1, 4).toString(), "PNG");
    assert.ok(s.width <= 1280 && s.height > 0);
    const sharp = (await import("sharp")).default;
    const { channels } = await sharp(s.png).stats();
    assert.ok(channels.some((ch) => ch.stdev > 1), "screenshot looks blank");
  });

  test("mouse move is verified by reading the pointer back", async () => {
    const r = await controller.move(333, 222);
    assert.ok(r.verified, JSON.stringify(r)); assert.deepEqual(r.cursor, { x: 333, y: 222 });
  });

  test("click really presses the page button, and the screen-change expectation is met", async () => {
    const p = await center("#b");
    const r = await controller.click(p.x, p.y, { expect: { screen_changes: true } });
    assert.equal(r.expectation_met, true, JSON.stringify(r));
    assert.equal(await page.evaluate(() => document.getElementById("b").dataset.n), "1");
  });

  test("typing and key combos reach the focused input", async () => {
    const p = await center("#i");
    await controller.click(p.x, p.y);
    const t = await controller.type("hello world");
    assert.equal(t.method, "keystrokes");
    assert.equal(await page.inputValue("#i"), "hello world");
    await controller.key("ctrl+a"); await controller.key("backspace");
    assert.equal(await page.inputValue("#i"), "");
  });

  test("drag presses at one point and releases at another", async () => {
    const p = await center("#d");
    await page.evaluate(() => (window.ev.length = 0));
    await controller.drag({ x: p.x - 100, y: p.y }, { x: p.x + 100, y: p.y });
    const ev = await page.evaluate(() => window.ev);
    assert.equal(ev[0][0], "down"); assert.equal(ev.at(-1)[0], "up");
    assert.ok(ev.at(-1)[1] - ev[0][1] > 150, JSON.stringify(ev));
  });

  test("scroll moves the page", async () => {
    const p = await center("#d");
    await page.evaluate(() => scrollTo(0, 0));
    await controller.scroll("down", 5, p);
    assert.ok((await page.evaluate(() => scrollY)) > 0);
  });

  test("emergency stop blocks input; reset resumes", async () => {
    await controller.halt();
    await assert.rejects(controller.click(10, 10), /emergency stop/);
    controller.reset();
    await controller.move(20, 20);
  });
});

describe("through the orchestrator (permissions, approval, images, logging)", { skip: !hasDisplay && "needs a display" }, () => {
  let c;
  afterEach(() => c?.teardown());

  test("screenshot tool asks permission, then the image reaches the model as an attachment and is not stored", async () => {
    const prov = new ScriptedProvider([call("computer_screenshot"), text("I can see the screen.")]);
    c = await setup({ provider: prov });
    const { taskId } = await c.container.orchestrator.startTask("what is on my screen?");
    const p = await until(() => c.container.approvals.pending()[0]);
    assert.equal(p.tool, "computer_screenshot"); assert.ok(p.permissions.includes("computer.screen"));
    c.container.approvals.resolve(p.approval_id, true);
    await c.container.orchestrator.wait(taskId);
    const t = await Task.findById(taskId).lean();
    assert.equal(t.status, "completed"); assert.ok(t.steps[0].verified);
    assert.ok(!JSON.stringify(t).includes("base64"), "screenshot must not be persisted");
    const second = prov.calls[1].messages;
    assert.equal(second.at(-2).role, "tool");
    assert.ok(!second.at(-2).content.includes("base64"));
    const img = second.at(-1);
    assert.equal(img.role, "user"); assert.equal(img.images.length, 1); assert.equal(img.images[0].mime, "image/png");
  });

  test("declining a click means nothing is sent to the OS", async () => {
    const prov = new ScriptedProvider([call("computer_click", { x: 10, y: 10 }), text("Okay, I did not click.")]);
    c = await setup({ provider: prov });
    let clicked = false;
    const orig = c.container.computer.click.bind(c.container.computer);
    c.container.computer.click = async (...a) => { clicked = true; return orig(...a); };
    const { taskId } = await c.container.orchestrator.startTask("click there");
    const p = await until(() => c.container.approvals.pending()[0]);
    c.container.approvals.resolve(p.approval_id, false);
    await c.container.orchestrator.wait(taskId);
    assert.equal(clicked, false);
    assert.equal((await ActionLog.findOne({ tool: "computer_click" })).approved, false);
  });

  test("emergency stop mid-task halts the computer controller and cancels the task", async () => {
    const prov = new ScriptedProvider([call("computer_click", { x: 10, y: 10 }), text("never")]);
    c = await setup({ provider: prov });
    const { taskId } = await c.container.orchestrator.startTask("click");
    await until(() => c.container.approvals.pending()[0]);
    await c.container.orchestrator.emergencyStop();
    await c.container.orchestrator.wait(taskId);
    assert.equal((await Task.findById(taskId).lean()).status, "cancelled");
    assert.equal(c.container.computer.halted, true);
    const r = await runTool(c, "computer_click", { x: 5, y: 5 });
    assert.equal(r.ok, false); assert.match(r.error, /emergency stop/);
    const next = await c.container.orchestrator.startTask("next"); // a new task lifts the stop
    assert.equal(c.container.computer.halted, false);
    await c.container.orchestrator.wait(next.taskId);
  });

  test("a failed expectation is reported as a failure, never as success", async () => {
    c = await setup({ provider: new ScriptedProvider([]) });
    const r = await runTool(c, "computer_click", { x: 5, y: 5, expect: { window_title_contains: "NoSuchWindowTitle" } });
    // Linux has no active-window title, so the expectation cannot be met: must be ok=false, verified=false.
    assert.equal(r.ok, false); assert.equal(r.verified, false);
  });

  test("tool inputs are validated", async () => {
    c = await setup({ provider: new ScriptedProvider([]) });
    const tool = c.container.registry.get("computer_click");
    assert.match(c.container.registry.validateArgs(tool, { x: "a", y: 1 }), /Invalid arguments/);
    assert.match(c.container.registry.validateArgs(c.container.registry.get("computer_scroll"), { direction: "sideways", amount: 1 }), /Invalid arguments/);
  });
});
