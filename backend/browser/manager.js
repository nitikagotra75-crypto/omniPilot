// Browser session manager (Playwright). One persistent context per named profile (isolated cookies/sessions).
// Every request, including redirects and subresources, passes the URL policy.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { checkUrl, UrlBlocked } from "./urlPolicy.js";

const PROFILE_RE = /^[A-Za-z0-9_-]{1,40}$/;

export class BrowserManager {
  #contexts = new Map(); #active = new Map(); #mode = new Map(); #launching = new Map();

  constructor({ profilesDir, headless = true, allowLocal = false, searchUrl = "https://html.duckduckgo.com/html/?q={q}" }) {
    Object.assign(this, { profilesDir, headless, allowLocal, searchUrl });
  }

  static validateProfile(name) {
    if (!PROFILE_RE.test(name)) throw new Error("Profile names may only contain letters, numbers, '-' and '_'.");
    return name;
  }

  async #context(profile) {
    BrowserManager.validateProfile(profile);
    const existing = this.#contexts.get(profile);
    if (existing) return existing;
    if (!this.#launching.has(profile)) {
      this.#launching.set(profile, (async () => {
        const dir = path.join(this.profilesDir, profile);
        fs.mkdirSync(dir, { recursive: true });
        const ctx = await chromium.launchPersistentContext(dir, {
          headless: this.#mode.get(profile) ?? this.headless, acceptDownloads: false,
          viewport: { width: 1280, height: 800 }, args: ["--disable-dev-shm-usage"],
        });
        ctx.setDefaultTimeout(20_000);
        ctx.setDefaultNavigationTimeout(30_000);
        await ctx.route("**/*", async (route) => {
          try { await checkUrl(route.request().url(), { allowLocal: this.allowLocal }); }
          catch (e) { if (e instanceof UrlBlocked) return route.abort("blockedbyclient"); }
          return route.continue();
        });
        ctx.on("close", () => { if (this.#contexts.get(profile) === ctx) this.#contexts.delete(profile); });
        this.#contexts.set(profile, ctx);
        return ctx;
      })().finally(() => this.#launching.delete(profile)));
    }
    return this.#launching.get(profile);
  }

  /** Active page. With create=false and nothing opened yet, throws instead of inventing a blank page. */
  async page(profile = "default", { create = true } = {}) {
    const ctx = await this.#context(profile);
    const cur = this.#active.get(profile);
    if (cur && !cur.isClosed()) return cur;
    const pages = ctx.pages().filter((p) => !p.isClosed());
    if (pages.length) this.#active.set(profile, pages.at(-1));
    else if (create) this.#active.set(profile, await ctx.newPage());
    else throw new Error("No page is open. Open a website first.");
    return this.#active.get(profile);
  }
  async openPage(profile = "default") {
    const page = await this.page(profile);
    if (page.url() === "about:blank") throw new Error("No page is open. Open a website first.");
    return page;
  }
  async newTab(profile = "default") { const p = await (await this.#context(profile)).newPage(); this.#active.set(profile, p); return p; }
  async tabs(profile = "default") { return (await this.#context(profile)).pages().filter((p) => !p.isClosed()); }
  setActive(profile, page) { this.#active.set(profile, page); }

  isVisible(profile = "default") { return !(this.#mode.get(profile) ?? this.headless); }

  /** Relaunch with or without a window, reopening tabs. Saved cookies survive; session-only cookies do not. */
  async setVisible(profile, visible) {
    if (this.isVisible(profile) === visible && this.#contexts.has(profile)) return;
    const old = this.#contexts.get(profile);
    let urls = [], activeUrl = null;
    if (old) {
      urls = old.pages().filter((p) => !p.isClosed() && p.url() !== "about:blank").map((p) => p.url());
      const cur = this.#active.get(profile);
      activeUrl = cur && !cur.isClosed() ? cur.url() : null;
      await this.closeProfile(profile);
    }
    this.#mode.set(profile, !visible);
    const first = await this.page(profile);
    for (let i = 0; i < urls.length; i++) {
      const tab = i === 0 ? first : await this.newTab(profile);
      try { await tab.goto(urls[i], { waitUntil: "domcontentloaded" }); } catch { /* keep going */ }
    }
    if (activeUrl) for (const t of await this.tabs(profile)) if (t.url() === activeUrl) this.setActive(profile, t);
    if (visible) await (await this.page(profile)).bringToFront();
  }

  async closeProfile(profile) {
    const ctx = this.#contexts.get(profile);
    this.#contexts.delete(profile); this.#active.delete(profile);
    if (ctx) await ctx.close();
  }
  async close() { for (const p of [...this.#contexts.keys()]) { try { await this.closeProfile(p); } catch { /* shutting down */ } } }
}
