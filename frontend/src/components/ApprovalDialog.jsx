import { useStore } from "../context/useStore";

const RISK = {
  "fs.delete": "Deletes data",
  publish: "Publishes externally",
  finance: "Financial action",
  "app.launch": "Opens an application",
  "computer.input": "Controls mouse and keyboard",
  "computer.screen": "Looks at your screen",
  "code.execute": "Runs code",
  "system.control": "Changes system state",
  "browser.use": "Uses the web browser",
  "memory.write": "Saves to memory",
};

export function ApprovalDialog() {
  const approvals = useStore((s) => s.approvals);
  const answer = useStore((s) => s.answerApproval);
  const current = approvals[0];
  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 animate-rise"
      role="dialog"
      aria-modal="true"
      aria-label="Approval needed"
    >
      <div className="card w-[min(460px,92vw)] border-ink bg-surface p-6 shadow-pop">
        <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">Approval needed</p>
        <h2 className="mt-2 text-lg font-semibold leading-snug">{current.summary}</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {current.permissions.map((p) => (
            <span key={p} className="chip bg-lilac">
              {RISK[p] ?? p}
            </span>
          ))}
        </div>
        {approvals.length > 1 && <p className="mt-3 text-xs text-ink-faint">{approvals.length - 1} more waiting.</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-outline" onClick={() => answer(current.approval_id, false)}>
            Decline
          </button>
          <button className="btn-primary" autoFocus onClick={() => answer(current.approval_id, true)}>
            Allow once
          </button>
        </div>
      </div>
    </div>
  );
}
