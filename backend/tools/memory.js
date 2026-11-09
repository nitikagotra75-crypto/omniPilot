// Memory tools. Saving requires explicit user approval (memory.write = ask), so memory stays user-approved.
import { MEMORY_CATEGORIES, Memory } from "../models/index.js";
import { fail, ok } from "./registry.js";

const SECRET_LIKE = /(password|passwd|api[_ -]?key|secret|token|private key|otp|\bpin\b|sk-[A-Za-z0-9]{10,})/i;

export const memoryTools = [
  { name: "memory_save", category: "memory", permissions: ["memory.write"], timeout: 10,
    description: "Remember a durable fact, preference, instruction, project or workflow the user wants kept. The user is asked to approve every save. Never store passwords or secrets.",
    inputSchema: { type: "object", properties: { category: { type: "string", enum: MEMORY_CATEGORIES }, content: { type: "string", minLength: 1, maxLength: 500 } }, required: ["category", "content"], additionalProperties: false },
    summarize: (a) => `Remember (${a.category}): ${a.content}`,
    handler: async (a) => {
      if (SECRET_LIKE.test(a.content)) return fail("That looks like a password or secret, so it was not saved. Memory never stores credentials.");
      const m = await Memory.create({ category: a.category, content: a.content, source: "assistant" });
      const back = await Memory.findById(m._id).lean();
      return back ? ok({ id: String(m._id) }, "Read the memory back from the database.") : fail("The memory could not be read back after saving.");
    } },
  { name: "memory_search", category: "memory", permissions: ["system.read"], timeout: 10,
    description: "Search the user's saved memories by keyword.",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false },
    handler: async (a) => {
      const esc = a.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = await Memory.find({ content: new RegExp(esc, "i") }).limit(20).lean();
      return ok({ memories: found.map((m) => ({ id: String(m._id), category: m.category, content: m.content })) }, "Read from the memory database.");
    } },
];
