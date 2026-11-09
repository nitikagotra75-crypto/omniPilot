// Express + Socket.IO assembly (no listening here, so tests can mount it on any port).
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import { Server } from "socket.io";
import { errorHandler } from "./middleware/errors.js";
import { tokenOk } from "./middleware/auth.js";
import { buildRouter } from "./routes/index.js";

const ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "null"]; // plus same-origin browser mode (no CORS needed)

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createApp(container, { webRoot } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: ORIGINS }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", buildRouter(container));
  app.use("/api", (req, res) => res.status(404).json({ detail: "Not found" }));
  if (webRoot && fs.existsSync(webRoot)) {
    // Browser mode. The session token is only handed to same-origin pages addressed as localhost (blocks DNS-rebinding and other sites).
    app.get("/bootstrap.json", (req, res) => {
      const host = req.headers.host || "";
      const site = req.get("sec-fetch-site");
      if (!LOCAL_HOST.test(host) || (site && site !== "same-origin")) return res.status(403).json({ detail: "Forbidden" });
      res.set("Cache-Control", "no-store").json({ baseUrl: `http://${host}`, token: container.config.apiToken });
    });
    app.use(express.static(webRoot, { index: "index.html" }));
  }
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: ORIGINS } });
  io.use((socket, next) => (tokenOk(container.config.apiToken, socket.handshake.auth?.token) ? next() : next(new Error("unauthorized"))));
  const unsubscribe = container.bus.subscribe((event) => io.emit("event", event));

  const close = async () => {
    unsubscribe();
    await new Promise((r) => io.close(() => r()));
    await container.browser.close();
  };
  return { app, httpServer, io, close };
}
