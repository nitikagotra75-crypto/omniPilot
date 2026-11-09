// Browser mode (no Electron): starts the engine and serves the built UI at http://localhost:3939
process.env.OMNIPILOT_WEB = "1";
await import("./server.js");
