import { create } from "zustand";
import { get, post } from "../services/api";
import { speak, speakRemote } from "../utils/speech";

const readSpeak = () => {
  try {
    return localStorage.getItem("omnipilot.speak") === "1";
  } catch {
    return false;
  }
};
let n = 0;
const mid = () => `m${Date.now()}-${n++}`;
export const useStore = create((set, getState) => ({
  page: "chat",
  backend: { state: "starting" },
  wsConnected: false,
  status: null,
  conversationId: null,
  messages: [],
  steps: {},
  ownTasks: new Set(),
  voiceTasks: new Set(), // tasks the user dictated with the microphone
  activeTaskId: null,
  approvals: [],
  speakReplies: readSpeak(),
  language: "auto",
  toggleSpeak: () =>
    set((s) => {
      const v = !s.speakReplies;
      try {
        localStorage.setItem("omnipilot.speak", v ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return { speakReplies: v };
    }),
  setLanguage: (language) => set({ language }),
  setPage: (page) => set({ page }),
  setBackend: (backend) => set({ backend }),
  setWs: (wsConnected) => set({ wsConnected }),
  refreshStatus: async () => {
    try {
      set({ status: await get("/status") });
      const st = await get("/settings");
      set({ language: st.language ?? "auto" });
    } catch {
      /* backend not ready */
    }
  },
  hydrateApprovals: async () => {
    try {
      const pending = await get("/approvals");
      set({ approvals: pending });
    } catch {
      /* backend unavailable; the socket will retry */
    }
  },
  send: async (text, { voice = false } = {}) => {
    const { conversationId } = getState();
    set((s) => ({ messages: [...s.messages, { id: mid(), role: "user", content: text }] }));
    try {
      const r = await post("/tasks", { message: text, conversation_id: conversationId });
      set((s) => ({
        conversationId: r.conversation_id,
        activeTaskId: r.task_id,
        ownTasks: new Set(s.ownTasks).add(r.task_id),
        voiceTasks: voice ? new Set(s.voiceTasks).add(r.task_id) : s.voiceTasks,
      }));
    } catch (e) {
      set((s) => ({ messages: [...s.messages, { id: mid(), role: "error", content: e.message }] }));
    }
  },
  cancel: async () => {
    const id = getState().activeTaskId;
    if (id) await post(`/tasks/${id}/cancel`).catch(() => undefined);
  },
  emergencyStop: async () => {
    await post("/emergency-stop").catch(() => undefined);
    set({ approvals: [] });
  },
  answerApproval: async (id, approved) => {
    set((s) => ({ approvals: s.approvals.filter((a) => a.approval_id !== id) }));
    await post(`/approvals/${id}`, { approved }).catch(() => undefined); // 404 = answered elsewhere
  },
  newChat: () => set({ conversationId: null, messages: [], steps: {}, activeTaskId: null }),
  handleEvent: (e) => {
    const own = (id) => !!id && getState().ownTasks.has(id);
    switch (e.type) {
      case "approval.requested":
        set((s) => (s.approvals.some((a) => a.approval_id === e.approval_id) ? s : { approvals: [...s.approvals, e] }));
        break;
      case "step.started":
        if (!own(e.task_id)) break;
        set((s) => ({
          steps: {
            ...s.steps,
            [e.task_id]: [...(s.steps[e.task_id] ?? []), { index: e.index, tool: e.tool, summary: e.summary, state: "running" }],
          },
        }));
        break;
      case "step.result":
        if (!own(e.task_id)) break;
        set((s) => {
          const list = [...(s.steps[e.task_id] ?? [])];
          const i = list.findIndex((x) => x.index === e.index);
          const next = {
            index: e.index,
            tool: e.tool,
            summary: e.summary,
            state: e.ok ? "done" : "failed",
            verified: e.verified,
            verification: e.verification,
            error: e.error,
          };
          if (i >= 0) list[i] = next;
          else list.push(next);
          return { steps: { ...s.steps, [e.task_id]: list } };
        });
        break;
      case "task.completed":
        if (!own(e.task_id)) break;
        const policy = getState().status?.speak_replies;
        if (getState().speakReplies || policy === "always" || (policy !== "off" && getState().voiceTasks.has(e.task_id))) {
          const talk = getState().status?.voice?.tts === "gnani" ? speakRemote : speak;
          talk(e.result, getState().language);
        }
        set((s) => ({
          activeTaskId: s.activeTaskId === e.task_id ? null : s.activeTaskId,
          messages: [...s.messages, { id: mid(), role: "assistant", content: e.result, taskId: e.task_id }],
        }));
        break;
      case "task.failed":
        if (!own(e.task_id)) break;
        set((s) => ({
          activeTaskId: s.activeTaskId === e.task_id ? null : s.activeTaskId,
          messages: [...s.messages, { id: mid(), role: "error", content: e.error, code: e.code, taskId: e.task_id }],
        }));
        break;
      case "task.cancelled":
        if (!own(e.task_id)) break;
        set((s) => ({
          activeTaskId: s.activeTaskId === e.task_id ? null : s.activeTaskId,
          approvals: s.approvals.filter((a) => a.task_id !== e.task_id),
          messages: [...s.messages, { id: mid(), role: "notice", content: "Task stopped.", taskId: e.task_id }],
        }));
        break;
      case "emergency.stop":
        set({ approvals: [] });
        break;
    }
  },
}));
