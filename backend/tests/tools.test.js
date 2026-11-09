import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { Memory } from "../models/index.js";
import { APP_ALLOWLIST, appTools } from "../tools/apps.js";
import { parsePages } from "../tools/pdf.js";
import { runTool, setup } from "./helpers.js";

let c, ws;
before(async () => { c = await setup(); ws = c.config.workspaceDir; });
after(() => c.teardown());

async function makePdf(file, pages = 3) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300, 300]).drawText(`page ${i + 1}`);
  fs.writeFileSync(file, await d.save());
}
const pageCount = async (f) => (await PDFDocument.load(fs.readFileSync(f))).getPageCount();

describe("PDF", () => {
  test("compress preserves original, verifies page count, never overwrites", async () => {
    const src = path.join(ws, "doc.pdf"); await makePdf(src, 4);
    const orig = fs.readFileSync(src);
    const r = await runTool(c, "pdf_compress", { path: src });
    assert.ok(r.ok && r.verified, r.error);
    assert.equal(r.data.output, path.join(fs.realpathSync(ws), "doc-compressed.pdf"));
    assert.deepEqual(fs.readFileSync(src), orig);
    assert.equal(await pageCount(r.data.output), 4);
    const again = await runTool(c, "pdf_compress", { path: src });
    assert.notEqual(again.data.output, r.data.output);
  });
  test("rejects non-PDFs, outside folders, corrupt files", async () => {
    const txt = path.join(ws, "a.txt"); fs.writeFileSync(txt, "hi");
    assert.ok(!(await runTool(c, "pdf_compress", { path: txt })).ok);
    const out = await runTool(c, "pdf_compress", { path: "/etc/hosts.pdf" });
    assert.ok(!out.ok && /outside/.test(out.error));
    const bad = path.join(ws, "bad.pdf"); fs.writeFileSync(bad, "not a pdf");
    assert.ok(!(await runTool(c, "pdf_info", { path: bad })).ok);
  });
  test("info, merge and extract pages", async () => {
    const a = path.join(ws, "a.pdf"), b = path.join(ws, "b.pdf"); await makePdf(a, 2); await makePdf(b, 3);
    assert.equal((await runTool(c, "pdf_info", { path: a })).data.pages, 2);
    const m = await runTool(c, "pdf_merge", { paths: [a, b], output: path.join(ws, "merged.pdf") });
    assert.ok(m.ok && m.verified && m.data.pages === 5, m.error);
    const e = await runTool(c, "pdf_extract_pages", { path: m.data.output, pages: "1-2,5" });
    assert.ok(e.ok && e.data.pages === 3, e.error);
    const bad = await runTool(c, "pdf_extract_pages", { path: a, pages: "1-9" });
    assert.ok(!bad.ok && /outside this PDF/.test(bad.error));
  });
  test("page spec parser", () => {
    assert.deepEqual(parsePages("1-3,5", 5), [0, 1, 2, 4]);
    assert.throws(() => parsePages("0", 5)); assert.throws(() => parsePages("x", 5)); assert.throws(() => parsePages("3-2", 5));
  });
});

describe("files", () => {
  test("write never overwrites; read flags untrusted; list and find", async () => {
    const f = path.join(ws, "n.txt"); fs.writeFileSync(f, "original");
    const w = await runTool(c, "write_text_file", { path: f, content: "new" });
    assert.ok(w.ok && w.verified && w.data.renamed_to_avoid_overwrite);
    assert.equal(fs.readFileSync(f, "utf8"), "original");
    const r = await runTool(c, "read_text_file", { path: f });
    assert.ok(r.data.untrusted);
    assert.ok((await runTool(c, "list_directory", { path: ws })).data.entries.some((e) => e.name === "n.txt"));
    assert.ok((await runTool(c, "find_files", { root: ws, pattern: "n*.txt" })).data.count >= 1);
  });
  test("outside the allowed folders is refused", async () => {
    for (const name of ["read_text_file", "list_directory"]) {
      const r = await runTool(c, name, { path: "/etc" }); assert.ok(!r.ok && /outside/.test(r.error));
    }
  });
  test("delete moves to trash and verifies", async () => {
    const f = path.join(ws, "gone.txt"); fs.writeFileSync(f, "x");
    const r = await runTool(c, "delete_file", { path: f });
    assert.ok(r.ok && r.verified && !fs.existsSync(f) && fs.existsSync(r.data.moved_to));
  });
  test("schema validation rejects extra and missing arguments", () => {
    const reg = c.container.registry, t = reg.get("delete_file");
    assert.match(reg.validateArgs(t, {}), /path/);
    assert.match(reg.validateArgs(t, { path: "x", extra: 1 }), /additional/);
    assert.equal(reg.validateArgs(t, { path: "x" }), null);
  });
});

