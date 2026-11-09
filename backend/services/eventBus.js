// Fan-out of task events. The Socket.IO layer subscribes; tests can subscribe too.
export class EventBus {
  #subs = new Set();
  subscribe(fn) { this.#subs.add(fn); return () => this.#subs.delete(fn); }
  publish(type, payload = {}) {
    const event = { type, ...payload };
    for (const fn of [...this.#subs]) {
      try { fn(event); } catch { /* a bad subscriber must not break the agent */ }
    }
  }
}
