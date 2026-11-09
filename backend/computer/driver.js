// Low-level OS input/screen driver built on nut-js (the same JavaScript code on Windows, macOS and Linux/X11).
// Loaded lazily so the rest of the backend still starts if the native library is unavailable.
import { toNutKeys } from "./keys.js";

export class ComputerUnavailable extends Error {
  constructor(message) { super(message); this.name = "ComputerUnavailable"; }
}

export async function loadNutDriver() {
  let nut;
  try { nut = await import("@nut-tree-fork/nut-js"); }
  catch (e) { throw new ComputerUnavailable(`Computer control library could not be loaded: ${e.message}`); }
  return new NutDriver(nut);
}

export class NutDriver {
  constructor(nut, platform = process.platform) {
    this.nut = nut;
    this.platform = platform;
    nut.mouse.config.autoDelayMs = 30;
    nut.keyboard.config.autoDelayMs = 15;
  }

  async screenSize() { return { width: await this.nut.screen.width(), height: await this.nut.screen.height() }; }

  /** Raw RGBA pixels of the whole screen. */
  async grab() {
    const img = await this.nut.screen.grab();
    const rgba = Buffer.from(img.data);
    // nut returns BGRA on every platform it supports; swap to RGBA.
    for (let i = 0; i < rgba.length; i += 4) { const b = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = b; rgba[i + 3] = 255; }
    return { width: img.width, height: img.height, rgba };
  }

  async cursor() { const p = await this.nut.mouse.getPosition(); return { x: p.x, y: p.y }; }
  async move(x, y) { await this.nut.mouse.setPosition(new this.nut.Point(x, y)); }

  async click(x, y, { button = "left", double = false } = {}) {
    const { mouse, Button } = this.nut;
    await this.move(x, y);
    const b = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE }[button];
    if (b === undefined) throw new Error(`Unknown mouse button '${button}'.`);
    if (double) await mouse.doubleClick(b); else await mouse.click(b);
  }

  async drag(from, to) {
    const { mouse, Button, Point } = this.nut;
    await this.move(from.x, from.y);
    await mouse.pressButton(Button.LEFT);
    try {
      const steps = 12;
      for (let i = 1; i <= steps; i++) await mouse.setPosition(new Point(Math.round(from.x + ((to.x - from.x) * i) / steps), Math.round(from.y + ((to.y - from.y) * i) / steps)));
    } finally { await mouse.releaseButton(Button.LEFT); }
  }

  async scroll(direction, amount) {
    const m = this.nut.mouse;
    await { up: m.scrollUp, down: m.scrollDown, left: m.scrollLeft, right: m.scrollRight }[direction].call(m, amount);
  }

  async typeAscii(text) { await this.nut.keyboard.type(text); }

  /** Types any Unicode text via the clipboard (nut's key typing only covers keys on the layout). Restores the old clipboard. */
  async pasteText(text) {
    const { clipboard, keyboard, Key } = this.nut;
    let previous = null;
    try { previous = await clipboard.getContent(); } catch { /* clipboard may hold non-text */ }
    await clipboard.setContent(text);
    const mod = this.platform === "darwin" ? Key.LeftSuper : Key.LeftControl;
    await keyboard.pressKey(mod, Key.V); await keyboard.releaseKey(mod, Key.V);
    await new Promise((r) => setTimeout(r, 150));
    if (previous !== null) { try { await clipboard.setContent(previous); } catch { /* best effort */ } }
  }

  async pressCombo(parts) {
    const keys = toNutKeys(parts, this.nut.Key);
    try { await this.nut.keyboard.pressKey(...keys); } finally { await this.nut.keyboard.releaseKey(...keys.slice().reverse()); }
  }

  async releaseAll() {
    const { keyboard, mouse, Key, Button } = this.nut;
    for (const k of [Key.LeftControl, Key.LeftAlt, Key.LeftShift, Key.LeftWin]) { try { await keyboard.releaseKey(k); } catch { /* ignore */ } }
    for (const b of [Button.LEFT, Button.RIGHT, Button.MIDDLE]) { try { await mouse.releaseButton(b); } catch { /* ignore */ } }
  }

  /** Window titles. Linux/X11 without a window manager has none, and nut's active-window call aborts the process there. */
  async windows() {
    const out = [];
    for (const w of await this.nut.getWindows()) {
      try { out.push({ title: await w.title, region: await w.region }); } catch { /* window vanished */ }
    }
    return out;
  }
  async activeWindowTitle() {
    if (this.platform === "linux") return null;
    try { return await (await this.nut.getActiveWindow()).title; } catch { return null; }
  }
  async focusWindow(title) {
    if (this.platform === "linux") throw new Error("Focusing windows by title is not supported on Linux in this build.");
    const needle = title.toLowerCase();
    for (const w of await this.nut.getWindows()) {
      const t = await w.title;
      if (t && t.toLowerCase().includes(needle)) { await w.focus(); return t; }
    }
    return null;
  }
}
