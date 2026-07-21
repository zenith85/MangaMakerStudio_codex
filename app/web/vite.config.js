import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind 0.0.0.0, not just localhost, so other devices on the network can reach this
    proxy: {
      "/api": "http://localhost:8787",
      "/uploads": "http://localhost:8787",
      "/projects": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
});
