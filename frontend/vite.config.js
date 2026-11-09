import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI on :5173 and forwards API/WebSocket calls to the backend started with `npm run web` (port 3939).
const BACKEND = process.env.OMNIPILOT_BACKEND || "http://127.0.0.1:3939";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": BACKEND,
      "/bootstrap.json": BACKEND,
      "/socket.io": { target: BACKEND, ws: true },
    },
  },
});
