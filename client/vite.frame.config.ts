/**
 * Builds the Game frame into dist-frame/v1/index.html: the one file the game domain serves. It goes
 * outside dist/ on purpose: the site serves dist/, and on the site's origin the frame's page would
 * have no CSP and no sandbox.
 *
 * The frame's script is built as a classic script (an IIFE) and written into the page, inline. The
 * frame server allows exactly that script by its hash (server/src/frame-origin.ts), so the page's
 * CSP can allow no script URL at all. The script carries the worker bootstrap, already built with
 * the Engine into one script, as a string (the virtual module below), and joins the Game's bundle
 * onto it in the browser.
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

/** The place in src/frame/index.html where the script goes. */
const MARKER = "<!-- frame script -->";

/** Writes the built script into the page, inline, and drops the separate script file. */
function framePage(): Plugin {
  return {
    name: "frame-page",
    async generateBundle(_options, bundle) {
      const chunk = bundle[SCRIPT];
      if (chunk === undefined || chunk.type !== "chunk") throw new Error(`the frame build made no ${SCRIPT}`);
      // Inside <script>, the HTML parser ends the script at "</script" and treats "<!--" specially.
      // The script is minified JavaScript with no reason to contain either; if it ever does, stop
      // rather than ship a page the browser reads differently from the server's hash.
      if (/<\/script|<!--/i.test(chunk.code)) throw new Error(`${SCRIPT} contains "</script" or "<!--", which can't go inside an inline script`);
      const template = await readFile(here("src/frame/index.html"), "utf8");
      if (template.split(MARKER).length !== 2) throw new Error(`src/frame/index.html must hold "${MARKER}" exactly once`);
      this.emitFile({ type: "asset", fileName: "index.html", source: template.replace(MARKER, () => `<script>${chunk.code}</script>`) });
      delete bundle[SCRIPT];
    },
  };
}

const SCRIPT = "frame.js";

export default defineConfig({
  plugins: [workerSource(), framePage()],
  resolve: { conditions },
  build: {
    outDir: "dist-frame/v1",
    emptyOutDir: true,
    minify: true,
    lib: { entry: here("src/frame/frame.ts"), formats: ["iife"], name: "unused", fileName: () => SCRIPT },
  },
});
