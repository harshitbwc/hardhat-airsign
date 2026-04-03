import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4338,
    proxy: {
      "/socket.io": {
        target: "http://localhost:9090",
        ws: true,
      },
      "/api": {
        target: "http://localhost:9090",
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
