import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Lets the app be opened through a public tunnel address (see TUNNEL notes in .env.example), not only on localhost.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ts.net"],
    proxy: {
      "/v1": "http://localhost:4000",
      "/t/": "http://localhost:4000",
      "/u/": "http://localhost:4000",
    },
  },
});
