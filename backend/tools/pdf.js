// PDF tools (pdf-lib, optional Ghostscript). Originals are preserved; outputs are verified by re-opening them.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { PathNotAllowed } from "../services/pathGuard.js";
import { findExecutable, run } from "../utils/exec.js";
import { fail, ok } from "./registry.js";

const P = { type: "string", description: "Path to a PDF inside the allowed folders." };
const guarded = (fn) => async (a, ctx) => { try { return await fn(a, ctx); } catch (e) { if (e instanceof PathNotAllowed) return fail(e.message); throw e; } };
const load = async (p) => PDFDocument.load(fs.readFileSync(p));

function pdfPath(a, ctx, key = "path") {
  const p = ctx.guard.resolve(a[key]);
  if (!fs.statSync(p, { throwIfNoEntry: false })?.isFile() || !p.toLowerCase().endsWith(".pdf")) throw Object.assign(new Error(`Not a PDF file: ${p}`), { userFacing: true });
  return p;
}
const withUserErrors = (fn) => guarded(async (a, ctx) => { try { return await fn(a, ctx); } catch (e) { if (e.userFacing) return fail(e.message); throw e; } });

/** "1-3,5" -> [0,1,2,4] (zero-based), validated against the page count. */
export function parsePages(spec, count) {
  const out = [];
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw Object.assign(new Error(`'${part}' is not a valid page or range.`), { userFacing: true });
    const from = +m[1], to = m[2] ? +m[2] : from;
    if (from < 1 || to < from || to > count) throw Object.assign(new Error(`Pages ${part} are outside this PDF (it has ${count} pages).`), { userFacing: true });
    for (let i = from; i <= to; i++) out.push(i - 1);
  }
  if (!out.length) throw Object.assign(new Error("No pages were selected."), { userFacing: true });
  return out;
}

