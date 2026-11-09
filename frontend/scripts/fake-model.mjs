// Minimal OpenAI-compatible fake model used only by the e2e smoke test (scripts/e2e.mjs).
// Deterministic: a path ending in victim.txt -> delete_file tool call; tool result -> summary; otherwise a canned reply.
import http from "node:http";

const port = Number(process.env.FAKE_MODEL_PORT || 9444);
const reply = (res, message, finish) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", ...message }, finish_reason: finish }] }));
};

http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) { res.writeHead(404).end(); return; }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const msgs = JSON.parse(raw).messages;
    const last = msgs[msgs.length - 1];
    if (last.role === "tool") {
      const r = JSON.parse(String(last.content).replace(/^<untrusted_content>/, "").replace(/<\/untrusted_content>$/, ""));
      return reply(res, { content: `Done. ok=${r.ok}, verified=${r.verified}. ${r.error || ""}`.trim() }, "stop");
    }
    const user = [...msgs].reverse().find((m) => m.role === "user")?.content || "";
    const m = /(\S*victim\.txt)/.exec(user);
    if (m) {
      return reply(res, { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "delete_file", arguments: JSON.stringify({ path: m[1] }) } }] }, "tool_calls");
    }
    reply(res, { content: "Hooks let function components keep state." }, "stop");
  });
}).listen(port, "127.0.0.1", () => console.log("fake model on", port));
