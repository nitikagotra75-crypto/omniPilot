// Exit when the desktop app that launched us is gone, so a crash never leaves an orphaned engine.
export function watchParent(pid, onGone = () => process.exit(0), intervalMs = 2000) {
  const alive = () => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  const t = setInterval(() => { if (!alive()) { clearInterval(t); onGone(); } }, intervalMs);
  return () => clearInterval(t);
}
