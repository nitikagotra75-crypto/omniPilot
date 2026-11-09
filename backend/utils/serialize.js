// Mongo documents -> the snake_case JSON the UI consumes.
const sec = (d) => (d ? new Date(d).getTime() / 1000 : null);

export const taskJson = (t, { steps = false } = {}) => ({
  id: String(t._id), conversation_id: t.conversationId ? String(t.conversationId) : null, request: t.request, status: t.status,
  result: t.result ?? null, error: t.error ?? null, created_at: sec(t.createdAt), finished_at: sec(t.finishedAt),
  ...(steps ? { steps: (t.steps || []).map((s) => ({ idx: s.idx, tool: s.tool, ok: s.ok ? 1 : 0, verified: s.verified ? 1 : 0, result_json: JSON.stringify(s.result ?? null) })) } : {}),
});
export const memoryJson = (m) => ({ id: String(m._id), category: m.category, content: m.content, source: m.source, created_at: sec(m.createdAt), updated_at: sec(m.updatedAt) });
export const logJson = (l) => ({ id: String(l._id), task_id: l.taskId ? String(l.taskId) : null, tool: l.tool, permission: l.permission, approved: l.approved == null ? null : l.approved ? 1 : 0, summary: l.summary, at: sec(l.createdAt) });
export const conversationJson = (c) => ({ id: String(c._id), title: c.title, created_at: sec(c.createdAt) });
