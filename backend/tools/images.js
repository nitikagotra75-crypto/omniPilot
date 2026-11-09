// Image tools (sharp). Outputs are new files, verified by reading their metadata back.
import fs from "node:fs";
import sharp from "sharp";
import { PathNotAllowed } from "../services/pathGuard.js";
import { fail, ok } from "./registry.js";

const guarded = (fn) => async (a, ctx) => { try { return await fn(a, ctx); } catch (e) { if (e instanceof PathNotAllowed) return fail(e.message); throw e; } };
const P = { type: "string", description: "Path to an image inside the allowed folders." };
const FORMATS = ["png", "jpeg", "webp", "avif"];

function source(a, ctx) {
  const p = ctx.guard.resolve(a.path);
  if (!fs.statSync(p, { throwIfNoEntry: false })?.isFile()) throw Object.assign(new Error(`File not found: ${p}`), { userFacing: true });
  return p;
}
const wrap = (fn) => guarded(async (a, ctx) => { try { return await fn(a, ctx); } catch (e) { if (e.userFacing) return fail(e.message); return fail(`Image processing failed: ${e.message}`); } });

async function write(pipeline, out, format, quality) {
  const opts = quality ? { quality } : {};
  await pipeline.toFormat(format, opts).toFile(out);
  return sharp(out).metadata();
}

export const imageTools = [
  { name: "image_info", category: "media", permissions: ["fs.read"], timeout: 30, description: "Read an image's format, dimensions and size.",
    inputSchema: { type: "object", properties: { path: P }, required: ["path"], additionalProperties: false },
    handler: wrap(async (a, ctx) => {
      const p = source(a, ctx), m = await sharp(p).metadata();
      return ok({ path: p, format: m.format, width: m.width, height: m.height, size_bytes: fs.statSync(p).size, has_alpha: !!m.hasAlpha }, "Read from the image file.");
    }) },

  { name: "image_convert", category: "media", permissions: ["fs.read", "fs.write"], timeout: 60,
    description: "Convert an image to png, jpeg, webp or avif (optional quality 1-100) as a new file next to the original.",
    inputSchema: { type: "object", properties: { path: P, format: { type: "string", enum: FORMATS }, quality: { type: "integer", minimum: 1, maximum: 100 } }, required: ["path", "format"], additionalProperties: false },
    summarize: (a) => `Convert ${a.path} to ${a.format}`,
    handler: wrap(async (a, ctx) => {
      const src = source(a, ctx);
      const out = ctx.guard.uniqueOutput(src, "-converted", "." + (a.format === "jpeg" ? "jpg" : a.format)); ctx.guard.resolve(out);
      const m = await write(sharp(src), out, a.format, a.quality);
      return m.format === a.format ? ok({ input: src, output: out, format: m.format, width: m.width, height: m.height, size_before_bytes: fs.statSync(src).size, size_after_bytes: fs.statSync(out).size }, "Re-read the output image's metadata.")
        : (fs.rmSync(out, { force: true }), fail(`Output was ${m.format}, not ${a.format}; discarded.`));
    }) },

  { name: "image_resize", category: "media", permissions: ["fs.read", "fs.write"], timeout: 60,
    description: "Resize an image to fit within width/height (aspect ratio kept, never enlarged) as a new file next to the original.",
    inputSchema: { type: "object", properties: { path: P, width: { type: "integer", minimum: 1, maximum: 20000 }, height: { type: "integer", minimum: 1, maximum: 20000 } }, required: ["path"], additionalProperties: false },
    summarize: (a) => `Resize ${a.path} to fit ${a.width ?? "auto"}x${a.height ?? "auto"}`,
    handler: wrap(async (a, ctx) => {
      if (!a.width && !a.height) return fail("Give a width, a height, or both.");
      const src = source(a, ctx), before = await sharp(src).metadata();
      const out = ctx.guard.uniqueOutput(src, "-resized"); ctx.guard.resolve(out);
      const m = await write(sharp(src).resize({ width: a.width, height: a.height, fit: "inside", withoutEnlargement: true }), out, before.format);
      const fits = (!a.width || m.width <= a.width) && (!a.height || m.height <= a.height);
      return fits ? ok({ input: src, output: out, width: m.width, height: m.height, original_width: before.width, original_height: before.height }, "Re-read the output image's dimensions.")
        : (fs.rmSync(out, { force: true }), fail("Output dimensions did not match the request; discarded."));
    }) },
];
