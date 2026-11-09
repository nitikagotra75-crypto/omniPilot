import { PermissionGrant } from "../models/index.js";

export const PERMISSIONS = [
  "app.launch", "fs.read", "fs.write", "fs.delete", "system.read", "system.control", "browser.use",
  "computer.input", "computer.screen", "network", "code.execute", "publish", "finance", "memory.write",
];
// Never blanket-allowable: each action needs an explicit confirmation.
export const ALWAYS_CONFIRM = new Set(["fs.delete", "publish", "finance"]);
const DEFAULTS = {
  "fs.read": "allow", "fs.write": "allow", "system.read": "allow", network: "allow",
  "app.launch": "ask", "system.control": "ask", "browser.use": "ask", "computer.input": "ask",
  "computer.screen": "ask", "code.execute": "ask", "fs.delete": "ask", publish: "ask", finance: "ask", "memory.write": "ask",
};

export class PermissionService {
  async grants() {
    const out = { ...DEFAULTS };
    for (const g of await PermissionGrant.find().lean()) out[g.permission] = g.mode;
    for (const p of ALWAYS_CONFIRM) if (out[p] !== "deny") out[p] = "ask";
    return out;
  }
  async setGrant(permission, mode) {
    if (!PERMISSIONS.includes(permission)) throw new Error(`Unknown permission: ${permission}`);
    if (!["allow", "ask", "deny"].includes(mode)) throw new Error("mode must be allow, ask or deny");
    if (ALWAYS_CONFIRM.has(permission) && mode === "allow") throw new Error(`'${permission}' always requires confirmation and cannot be set to allow.`);
    await PermissionGrant.updateOne({ permission }, { $set: { mode } }, { upsert: true });
  }
  /** Strictest of the required permissions: 'allow' | 'ask' | 'deny'. */
  async decide(required) {
    const grants = await this.grants();
    let result = "allow";
    for (const p of required) {
      let g = grants[p] ?? "ask";
      if (ALWAYS_CONFIRM.has(p) && g !== "deny") g = "ask";
      if (g === "deny") return "deny";
      if (g === "ask") result = "ask";
    }
    return result;
  }
}
