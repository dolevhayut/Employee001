import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Evals call real models and cost money: kept out of `npm test` and CI.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "server-only": resolve(import.meta.dirname, "./test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
