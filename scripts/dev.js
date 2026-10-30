// `npm run dev`: after a first build, tsc recompiles shared, sdk, server and generator whenever
// their source changes, and Node restarts the server whenever its compiled files change.
import { spawn } from "node:child_process";

const children = [
  spawn("tsc", ["-b", "--watch", "--preserveWatchOutput", "tsconfig.build.json"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--watch", "server/dist/main.js"], { stdio: "inherit" }),
];

// Stopping dev (Ctrl+C) stops both, and if either one dies the other is stopped too.
function stopAll() {
  for (const child of children) child.kill();
}
for (const child of children) child.on("exit", stopAll);
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
