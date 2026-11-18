/**
 * Vitest's global setup for the playtest package: compiles it (and the SDK) to dist/ first. The
 * runner is a program of its own, started as a child process, and Node can't run this workspace's
 * TypeScript source directly (its imports name .js files). tsc -b redoes only what changed.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const built = spawnSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, "-b", "playtest/tsconfig.build.json"], { cwd: root, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`Building the playtest package for its tests failed:\n${built.stdout}${built.stderr}`);
}
