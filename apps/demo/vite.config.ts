import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dgillard/cytoscape-compound-graph": path.resolve(
        __dirname,
        "../../packages/cytoscape-compound-graph/src/index.ts",
      ),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
