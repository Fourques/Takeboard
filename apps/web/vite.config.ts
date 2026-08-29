import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // The Three.js engine is deliberately lazy-loaded. A separate budget check below
    // guards both initial resources and lazy chunks instead of relying on one generic warning.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-core",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: "canvas-engine",
              test: /node_modules[\\/](@xyflow|zustand)[\\/]/,
              priority: 20,
            },
            {
              name: "three-engine",
              test: /node_modules[\\/](@react-three|three)[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 48110,
    proxy: {
      "/api": process.env.TAKEBOARD_API_URL ?? "http://127.0.0.1:48120",
    },
  },
});
