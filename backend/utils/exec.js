// Allowlisted command execution. Never uses a shell; arguments come from code, not from the model.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function findExecutable(names, env = process.env) {
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD").split(";") : [""];
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    for (const n of names) for (const e of exts) {
      const full = path.join(dir, n + (n.toLowerCase().endsWith(e.toLowerCase()) ? "" : e));
      try { if (fs.statSync(full).isFile()) return full; } catch { /* keep looking */ }
    }
  }
  return null;
}

export function run(file, args, { timeout = 60_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, signal, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }));
  });
}