export const pdfTools = [
  { name: "pdf_info", category: "files", permissions: ["fs.read"], timeout: 20, description: "Read page count, size and metadata of a PDF.",
    inputSchema: { type: "object", properties: { path: P }, required: ["path"], additionalProperties: false },
    handler: withUserErrors(async (a, ctx) => {
      const p = pdfPath(a, ctx);
      let doc; try { doc = await load(p); } catch (e) { return fail(`Could not read PDF (it may be encrypted or corrupt): ${e.message}`); }
      return ok({ path: p, pages: doc.getPageCount(), size_bytes: fs.statSync(p).size, title: doc.getTitle() || "" }, "Opened and parsed the PDF.");
    }) },

  { name: "pdf_compress", category: "files", permissions: ["fs.read", "fs.write"], timeout: 300,
    description: "Compress a PDF into a new file next to the original (the original is kept).",
    inputSchema: { type: "object", properties: { path: P, quality: { type: "string", enum: ["low", "medium", "high"] } }, required: ["path"], additionalProperties: false },
    summarize: (a) => `Compress PDF ${a.path} into a new file`,
    handler: withUserErrors(async (a, ctx) => {
      const src = pdfPath(a, ctx);
      const dst = ctx.guard.uniqueOutput(src, "-compressed"); ctx.guard.resolve(dst);
      let pages;
      try { pages = (await load(src)).getPageCount(); } catch (e) { return fail(`Could not read the PDF (it may be encrypted or corrupt): ${e.message}`); }
      const gs = findExecutable(["gswin64c", "gswin32c", "gs"]);
      let method = "pdf-lib (structure compression; images are not recompressed)";
      try {
        if (gs) {
          const preset = { low: "/screen", medium: "/ebook", high: "/printer" }[a.quality || "medium"];
          await run(gs, ["-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4", `-dPDFSETTINGS=${preset}`, "-dNOPAUSE", "-dQUIET", "-dBATCH", `-sOutputFile=${dst}`, src], { timeout: 240_000, signal: ctx.signal });
          method = `Ghostscript (${a.quality || "medium"} quality; images may be downsampled)`;
        } else {
          const doc = await load(src);
          fs.writeFileSync(dst, await doc.save({ useObjectStreams: true }));
        }
      } catch (e) { fs.rmSync(dst, { force: true }); if (ctx.signal.aborted) throw e; return fail(`Compression failed: ${e.message}`); }
      let newPages;
      try { newPages = (await load(dst)).getPageCount(); } catch (e) { fs.rmSync(dst, { force: true }); return fail(`Output PDF failed validation and was discarded: ${e.message}`); }
      if (newPages !== pages) { fs.rmSync(dst, { force: true }); return fail("Output page count differed from the original; result discarded."); }
      const before = fs.statSync(src).size, after = fs.statSync(dst).size;
      const note = (after < before ? "" : "The result is not smaller than the original; this PDF is likely already optimized. ") +
        (gs ? "" : "Install Ghostscript to enable image downsampling for much larger savings.");
      return ok({ input: src, output: dst, method, size_before_bytes: before, size_after_bytes: after,
        saved_percent: before ? +((1 - after / before) * 100).toFixed(1) : 0, smaller: after < before, pages: newPages, note },
        `Re-opened the output PDF: ${newPages} pages (matches original); measured file sizes.`);
    }) },

  { name: "pdf_merge", category: "files", permissions: ["fs.read", "fs.write"], timeout: 120,
    description: "Merge several PDFs, in the given order, into one new PDF. Originals are kept.",
    inputSchema: { type: "object", properties: { paths: { type: "array", items: P, minItems: 2, maxItems: 50 }, output: { type: "string", description: "Path for the merged file." } }, required: ["paths", "output"], additionalProperties: false },
    summarize: (a) => `Merge ${a.paths?.length} PDFs into ${a.output}`,
    handler: withUserErrors(async (a, ctx) => {
      const srcs = a.paths.map((p) => pdfPath({ path: p }, ctx));
      let out = ctx.guard.resolve(a.output);
      if (fs.existsSync(out)) out = ctx.guard.uniqueOutput(out, "-new");
      ctx.guard.resolve(out);
      const merged = await PDFDocument.create(); let expected = 0;
      for (const s of srcs) {
        let doc; try { doc = await load(s); } catch (e) { return fail(`Could not read ${s}: ${e.message}`); }
        for (const pg of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(pg);
        expected += doc.getPageCount();
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await merged.save());
      const got = (await load(out)).getPageCount();
      return got === expected ? ok({ output: out, pages: got, sources: srcs.length }, `Re-opened the merged PDF: ${got} pages = sum of the sources.`)
        : (fs.rmSync(out, { force: true }), fail(`Merged page count ${got} did not match the expected ${expected}; result discarded.`));
    }) },

  { name: "pdf_extract_pages", category: "files", permissions: ["fs.read", "fs.write"], timeout: 120,
    description: "Extract pages (e.g. '1-3,5') from a PDF into a new PDF. Use it to split a document. The original is kept.",
    inputSchema: { type: "object", properties: { path: P, pages: { type: "string", description: "1-based pages and ranges, e.g. '1-3,7'." } }, required: ["path", "pages"], additionalProperties: false },
    summarize: (a) => `Extract pages ${a.pages} from ${a.path}`,
    handler: withUserErrors(async (a, ctx) => {
      const src = pdfPath(a, ctx);
      let doc; try { doc = await load(src); } catch (e) { return fail(`Could not read the PDF: ${e.message}`); }
      const idx = parsePages(a.pages, doc.getPageCount());
      const out = ctx.guard.uniqueOutput(src, "-pages"); ctx.guard.resolve(out);
      const part = await PDFDocument.create();
      for (const pg of await part.copyPages(doc, idx)) part.addPage(pg);
      fs.writeFileSync(out, await part.save());
      const got = (await load(out)).getPageCount();
      return got === idx.length ? ok({ output: out, pages: got }, `Re-opened the new PDF: ${got} pages as requested.`)
        : (fs.rmSync(out, { force: true }), fail("Extracted page count did not match; result discarded."));
    }) },
];

