import { useCallback, useRef, useState } from "react";
import { upload } from "../services/api";
import { stopSpeaking } from "../utils/speech";
import { toWav } from "../utils/wav";

const MAX_SECONDS = 28; // the speech service accepts at most 30 s

/** Push-to-talk style recording. The audio is sent to the engine, which transcribes it (Gnani Prisma if configured, otherwise the model provider). */
export function useRecorder({ onText, onError, language }) {
  const [state, setState] = useState("idle"); // idle | recording | transcribing
  const rec = useRef(null);
  const timer = useRef(null);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    stopSpeaking(); // talking over the assistant interrupts it
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        clearTimeout(timer.current);
        stream.getTracks().forEach((t) => t.stop());
        if (!chunks.length) return setState("idle");
        setState("transcribing");
        try {
          const form = new FormData();
          const wav = await toWav(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
          form.append("audio", wav, "speech.wav");
          if (language && language !== "auto") form.append("language", language);
          const { text } = await upload("/voice/transcribe", form);
          if (text) onText(text);
          else onError("I couldn't hear anything. Try again closer to the microphone.");
        } catch (e) {
          onError(e.message);
        }
        setState("idle");
      };
      rec.current = mr;
      mr.start();
      timer.current = setTimeout(() => mr.state === "recording" && mr.stop(), MAX_SECONDS * 1000);
      setState("recording");
    } catch (e) {
      onError(e.name === "NotAllowedError" ? "Microphone access was blocked." : `Could not use the microphone: ${e.message}`);
      setState("idle");
    }
  }, [state, onText, onError, language]);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);
  return { state, start, stop };
}
