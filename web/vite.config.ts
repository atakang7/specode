import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@specode/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
