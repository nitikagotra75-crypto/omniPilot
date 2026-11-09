import { useStore } from "../context/useStore";
import { Orb } from "./Orb";

const PAGES = [
  { id: "chat", label: "Assistant" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export function Sidebar() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const busy = useStore((s) => !!s.activeTaskId);
  const status = useStore((s) => s.status);
  const emergencyStop = useStore((s) => s.emergencyStop);
  const newChat = useStore((s) => s.newChat);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r-2 border-ink/20 bg-surface px-4 pb-4 pt-5">
      <div className="mb-6 flex items-center gap-3 px-1">
        <Orb size={38} busy={busy} />
        <span className="font-display text-xl">OmniPilot</span>
      </div>

      <button
        className="btn-primary mb-4 w-full"
        onClick={() => {
          newChat();
          setPage("chat");
        }}
      >
        New chat
      </button>

      <nav className="space-y-1">
        {PAGES.map((p) => (
          <button
            key={p.id}
            onClick={() => setPage(p.id)}
            className={`flex w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
              page === p.id ? "bg-lilac text-ink" : "text-ink-soft hover:bg-lilac/60 hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <button
          className="btn-danger w-full"
          onClick={() => void emergencyStop()}
          title="Cancel every running task and decline pending approvals"
        >
          Emergency stop
        </button>
        <p className="truncate px-1 text-xs text-ink-faint" title={status?.llm_configured ? `${status.provider} · ${status.model}` : ""}>
          {status?.llm_configured ? `${status.provider} · ${status.model}` : "No model set up"}
        </p>
      </div>
    </aside>
  );
}
