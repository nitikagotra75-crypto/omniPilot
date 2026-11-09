export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ detail: err.message });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ detail: "Request body is not valid JSON." });
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ detail: "That file is too large." });
  if (err?.name === "CastError") return res.status(404).json({ detail: "Not found" });
  console.error(err);
  res.status(500).json({ detail: "Internal server error" });
};
