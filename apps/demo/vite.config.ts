import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dgillard/nested-cytoscope-vertex": path.resolve(
        __dirname,
        "../../packages/nested-cytoscope-vertex/src/index.ts",
      ),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
