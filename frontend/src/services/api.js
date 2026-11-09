import { io } from "socket.io-client";

let config = null;

/** The engine that served this page hands out its own address and a session token (only to localhost pages). */
export async function loadConfig() {
  const res = await fetch("/bootstrap.json", { cache: "no-store" });
  if (!res.ok) throw new Error("The engine refused the connection.");
  config = await res.json();
  return config;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, init = {}, json = true) {
  if (!config) throw new ApiError(0, "Not connected to the OmniPilot engine yet.");
  let res;
  try {
    res = await fetch(`${config.baseUrl}/api${path}`, {
      ...init,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${config.token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the OmniPilot engine.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* the error body was not JSON */
    }
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export const get = (path) => request(path);
export const post = (path, body) => request(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = (path, body) => request(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = (path) => request(path, { method: "DELETE" });
/** multipart upload (files, voice recordings): `form` is a FormData */
export const upload = (path, form) => request(path, { method: "POST", body: form }, false);

/** POST JSON and get the response body back as a Blob (used for synthesized speech). */
export async function postForBlob(path, body) {
  if (!config) throw new ApiError(0, "Not connected to the OmniPilot engine yet.");
  const res = await fetch(`${config.baseUrl}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

/** Live task events over Socket.IO (auto-reconnect). Returns a function that closes the connection. */
export function connectEvents(onEvent, onStatus) {
  if (!config) return () => {};
  const socket = io(config.baseUrl, { auth: { token: config.token }, reconnectionDelay: 800, reconnectionDelayMax: 4000 });
  socket.on("connect", () => onStatus(true));
  socket.on("disconnect", () => onStatus(false));
  socket.on("event", onEvent);
  return () => socket.close();
}
