import { useEffect, useState } from "react";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { ChatView } from "./components/ChatView";
import { Orb } from "./components/Orb";
import { Sidebar } from "./components/Sidebar";
import { useStore } from "./context/useStore";
import { HistoryPage } from "./pages/History";
import { SettingsPage } from "./pages/Settings";
import { connectEvents, loadConfig } from "./services/api";

export default function App() {
  const page = useStore((s) => s.page);
  const handleEvent = useStore((s) => s.handleEvent);
  const refreshStatus = useStore((s) => s.refreshStatus);
  const hydrateApprovals = useStore((s) => s.hydrateApprovals);
  const setWs = useStore((s) => s.setWs);
  const [connection, setConnection] = useState({ state: "connecting" });

  useEffect(() => {
    loadConfig()
      .then(() => {
        setConnection({ state: "ready" });
        void refreshStatus();
      })
      .catch((e) => setConnection({ state: "error", detail: e.message }));
  }, [refreshStatus]);

  useEffect(() => {
    if (connection.state !== "ready") return undefined;
    return connectEvents(handleEvent, (up) => {
      setWs(up);
      if (up) void hydrateApprovals(); // pick up anything missed while disconnected
    });
  }, [connection.state, handleEvent, setWs, hydrateApprovals]);

  useEffect(() => {
    if (connection.state === "ready" && page === "chat") void refreshStatus();
  }, [page, connection.state, refreshStatus]);

  if (connection.state === "error") return <Message title="Can't reach the OmniPilot engine" detail={connection.detail} />;
  if (connection.state === "connecting") return <Message title="Starting…" busy />;

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1">
        {page === "chat" && <ChatView />}
        {page === "history" && <HistoryPage />}
        {page === "settings" && <SettingsPage />}
      </main>
      <ApprovalDialog />
    </div>
  );
}

function Message({ title, detail, busy = false }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <Orb size={72} busy={busy} />
      <h1 className="font-display text-xl">{title}</h1>
      {detail && (
        <p className="max-w-md text-sm text-ink-soft">Make sure the backend window is still open, then reload this page. ({detail})</p>
      )}
    </div>
  );
}
