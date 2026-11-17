import { defineConfig } from "vitest/config";

// The packages that run in Node. The client is its own project, set up in client/vite.config.ts.
const nodePackages = ["sdk", "protocol", "server"];

// Import the other packages' TypeScript source, never their built dist/ (see tsconfig.base.json).
const conditions = ["@boilergames/source", "module", "node", "development|production"];

// One command runs every package's tests: `npm test` at the root.
export default defineConfig({
  test: {
    projects: [
      ...nodePackages.map((name) => ({
        resolve: { conditions },
        ssr: { resolve: { conditions } },
        test: { name, root: name, include: ["src/**/*.test.ts"] },
      })),
      "client",
    ],
  },
});
