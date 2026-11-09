import { useEffect, useState } from "react";
import { get } from "../services/api";
const BADGE = {
  completed: "bg-mint-500/15 text-mint-400",
  failed: "bg-rose-400/15 text-rose-400",
  cancelled: "bg-line text-ink-soft",
  running: "bg-pink-400/15 text-pink-600",
};
export function HistoryPage() {
  const [tasks, setTasks] = useState([]);
  const [log, setLog] = useState([]);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("tasks");
  useEffect(() => {
    void get("/tasks")
      .then(setTasks)
      .catch(() => undefined);
    void get("/action-log")
      .then(setLog)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (open)
      void get(`/tasks/${open}`)
        .then(setDetail)
        .catch(() => undefined);
    else setDetail(null);
  }, [open]);
  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl text-ink">History</h1>
        <div className="mt-5 flex gap-1 rounded-lg bg-blush p-1 w-fit">
          {["tasks", "actions"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm capitalize ${tab === t ? "bg-line text-ink" : "text-ink-soft"}`}
            >
              {t === "tasks" ? "Tasks" : "Action log"}
            </button>
          ))}
        </div>

        {tab === "tasks" && (
          <div className="mt-6 space-y-2">
            {tasks.length === 0 && <p className="text-ink-faint">No tasks yet.</p>}
            {tasks.map((t) => (
              <div key={t.id} className="card">
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <span className={`rounded px-2 py-0.5 text-[11px] ${BADGE[t.status] ?? ""}`}>{t.status}</span>
                  <span className="flex-1 truncate text-sm text-ink">{t.request}</span>
                  <span className="text-xs text-ink-faint">{new Date(t.created_at * 1000).toLocaleString()}</span>
                </button>
                {open === t.id && detail?.id === t.id && (
                  <div className="space-y-2 border-t border-lilac px-4 py-3 text-sm animate-rise">
                    {(detail.steps ?? []).map((s) => (
                      <div key={s.idx} className="flex items-center gap-2 text-ink-soft">
                        <span className={`h-2 w-2 rounded-full ${!s.ok ? "bg-rose-400" : s.verified ? "bg-mint-400" : "bg-ink-faint"}`} />
                        <code>{s.tool}</code>
                        <span className="text-xs text-ink-faint">{!s.ok ? "failed" : s.verified ? "verified" : "unverified"}</span>
                      </div>
                    ))}
                    {detail.result && <p className="whitespace-pre-wrap text-ink">{detail.result}</p>}
                    {detail.error && <p className="text-rose-400">{detail.error}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "actions" && (
          <div className="mt-6 divide-y divide-lilac rounded-2xl border border-lilac">
            {log.length === 0 && <p className="p-4 text-ink-faint">No actions recorded.</p>}
            {log.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${l.approved === 0 ? "bg-rose-400/15 text-rose-400" : "bg-mint-500/15 text-mint-400"}`}
                >
                  {l.approved === 0 ? "blocked" : "allowed"}
                </span>
                <span className="flex-1 truncate text-ink" title={l.summary}>
                  {l.summary}
                </span>
                <span className="text-xs text-ink-faint">{new Date(l.at * 1000).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
