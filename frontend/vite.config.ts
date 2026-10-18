/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 80, proxy: { "/api": "http://localhost:8000", "/ws": { target: "ws://localhost:8000", ws: true } } },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: [
        "src/lib/**/*.ts",
        "src/sessionState.ts",
        "src/services/api.ts",
        "src/services/theme.ts",
        "src/components/components.tsx",
      ],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 64,
        statements: 70,
      },
    },
  },
});
