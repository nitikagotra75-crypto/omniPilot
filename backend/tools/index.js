// Assembles the default tool registry. A new tool module only needs to export an array of tool definitions here.
import { appTools } from "./apps.js";
import { browserTools } from "./browser.js";
import { computerTools } from "./computer.js";
import { documentTools } from "./documents.js";
import { fileTools } from "./files.js";
import { imageTools } from "./images.js";
import { memoryTools } from "./memory.js";
import { pdfTools } from "./pdf.js";
import { ToolRegistry } from "./registry.js";
import { systemTools } from "./system.js";

export function buildRegistry({ browser, computer } = {}) {
  const reg = new ToolRegistry();
  const groups = [systemTools, fileTools, pdfTools, documentTools, imageTools, appTools, memoryTools];
  if (browser) groups.push(browserTools(browser));
  if (computer) groups.push(computerTools(computer));
  for (const g of groups) for (const t of g) reg.register(t);
  return reg;
}
