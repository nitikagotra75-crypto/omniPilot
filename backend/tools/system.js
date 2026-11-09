import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import psList from "ps-list";
import { ok } from "./registry.js";

const none = { type: "object", properties: {}, additionalProperties: false };
const cpuTimes = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return [a[0] + t, a[1] + c.times.idle]; }, [0, 0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const systemTools = [
  { name: "system_info", category: "system", permissions: ["system.read"], timeout: 10, inputSchema: none,
    description: "Get OS, CPU and memory information for this computer.",
    handler: async () => {
      const [t0, i0] = cpuTimes(); await sleep(300); const [t1, i1] = cpuTimes();
      const total = os.totalmem(), free = os.freemem();
      return ok({
        os: `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`, cpu_count: os.cpus().length,
        cpu_percent: t1 > t0 ? +((1 - (i1 - i0) / (t1 - t0)) * 100).toFixed(1) : 0,
        memory_total_gb: +(total / 1e9).toFixed(2), memory_used_percent: +(((total - free) / total) * 100).toFixed(1),
      }, "Values read directly from the OS.");
    } },
  { name: "disk_usage", category: "system", permissions: ["system.read", "fs.read"], timeout: 10,
    description: "Report total/used/free disk space for a folder inside the allowed folders.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    handler: async (a, ctx) => {
      const p = ctx.guard.resolve(a.path || ctx.config.workspaceDir);
      const s = await fs.promises.statfs(p);
      const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
      return ok({ path: p, total_gb: +(total / 1e9).toFixed(2), used_gb: +((total - free) / 1e9).toFixed(2), free_gb: +(free / 1e9).toFixed(2) }, "Values read directly from the OS.");
    } },
  { name: "top_processes", category: "system", permissions: ["system.read"], timeout: 15,
    description: "List running processes (largest memory users first where the OS reports it). Read-only; does not stop anything.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    handler: async (a) => {
      const list = (await psList()).map((p) => ({ pid: p.pid, name: p.name, memory: p.memory ?? null }));
      list.sort((x, y) => (y.memory ?? -1) - (x.memory ?? -1) || x.pid - y.pid);
      return ok({ processes: list.slice(0, a.limit ?? 10) }, "Read from the OS process table.");
    } },
  { name: "network_check", category: "system", permissions: ["network"], timeout: 8,
    description: "Check whether the internet (or a given host:port) is reachable.",
    inputSchema: { type: "object", properties: { host: { type: "string" }, port: { type: "integer" } }, additionalProperties: false },
    handler: async (a) => {
      const host = a.host || "1.1.1.1", port = a.port || 53;
      const reachable = await new Promise((resolve) => {
        const s = net.connect({ host, port, timeout: 3000 });
        s.once("connect", () => { s.destroy(); resolve({ reachable: true }); });
        s.once("timeout", () => { s.destroy(); resolve({ reachable: false, reason: "timed out" }); });
        s.once("error", (e) => resolve({ reachable: false, reason: e.code || e.message }));
      });
      return ok({ host, port, ...reachable }, "TCP connection attempt completed.");
    } },
];
