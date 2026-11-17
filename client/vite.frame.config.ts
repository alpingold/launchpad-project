/**
 * Builds the Game frame into dist/frame/v1/: index.html and frame.js, the only files the game
 * domain serves.
 *
 * frame.js is a classic script (an IIFE), because the frame's opaque origin can't load module
 * scripts. It carries the worker bootstrap, already built with the Engine into one script, as a
 * string (the virtual module below), and joins the Game's bundle onto it in the browser.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, defaultClientConditions, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const conditions = ["@boilergames/source", ...defaultClientConditions];
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const VIRTUAL = "virtual:frame-worker-source";

/** `import source from "virtual:frame-worker-source"`: the worker bootstrap and the Engine, built into one script, as text. */
function workerSource(): Plugin {
  return {
    name: "frame-worker-source",
    resolveId: (id) => (id === VIRTUAL ? `\0${VIRTUAL}` : undefined),
    async load(id) {
      if (id !== `\0${VIRTUAL}`) return undefined;
      const output = await build({
        configFile: false,
        logLevel: "warn",
        resolve: { conditions },
        build: {
          write: false,
          minify: true,
          lib: { entry: here("src/frame/worker.ts"), formats: ["iife"], name: "unused" },
        },
      });
      const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) => ("output" in o ? o.output : []));
      const code = chunks.find((c) => c.type === "chunk")?.code;
      if (code === undefined) throw new Error("building the worker bootstrap gave no script");
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

/** Copies the frame's page next to its script. */
function framePage(): Plugin {
  return {
    name: "frame-page",
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "index.html", source: await readFile(here("src/frame/index.html"), "utf8") });
    },
  };
}

export default defineConfig({
  plugins: [workerSource(), framePage()],
  resolve: { conditions },
  build: {
    outDir: "dist/frame/v1",
    emptyOutDir: true,
    minify: true,
    lib: { entry: here("src/frame/frame.ts"), formats: ["iife"], name: "unused", fileName: () => "frame.js" },
  },
});
