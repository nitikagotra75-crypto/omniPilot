import crypto from "node:crypto";

export function tokenOk(expected, given) {
  if (!expected) return true; // dev mode only; Electron always sets a token
  if (!given) return false;
  const a = Buffer.from(expected), b = Buffer.from(String(given));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const requireToken = (config) => (req, res, next) => {
  const h = req.get("authorization") || "";
  if (tokenOk(config.apiToken, h.startsWith("Bearer ") ? h.slice(7) : null)) return next();
  res.status(401).json({ detail: "Invalid or missing token" });
};