describe("documents and images", () => {
  test("xlsx write/read round trip, csv, objects and no-overwrite", async () => {
    const f = path.join(ws, "t.xlsx");
    const w = await runTool(c, "spreadsheet_write", { path: f, rows: [{ name: "Asha", city: "Pune" }, { name: "Ravi", city: "Delhi" }] });
    assert.ok(w.ok && w.verified && w.data.rows === 3, w.error);
    const r = await runTool(c, "spreadsheet_read", { path: f });
    assert.deepEqual(r.data.rows, [["name", "city"], ["Asha", "Pune"], ["Ravi", "Delhi"]]);
    const w2 = await runTool(c, "spreadsheet_write", { path: f, rows: [[1]] });
    assert.notEqual(w2.data.path, f);
    const csv = await runTool(c, "spreadsheet_write", { path: path.join(ws, "t.csv"), rows: [["a", "b"], ["1", "2"]] });
    assert.deepEqual((await runTool(c, "spreadsheet_read", { path: csv.data.path })).data.rows, [["a", "b"], ["1", "2"]]);
    assert.ok(!(await runTool(c, "spreadsheet_write", { path: path.join(ws, "t.txt"), rows: [[1]] })).ok);
  });
  test("reads an xlsx made by another tool", async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet("Data").addRow(["x", 42]);
    const f = path.join(ws, "ext.xlsx"); await wb.xlsx.writeFile(f);
    assert.deepEqual((await runTool(c, "spreadsheet_read", { path: f })).data.rows, [["x", "42"]]);
  });
  test("docx write/read round trip", async () => {
    const f = path.join(ws, "d.docx");
    const w = await runTool(c, "docx_write", { path: f, content: "# Title\nHello world\n- one\n- two" });
    assert.ok(w.ok && w.verified, w.error);
    const r = await runTool(c, "docx_read", { path: f });
    assert.match(r.data.text, /Title/); assert.match(r.data.text, /Hello world/); assert.ok(r.data.untrusted);
  });
  test("image info, convert and resize; originals untouched", async () => {
    const f = path.join(ws, "p.png");
    await sharp({ create: { width: 400, height: 200, channels: 3, background: "#f59328" } }).png().toFile(f);
    const before = fs.readFileSync(f);
    assert.equal((await runTool(c, "image_info", { path: f })).data.width, 400);
    const conv = await runTool(c, "image_convert", { path: f, format: "webp", quality: 70 });
    assert.ok(conv.ok && conv.data.format === "webp" && conv.data.output.endsWith(".webp"), conv.error);
    const rs = await runTool(c, "image_resize", { path: f, width: 100 });
    assert.ok(rs.ok && rs.data.width === 100 && rs.data.height === 50, rs.error);
    const big = await runTool(c, "image_resize", { path: f, width: 4000 });
    assert.equal(big.data.width, 400); // never enlarged
    assert.ok(!(await runTool(c, "image_resize", { path: f })).ok);
    assert.deepEqual(fs.readFileSync(f), before);
  });
});

describe("system, memory, apps", () => {
  test("system tools return real values", async () => {
    assert.ok((await runTool(c, "system_info", {})).data.cpu_count > 0);
    assert.ok((await runTool(c, "disk_usage", {})).data.total_gb > 0);
    assert.ok((await runTool(c, "top_processes", { limit: 3 })).data.processes.length > 0);
    assert.equal((await runTool(c, "network_check", { host: "127.0.0.1", port: 1 })).data.reachable, false);
  });
  test("memory refuses secrets and saves + finds normal facts", async () => {
    assert.ok(!(await runTool(c, "memory_save", { category: "preference", content: "my password is hunter2" })).ok);
    const s = await runTool(c, "memory_save", { category: "preference", content: "Prefers Hindi replies" });
    assert.ok(s.ok && s.verified);
    assert.equal((await runTool(c, "memory_search", { query: "hindi" })).data.memories.length, 1);
    assert.equal((await Memory.findById(s.data.id)).source, "assistant");
  });
  test("open_application is allowlisted and verifies by observing the process", async () => {
    const handler = appTools[0].handler;
    const ctx = { signal: new AbortController().signal };
    assert.ok(!(await handler({ app: "rm -rf" }, ctx)).ok);
    assert.ok(!(await handler({ app: "notepad" }, ctx, { platform: "linux" })).ok); // no linux definition
    // launching `sleep` under a fake allowlist entry: must observe the real process before claiming success
    const allow = { sleeper: { linux: ["sleep", "5"], procs: ["sleep"] } };
    const r = await handler({ app: "sleeper" }, ctx, { platform: "linux", allowlist: allow });
    assert.ok(r.ok && r.verified && r.data.pids.length > 0, r.error);
    const none = { ghost: { linux: ["true"], procs: ["definitely-not-running-xyz"] } };
    const g = await handler({ app: "ghost" }, ctx, { platform: "linux", allowlist: none });
    assert.ok(!g.ok && /can't confirm/.test(g.error));
    assert.ok(Object.keys(APP_ALLOWLIST).includes("vscode"));
  });
});
