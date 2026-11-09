import { useEffect } from "react";
import { ChatView } from "../components/ChatView";
import { Orb } from "../components/Orb";
import { useStore } from "../context/useStore";
/** Floating assistant: small always-on-top window summoned with Ctrl+Alt+O. */
export function QuickAsk() {
    const busy = useStore((s) => !!s.activeTaskId);
    useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape")
            void window.omnipilot?.hideQuick(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    return (<div className="flex h-full flex-col rounded-2xl border border-line bg-paper">
      <div className="drag flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2"><Orb size={18} busy={busy}/><span className="font-display text-sm text-ink">OmniPilot</span></div>
        <div className="no-drag flex gap-1">
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void window.omnipilot?.openMain()}>Open full app</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void window.omnipilot?.hideQuick()}>Esc</button>
        </div>
      </div>
      <div className="min-h-0 flex-1"><ChatView compact/></div>
    </div>);
}
