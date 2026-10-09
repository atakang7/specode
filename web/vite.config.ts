import { defineConfig } from "vite";
import path from "node:path";

const ollamaProxy = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    changeOrigin: true,
    rewrite: (requestPath: string) => requestPath.replace(/^\/ollama/, ""),
  },
};

export default defineConfig({
  resolve: {
    alias: { "@specode/core": path.resolve(__dirname, "../core/src/index.ts") },
  },
  server: { proxy: ollamaProxy },
  preview: { proxy: ollamaProxy },
});
