// Computer controller: safe, verifiable mouse/keyboard/screen operations on top of a driver.
// Coordinates exposed to the model are in "view space": the screen scaled so its long side is at most MAX_VIEW.
import sharp from "sharp";
import { isBlockedCombo, parseCombo } from "./keys.js";

export const MAX_VIEW = 1280;
const SIG_W = 64, SIG_H = 40;
const SHELL_TITLE = /powershell|command prompt|cmd\.exe|windows terminal|\bterminal\b|\bbash\b|\bzsh\b|\bconsole\b|^run$/i;
const NON_ASCII = /[^\x20-\x7e\n\t]/;
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

export class ComputerHalted extends Error { constructor() { super("Computer control is stopped (emergency stop). It resumes with the next task."); this.name = "ComputerHalted"; } }
export class ComputerRefused extends Error { constructor(m) { super(m); this.name = "ComputerRefused"; } }

export class ComputerController {
  #halted = false;

  /** @param driverLoader async () => driver; resolved lazily on first use. */
  constructor({ driverLoader, settleMs = 400 }) { this.driverLoader = driverLoader; this.settleMs = settleMs; this._driver = null; }

  async driver() { return (this._driver ||= await this.driverLoader()); }

  // ---- kill switch ----
  async halt() { this.#halted = true; try { await (await this.driver()).releaseAll(); } catch { /* nothing to release */ } }
  markHalted() { this.#halted = true; }
  reset() { this.#halted = false; }
  get halted() { return this.#halted; }
  #check(signal) { if (this.#halted) throw new ComputerHalted(); signal?.throwIfAborted(); }

  // ---- geometry ----
  async view() {
    const d = await this.driver();
    const s = await d.screenSize();
    const scale = Math.min(1, MAX_VIEW / Math.max(s.width, s.height));
    return { screen: s, scale, width: Math.round(s.width * scale), height: Math.round(s.height * scale) };
  }
  toScreen(v, x, y) {
    if (![x, y].every(Number.isFinite)) throw new ComputerRefused("Coordinates must be numbers.");
    if (x < 0 || y < 0 || x >= v.width || y >= v.height) throw new ComputerRefused(`Point (${x}, ${y}) is outside the screen view of ${v.width}x${v.height}.`);
    return { x: Math.round(x / v.scale), y: Math.round(y / v.scale) };
  }
  toView(v, x, y) { return { x: Math.round(x * v.scale), y: Math.round(y * v.scale) }; }

  // ---- observation ----
  async #pixels(signal) { this.#check(signal); return (await this.driver()).grab(); }
  async #signature(signal) {
    const g = await this.#pixels(signal);
    const { data } = await sharp(g.rgba, { raw: { width: g.width, height: g.height, channels: 4 } }).removeAlpha().greyscale().resize(SIG_W, SIG_H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    return data;
  }
  static changedFraction(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 12) n++;
    return n / a.length;
  }

  /** PNG of the screen at view scale, plus context. */
  async screenshot(signal) {
    const v = await this.view();
    const g = await this.#pixels(signal);
    const png = await sharp(g.rgba, { raw: { width: g.width, height: g.height, channels: 4 } }).resize(v.width, v.height).png().toBuffer();
    const d = await this.driver();
    const c = await d.cursor();
    return { png, width: v.width, height: v.height, scale: v.scale, screen: v.screen, cursor: this.toView(v, c.x, c.y), active_window: await d.activeWindowTitle() };
  }

  async listWindows(signal) {
    this.#check(signal);
    const d = await this.driver(); const v = await this.view();
    return (await d.windows()).filter((w) => w.title).map((w) => ({
      title: w.title, ...(w.region ? { x: Math.round(w.region.left * v.scale), y: Math.round(w.region.top * v.scale), width: Math.round(w.region.width * v.scale), height: Math.round(w.region.height * v.scale) } : {}),
    }));
  }

  // ---- actions (each returns observations; verification is decided by the caller via `expect`) ----
  /** Runs `act`, then observes the screen/window and checks `expect` ({window_title_contains, screen_changes}). */
  async #observed(act, expect, signal) {
    const d = await this.driver();
    const before = await this.#signature(signal);
    const titleBefore = await d.activeWindowTitle();
    await act();
    const result = { screen_changed: false, changed_fraction: 0, active_window_before: titleBefore, active_window: titleBefore, expectation: null, expectation_met: null };
    const deadline = Date.now() + (expect ? 3000 : 0);
    do {
      await sleep(this.settleMs, signal);
      const after = await this.#signature(signal);
      result.changed_fraction = Number(ComputerController.changedFraction(before, after).toFixed(4));
      result.screen_changed = result.changed_fraction > 0.003;
      result.active_window = await d.activeWindowTitle();
      if (!expect) break;
      const checks = [];
      if (expect.window_title_contains) checks.push((result.active_window || "").toLowerCase().includes(expect.window_title_contains.toLowerCase()));
      if (expect.screen_changes) checks.push(result.screen_changed);
      result.expectation = expect;
      result.expectation_met = checks.length > 0 && checks.every(Boolean);
      if (result.expectation_met) break;
    } while (Date.now() < deadline);
    return result;
  }

  async move(x, y, signal) {
    const v = await this.view(); const p = this.toScreen(v, x, y); this.#check(signal);
    const d = await this.driver();
    await d.move(p.x, p.y);
    await sleep(60, signal);
    const c = await d.cursor();
    const off = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
    return { requested: { x, y }, cursor: this.toView(v, c.x, c.y), verified: off <= 2, offset_px: off };
  }

  async click(x, y, { button = "left", double = false, expect } = {}, signal) {
    const v = await this.view(); const p = this.toScreen(v, x, y); this.#check(signal);
    const d = await this.driver();
    const obs = await this.#observed(() => d.click(p.x, p.y, { button, double }), expect, signal);
    const c = await d.cursor();
    return { ...obs, cursor_landed: Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= 2 };
  }

  async drag(from, to, { expect } = {}, signal) {
    const v = await this.view(); const a = this.toScreen(v, from.x, from.y); const b = this.toScreen(v, to.x, to.y); this.#check(signal);
    const d = await this.driver();
    return this.#observed(() => d.drag(a, b), expect, signal);
  }

  async scroll(direction, amount, at, { expect } = {}, signal) {
    const v = await this.view(); this.#check(signal);
    const d = await this.driver();
    const p = at ? this.toScreen(v, at.x, at.y) : null;
    return this.#observed(async () => { if (p) await d.move(p.x, p.y); await d.scroll(direction, amount); }, expect, signal);
  }

  async #guardTyping(signal) {
    const d = await this.driver();
    const title = await d.activeWindowTitle();
    if (title && SHELL_TITLE.test(title)) throw new ComputerRefused(`Refusing to type into '${title}': typing into a terminal or Run box would execute commands. Use a dedicated tool instead.`);
    return title;
  }

  async type(text, { expect } = {}, signal) {
    if (typeof text !== "string" || !text.length) throw new ComputerRefused("Nothing to type.");
    if (text.length > 2000) throw new ComputerRefused("Text is longer than 2000 characters; type it in smaller parts or write it to a file.");
    this.#check(signal);
    const title = await this.#guardTyping(signal);
    const d = await this.driver();
    const obs = await this.#observed(async () => { if (NON_ASCII.test(text)) await d.pasteText(text); else await d.typeAscii(text); }, expect, signal);
    return { ...obs, typed_chars: text.length, method: NON_ASCII.test(text) ? "clipboard-paste" : "keystrokes", target_window: title };
  }

  async key(combo, { expect } = {}, signal) {
    const parts = parseCombo(combo); this.#check(signal);
    if (isBlockedCombo(parts)) throw new ComputerRefused(`The key combination '${combo}' is blocked for safety (it opens a command box, locks the PC or signs out).`);
    const d = await this.driver();
    return this.#observed(() => d.pressCombo(parts), expect, signal);
  }

  async focusWindow(title, signal) {
    this.#check(signal);
    const d = await this.driver();
    const found = await d.focusWindow(title);
    if (!found) return { found: false };
    for (let i = 0; i < 10; i++) {
      await sleep(250, signal);
      const now = await d.activeWindowTitle();
      if (now && now.toLowerCase().includes(title.toLowerCase())) return { found: true, title: found, active_window: now, focused: true };
    }
    return { found: true, title: found, active_window: await d.activeWindowTitle(), focused: false };
  }

  async waitFor({ ms = 1000, window_title_contains, timeout_ms = 10000 } = {}, signal) {
    const d = await this.driver();
    if (!window_title_contains) { await sleep(Math.min(ms, 10000), signal); this.#check(signal); return { waited_ms: Math.min(ms, 10000), met: null }; }
    const t0 = Date.now();
    while (Date.now() - t0 < Math.min(timeout_ms, 30000)) {
      this.#check(signal);
      const title = await d.activeWindowTitle();
      if (title && title.toLowerCase().includes(window_title_contains.toLowerCase())) return { waited_ms: Date.now() - t0, met: true, active_window: title };
      await sleep(300, signal);
    }
    return { waited_ms: Date.now() - t0, met: false, active_window: await d.activeWindowTitle() };
  }
}
