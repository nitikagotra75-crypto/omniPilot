import { useRef, useState } from "react";
import { useStore } from "../context/useStore";
import { useRecorder } from "../hooks/useRecorder";
import { upload } from "../services/api";

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function Composer() {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]); // server-side paths of uploaded files
  const [note, setNote] = useState(null);
  const [dragging, setDragging] = useState(false);
  const busy = useStore((s) => !!s.activeTaskId);
  const send = useStore((s) => s.send);
  const cancel = useStore((s) => s.cancel);
  const speakReplies = useStore((s) => s.speakReplies);
  const toggleSpeak = useStore((s) => s.toggleSpeak);
  const language = useStore((s) => s.language);
  const input = useRef(null);
  const picker = useRef(null);

  const flash = (message) => {
    setNote(message);
    window.setTimeout(() => setNote(null), 5000);
  };

  const latest = useRef(null); // always the newest submit, so a recording that ends later sends with current state
  const recorder = useRecorder({
    language,
    onError: flash,
    onText: (t) => void latest.current(t),
  });

  // Typed messages are sent as typed. A dictated message is sent straight away, and the answer is spoken back.
  const submit = async (dictation) => {
    const message = (dictation ? `${text} ${dictation}` : text).trim();
    if (!message) return;
    if (busy) {
      setText(message);
      return flash("Wait for the current task to finish, or press Stop.");
    }
    const body = files.length ? `${message}\n\nFiles I selected:\n${files.map((f) => `- ${f}`).join("\n")}` : message;
    setText("");
    setFiles([]);
    await send(body, { voice: !!dictation });
  };

  latest.current = submit;

  const addFiles = async (list) => {
    for (const file of [...list]) {
      try {
        const form = new FormData();
        form.append("file", file);
        const { path } = await upload("/files/upload", form);
        setFiles((current) => [...new Set([...current, path])]);
      } catch (e) {
        flash(`Could not add ${file.name}: ${e.message}`);
      }
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    await addFiles(e.dataTransfer.files);
  };

  const rec = recorder.state;
  const placeholder =
    rec === "recording"
      ? "Listening… press the mic again to finish"
      : rec === "transcribing"
        ? "Transcribing…"
        : "Ask me anything, or tell me what to do…";

  return (
    <div
      className={`card border-ink p-2.5 ${dragging ? "bg-lemon/30" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={picker}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {rec !== "idle" && (
        <p className="mb-2 rounded-lg bg-lemon/50 px-3 py-1.5 text-xs font-semibold">
          {rec === "recording" ? "Listening… tap the mic again to send." : "Understanding what you said…"}
        </p>
      )}
      {note && <p className="mb-2 rounded-lg bg-rose-400/10 px-3 py-1.5 text-xs text-rose-400">{note}</p>}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
          {files.map((f) => (
            <button
              key={f}
              onClick={() => setFiles((current) => current.filter((x) => x !== f))}
              title="Remove"
              className="chip max-w-[260px] gap-1.5 bg-lilac hover:bg-lemon/50"
            >
              <span className="truncate">{f.split(/[\\/]/).pop()}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          className="btn-ghost !px-2.5"
          onClick={() => picker.current?.click()}
          title="Attach files (or drop them here)"
          aria-label="Attach files"
        >
          <svg {...iconProps}>
            <path d="M21 12.5 12.5 21a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3" />
          </svg>
        </button>
        <textarea
          ref={input}
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 outline-none placeholder:text-ink-faint"
        />
        <button
          className={`btn-ghost !px-2.5 ${speakReplies ? "!bg-lemon/50 !text-ink" : ""}`}
          onClick={toggleSpeak}
          title={speakReplies ? "Spoken replies on" : "Spoken replies off"}
          aria-pressed={speakReplies}
          aria-label="Toggle spoken replies"
        >
          <svg {...iconProps}>
            <path d="M11 5 6 9H3v6h3l5 4V5z" />
            {speakReplies && <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
          </svg>
        </button>
        <button
          className={`btn-ghost !px-2.5 ${rec === "recording" ? "!bg-rose-400/20 !text-rose-400" : ""}`}
          disabled={rec === "transcribing"}
          onClick={() => (rec === "recording" ? recorder.stop() : recorder.start())}
          title={rec === "recording" ? "Tap to stop and send" : "Tap and speak"}
          aria-label="Voice input"
        >
          <svg {...iconProps}>
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        {busy ? (
          <button className="btn-danger" onClick={() => void cancel()}>
            Stop
          </button>
        ) : (
          <button className="btn-primary" disabled={!text.trim()} onClick={() => void submit()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
