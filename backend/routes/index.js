import express from "express";
import multer from "multer";
import { requireToken } from "../middleware/auth.js";
import { wrap } from "../middleware/errors.js";
import { controllers } from "../controllers/index.js";

export function buildRouter(container) {
  const c = controllers(container);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  const r = express.Router();
  r.get("/health", c.health); // open: Electron polls it during startup

  const p = express.Router();
  p.use(requireToken(container.config));
  p.get("/status", wrap(c.status));
  p.get("/providers", c.providers);
  p.get("/tools", c.tools);
  p.route("/settings").get(wrap(c.getSettings)).put(wrap(c.putSettings));
  p.route("/secrets/:name").put(wrap(c.putSecret)).delete(wrap(c.deleteSecret));
  p.get("/permissions", wrap(c.getPermissions));
  p.put("/permissions/:permission", wrap(c.putPermission));
  p.route("/tasks").post(wrap(c.createTask)).get(wrap(c.listTasks));
  p.get("/tasks/:id", wrap(c.getTask));
  p.post("/tasks/:id/cancel", c.cancelTask);
  p.get("/approvals", c.pendingApprovals);
  p.post("/approvals/:id", c.answerApproval);
  p.post("/emergency-stop", wrap(c.emergencyStop));
  p.get("/conversations", wrap(c.conversations));
  p.get("/conversations/:id/messages", wrap(c.conversationMessages));
  p.get("/action-log", wrap(c.actionLog));
  p.route("/memories").get(wrap(c.listMemories)).post(wrap(c.addMemory));
  p.route("/memories/:id").patch(wrap(c.patchMemory)).delete(wrap(c.deleteMemory));
  p.post("/files/upload", upload.single("file"), wrap(c.upload));
  p.get("/files/download", wrap(c.download));
  p.post("/voice/transcribe", upload.single("audio"), wrap(c.transcribe));
  p.post("/voice/speak", wrap(c.speak));
  r.use(p);
  return r;
}
