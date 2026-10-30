import react from "@vitejs/plugin-react";
import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Import the other packages' TypeScript source, never their built dist/ (see tsconfig.base.json).
const source = "@boilergames/source";

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: [source, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] } },
  test: { name: "client", include: ["src/**/*.test.{ts,tsx}"] },
});
