// Application launching from a fixed allowlist (success is claimed only after observing the process) and opening documents.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import psList from "ps-list";
import { findExecutable } from "../utils/exec.js";
import { PathNotAllowed } from "../services/pathGuard.js";
import { fail, ok, unverified } from "./registry.js";

// name -> per-platform launch command and process names that prove it is running.
export const APP_ALLOWLIST = {
  notepad: { win32: ["notepad.exe"], procs: ["notepad.exe"] },
  calculator: { win32: ["calc.exe"], linux: ["gnome-calculator"], darwin: ["open", "-a", "Calculator"], procs: ["calculator.exe", "calculatorapp.exe", "calc.exe", "gnome-calculator", "calculator"] },
  vscode: { win32: ["code"], linux: ["code"], darwin: ["open", "-a", "Visual Studio Code"], procs: ["code.exe", "code", "visual studio code"] },
  chrome: { win32: ["chrome"], linux: ["google-chrome"], darwin: ["open", "-a", "Google Chrome"], procs: ["chrome.exe", "chrome", "google chrome"] },
  edge: { win32: ["msedge"], procs: ["msedge.exe"] },
  firefox: { win32: ["firefox"], linux: ["firefox"], darwin: ["open", "-a", "Firefox"], procs: ["firefox.exe", "firefox"] },
  explorer: { win32: ["explorer.exe"], procs: ["explorer.exe"] },
  terminal: { win32: ["wt.exe"], linux: ["x-terminal-emulator"], darwin: ["open", "-a", "Terminal"], procs: ["windowsterminal.exe", "wt.exe", "terminal", "x-terminal-emulator"] },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = async (procs) => {
  const want = new Set(procs.map((p) => p.toLowerCase()));
  return (await psList()).filter((p) => want.has(p.name.toLowerCase())).map((p) => p.pid);
};

export const appTools = [{
  name: "open_application", category: "computer", permissions: ["app.launch"], timeout: 20,
  description: `Open an application from the allowed list: ${Object.keys(APP_ALLOWLIST).sort().join(", ")}. Verifies the process is actually running.`,
  inputSchema: { type: "object", properties: { app: { type: "string", enum: Object.keys(APP_ALLOWLIST).sort() } }, required: ["app"], additionalProperties: false },
  summarize: (a) => `Open the application '${a.app}'`,
  handler: async (a, ctx, { platform = process.platform, allowlist = APP_ALLOWLIST } = {}) => {
    const entry = allowlist[a.app.trim().toLowerCase()];
    if (!entry) return fail(`'${a.app}' is not in the allowed application list.`);
    const cmd = entry[platform === "win32" || platform === "darwin" ? platform : "linux"];
    if (!cmd) return fail(`'${a.app}' has no launch definition for this operating system.`);
    // On Windows, bare names (code, chrome, msedge...) are resolved by `start`, which needs cmd.exe; the name is a constant from the allowlist.
    const winShell = platform === "win32" && !cmd[0].toLowerCase().endsWith(".exe");
    if (!winShell && platform !== "win32" && !findExecutable([cmd[0]])) return fail(`Could not find '${cmd[0]}' on this computer. Is ${a.app} installed?`);
    const before = new Set(await running(entry.procs));
    try {
      const [file, args] = winShell ? ["cmd.exe", ["/c", "start", "", ...cmd]] : [cmd[0], cmd.slice(1)];
      const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
      child.on("error", () => {}); child.unref();
    } catch (e) { return fail(`Launch failed: ${e.message}`); }
    for (let i = 0; i < 20; i++) {
      await sleep(500); ctx.signal?.throwIfAborted();
      const now = await running(entry.procs);
      if (now.length) {
        const fresh = now.filter((p) => !before.has(p));
        return ok({ app: a.app, pids: now, already_running: before.size > 0 && fresh.length === 0 },
          fresh.length ? "Observed a matching running process after launch." : "A matching process is running (it may have been open already).");
      }
    }
    return fail(`Launched '${a.app}' but could not observe it running within 10 seconds, so I can't confirm it opened.`, { recoverable: true });
  },
}];

// Files that run code are never opened by this tool, only documents, images, media and folders.
const RUNNABLE = new Set([
  ".exe", ".com", ".bat", ".cmd", ".msi", ".msp", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".scr",
  ".lnk", ".url", ".reg", ".jar", ".cpl", ".msc", ".dll", ".sh", ".appref-ms", ".py",
]);
const OPENERS = { win32: "explorer.exe", darwin: "open", linux: "xdg-open" };

appTools.push({
  name: "open_file", category: "computer", permissions: ["app.launch"], timeout: 15,
  description: "Open a file (photo, PDF, document, video...) or a folder with its default app, as if the user double-clicked it. The path must be inside the allowed folders (Downloads, Documents, Desktop...). Use find_files first if you only know part of the name. Programs and scripts are refused.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "Absolute or ~ path of the file or folder." } }, required: ["path"], additionalProperties: false },
  summarize: (a) => `Open ${a.path} with its default app`,
  handler: async (a, ctx, { platform = process.platform, spawnFn = spawn } = {}) => {
    let target;
    try { target = ctx.guard.resolve(a.path); }
    catch (e) { if (e instanceof PathNotAllowed) return fail(e.message); throw e; }
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) return fail(`Not found: ${target}`, { recoverable: true });
    if (stat.isFile() && RUNNABLE.has(path.extname(target).toLowerCase())) return fail(`'${path.basename(target)}' is a program or script, and this tool only opens documents, media and folders.`);
    const opener = OPENERS[platform] ?? OPENERS.linux;
    // The path is one argument to the opener, never part of a shell command line.
    const started = await new Promise((resolve) => {
      const child = spawnFn(opener, [target], { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", (e) => resolve(e));
      child.once("spawn", () => resolve(null));
      child.unref?.();
    });
    if (started) return fail(`Could not start ${opener}: ${started.message}`);
    // The OS gives no confirmation that a window appeared, so this is honest about not having verified it.
    return unverified({ path: target, kind: stat.isDirectory() ? "folder" : "file" }, "Asked the operating system to open it. Whether a window appeared was not checked; take a screenshot to confirm.");
  },
});
