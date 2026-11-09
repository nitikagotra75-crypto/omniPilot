// OmniPilot engine entry point: `npm start` (API only) or `npm run web` (API + UI).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { connectDb } from "./config/db.js";
import { loadConfig } from "./config/index.js";
import { loadDotEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { buildContainer } from "./services/container.js";
import { watchParent } from "./utils/parentWatchdog.js";

loadDotEnv();
const config = loadConfig();
try {
  await connectDb(config.mongoUri);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
if (config.webRoot && !fs.existsSync(path.join(config.webRoot, "index.html"))) {
  console.error(`\nThe web UI was not found at: ${config.webRoot}\nPut the frontend folder next to the backend folder (it contains dist/index.html),\nor build it with: cd frontend && npm install && npm run build\nor set OMNIPILOT_WEB_ROOT to the dist folder. The API still works without it.\n`);
}
const container = await buildContainer(config);
const { httpServer, close } = createApp(container, { webRoot: config.webRoot });
await new Promise((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(config.port, "127.0.0.1", resolve); }) // loopback only
  .catch((e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${config.port} is already in use. OmniPilot may already be running: open http://localhost:${config.port}. Or set PORT to another number.` : e.message);
    process.exit(3);
  });
console.log(`OMNIPILOT_READY ${httpServer.address().port}`);
if (config.webRoot) {
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  console.log(`\nOmniPilot is running. Open ${url} in your browser (type http:// in front). Close this window to stop it.\n`);
  if (process.env.OMNIPILOT_OPEN === "1" && process.platform === "win32") {
    try { spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { /* the user can open it by hand */ }
  }
}
if (config.parentPid) watchParent(config.parentPid);

const shutdown = async () => { await close().catch(() => {}); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
