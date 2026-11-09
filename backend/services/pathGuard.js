// File-access boundaries. Every file tool resolves paths through PathGuard.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class PathNotAllowed extends Error {}

const ci = process.platform === "win32" || process.platform === "darwin";
const norm = (p) => (ci ? p.toLowerCase() : p);

// realpath of the deepest existing ancestor + the not-yet-existing remainder (symlink-safe for new files)
function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); }
    catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

export class PathGuard {
  #roots = [];
  constructor(roots) { this.setRoots(roots); }
  get roots() { return [...this.#roots]; }
  setRoots(roots) { this.#roots = roots.map((r) => realish(expand(r))); }

  resolve(p) {
    const resolved = realish(expand(p));
    for (const root of this.#roots) {
      const rel = path.relative(norm(root), norm(resolved));
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return resolved;
    }
    throw new PathNotAllowed(`Access to '${p}' is outside the folders OmniPilot is allowed to use. Allowed: ${this.#roots.join(", ")}`);
  }

  /** A sibling path that does not exist yet, so originals are never overwritten. */
  uniqueOutput(source, tag, newExt) {
    const { dir, name, ext } = path.parse(source);
    const e = newExt ?? ext;
    let candidate = path.join(dir, `${name}${tag}${e}`);
    for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${name}${tag}-${n}${e}`);
    return candidate;
  }
}

function expand(p) {
  return p === "~" || String(p).startsWith("~/") || String(p).startsWith("~\\") ? path.join(os.homedir(), String(p).slice(1)) : String(p);
}

export function defaultRoots(workspaceDir) {
  const h = os.homedir();
  return [workspaceDir, path.join(h, "Documents"), path.join(h, "Downloads"), path.join(h, "Desktop")];
}
