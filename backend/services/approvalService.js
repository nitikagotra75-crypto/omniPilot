import crypto from "node:crypto";

/** Asks the user to confirm an action and waits for the answer. */
export class ApprovalService {
  #pending = new Map();
  constructor(bus) { this.bus = bus; }
  pending() { return [...this.#pending.values()].map((p) => p.meta); }

  request(taskId, tool, summary, permissions) {
    const approvalId = crypto.randomUUID().replaceAll("-", "");
    const meta = { approval_id: approvalId, task_id: String(taskId), tool, summary, permissions };
    return new Promise((resolve) => {
      this.#pending.set(approvalId, { meta, resolve });
      this.bus.publish("approval.requested", meta);
    }).finally(() => this.#pending.delete(approvalId));
  }
  resolve(approvalId, approved) {
    const p = this.#pending.get(approvalId);
    if (!p) return false;
    p.resolve(!!approved);
    return true;
  }
  denyAll() { for (const p of this.#pending.values()) p.resolve(false); }
  denyTask(taskId) { for (const p of this.#pending.values()) if (p.meta.task_id === String(taskId)) p.resolve(false); }
}
