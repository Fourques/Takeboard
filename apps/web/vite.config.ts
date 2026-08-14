import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 48110,
    proxy: {
      "/api": process.env.TAKEBOARD_API_URL ?? "http://127.0.0.1:48120",
    },
  },
});
