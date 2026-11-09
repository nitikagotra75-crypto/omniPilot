const TOOL_LABEL = {
  open_application: "Open app",
  pdf_compress: "Compress PDF",
  pdf_info: "Read PDF",
  list_directory: "List folder",
  find_files: "Find files",
  read_text_file: "Read file",
  write_text_file: "Write file",
  delete_file: "Delete file",
  system_info: "System info",
  disk_usage: "Disk usage",
  top_processes: "Processes",
  network_check: "Network check",
  computer_screenshot: "Look at screen",
  computer_click: "Click",
  computer_type: "Type",
  computer_key: "Press keys",
};

function Dot({ step }) {
  const tone =
    step.state === "running"
      ? "animate-pulse bg-lemon"
      : step.state === "failed"
        ? "bg-rose-400"
        : step.verified
          ? "bg-mint-500"
          : "bg-ink-faint";
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-ink ${tone}`} />;
}

/** What actually ran. The "verified" chip comes from the tool itself, not from the model's wording. */
export function StepTimeline({ steps }) {
  if (!steps.length) return null;
  return (
    <ol className="my-2 space-y-2">
      {steps.map((s) => (
        <li key={s.index} className="flex gap-3">
          <Dot step={s} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{TOOL_LABEL[s.tool] ?? s.tool}</span>
              {s.state === "running" && <span className="text-xs text-ink-faint">working…</span>}
              {s.state === "done" && s.verified && <span className="chip bg-mint-500/30">verified</span>}
              {s.state === "done" && !s.verified && <span className="chip bg-lilac">not verified</span>}
              {s.state === "failed" && <span className="chip border-rose-400 text-rose-400">failed</span>}
            </div>
            <p className="truncate text-xs text-ink-faint" title={s.summary}>
              {s.summary}
            </p>
            {s.state === "done" && s.verification && <p className="text-xs text-ink-faint">{s.verification}</p>}
            {s.state === "failed" && s.error && <p className="text-xs text-rose-400">{s.error}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
