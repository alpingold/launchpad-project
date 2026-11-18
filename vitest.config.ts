import { defineConfig } from "vitest/config";

// The packages tested in Node (the Games run in a worker, but use nothing Node lacks). The client
// is its own project, set up in client/vite.config.ts.
const nodePackages = ["sdk", "protocol", "server", "games", "playtest"];

// Import the other packages' TypeScript source, never their built dist/ (see tsconfig.base.json).
const conditions = ["@boilergames/source", "module", "node", "development|production"];
// The server runs in plain Node, which never uses "module" (a bundler's condition): some packages
// (the AWS SDK) point it at files Node itself can't load. Its tests resolve as Node does.
const serverConditions = conditions.filter((condition) => condition !== "module");

// One command runs every package's tests: `npm test` at the root.
export default defineConfig({
  test: {
    projects: [
      ...nodePackages.map((name) => ({
        resolve: { conditions: name === "server" ? serverConditions : conditions },
        ssr: { resolve: { conditions: name === "server" ? serverConditions : conditions } },
        test: {
          name,
          root: name,
          include: ["src/**/*.test.ts"],
          // The Playtest's runner is started as a program, from its compiled dist/.
          ...(name === "playtest" ? { globalSetup: ["scripts/build-for-tests.ts"] } : {}),
        },
      })),
      "client",
    ],
  },
});
