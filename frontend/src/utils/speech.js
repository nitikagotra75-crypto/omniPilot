// Spoken replies: Gnani Timbre through the engine when it is configured, otherwise the browser's own voices (works offline;
// Hindi needs an installed Hindi voice).
import { postForBlob } from "../services/api";

const DEVANAGARI = /[ऀ-ॿ]/;

export function pickLang(text, preferred) {
  if (preferred && preferred !== "auto") return preferred;
  return DEVANAGARI.test(text) ? "hi-IN" : navigator.language || "en-IN";
}

let player = null;
let ticket = 0;

/** Speak with the engine's voice; falls back to the browser voice if the engine voice fails. */
export async function speakRemote(text, lang) {
  if (!text) return;
  stopSpeaking();
  const mine = ++ticket;
  try {
    const url = URL.createObjectURL(await postForBlob("/voice/speak", { text: text.slice(0, 1500) }));
    if (mine !== ticket) return URL.revokeObjectURL(url);
    player = new Audio(url);
    player.onended = () => URL.revokeObjectURL(url);
    await player.play();
  } catch {
    if (mine === ticket) speak(text, lang);
  }
}

export function speak(text, lang) {
  if (!("speechSynthesis" in window) || !text) return false;
  window.speechSynthesis.cancel(); // interruption: a new reply replaces the old one
  const u = new SpeechSynthesisUtterance(text.slice(0, 1500));
  u.lang = pickLang(text, lang);
  const voice =
    window.speechSynthesis.getVoices().find((v) => v.lang === u.lang) ||
    window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(u.lang.split("-")[0]));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
  return true;
}
export const stopSpeaking = () => {
  ticket++;
  if (player) {
    player.pause();
    player = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
};
