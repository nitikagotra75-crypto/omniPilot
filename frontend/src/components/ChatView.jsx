import { useEffect, useRef } from "react";
import { useStore } from "../context/useStore";
import { Composer } from "./Composer";
import { Orb } from "./Orb";
import { StepTimeline } from "./StepTimeline";

const SUGGESTIONS = [
  "How much free disk space do I have?",
  "Open Notepad",
  "Explain React hooks simply",
  "समझाओ कि Python में decorator क्या होता है",
];

export function ChatView() {
  const messages = useStore((s) => s.messages);
  const steps = useStore((s) => s.steps);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const status = useStore((s) => s.status);
  const send = useStore((s) => s.send);
  const bottom = useRef(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, steps, activeTaskId]);

  const empty = messages.length === 0 && !activeTaskId;
  const ready = !!status?.llm_configured;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-8">
        <div className="mx-auto max-w-3xl">
          {empty && (
            <div className="flex flex-col items-center pt-[12vh] text-center">
              <Orb size={84} />
              <h1 className="mt-6 font-display text-3xl">How can I help?</h1>
              <p className="mt-2 max-w-md text-ink-soft">
                Ask a question, or tell me what to do on this computer. I'll show what actually happened.
              </p>
              {ready ? (
                <div className="mt-8 flex max-w-2xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn-outline" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                <SetupNotice />
              )}
            </div>
          )}

          <div className="space-y-5 pb-6">
            {messages.map((m) => (
              <Message key={m.id} message={m} steps={steps[m.taskId] ?? []} />
            ))}
            {activeTaskId && (
              <div className="flex gap-3">
                <Orb size={32} busy />
                <div className="min-w-0 flex-1">
                  <StepTimeline steps={steps[activeTaskId] ?? []} />
                  <p className="mt-1 text-sm text-ink-faint">Working…</p>
                </div>
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>
      </div>
      <div className="shrink-0 px-8 pb-6 pt-2">
        <div className="mx-auto max-w-3xl">
          <Composer />
        </div>
      </div>
    </div>
  );
}

function Message({ message: m, steps }) {
  if (m.role === "user") {
    return (
      <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm border-2 border-ink bg-pink-300 px-4 py-2.5">
        {m.content}
      </div>
    );
  }
  if (m.role === "assistant") {
    return (
      <div className="flex gap-3">
        <Orb size={32} />
        <div className="min-w-0 flex-1">
          <StepTimeline steps={steps} />
          <div className="card w-fit max-w-full whitespace-pre-wrap rounded-tl-sm px-4 py-2.5 leading-relaxed">{m.content}</div>
        </div>
      </div>
    );
  }
  if (m.role === "error") {
    return (
      <div className="rounded-2xl border-2 border-rose-400 bg-surface px-4 py-3 text-sm text-rose-400">
        <StepTimeline steps={steps} />
        {m.content}
      </div>
    );
  }
  return <p className="text-center text-xs text-ink-faint">{m.content}</p>;
}

/** Shown when the backend has no AI model configured. Users never type keys here; the person running OmniPilot sets them in backend/.env. */
function SetupNotice() {
  const setPage = useStore((s) => s.setPage);
  return (
    <div className="card mt-8 max-w-md p-4 text-left">
      <h2 className="font-semibold">Connect an AI model first</h2>
      <p className="mt-1 text-sm text-ink-soft">Pick a provider (for example Groq), paste your API key and you are ready to talk.</p>
      <button className="btn-primary mt-3" onClick={() => setPage("settings")}>
        Open settings
      </button>
    </div>
  );
}
