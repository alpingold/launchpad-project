// `npm run dev`: after a first build, tsc recompiles sdk, protocol and server whenever
// their source changes, and Node restarts the server whenever its compiled files change.
//
// `npm run dev -- --lan` also serves the site and the Game frame to other devices on the network
// (phones on the same Wi-Fi), at this computer's network address; `--lan=192.168.1.20` names the
// address to use, such as the Windows computer's when the server runs in WSL2 (see the README).
// Without the option the server answers only this computer.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.PORT ?? 3000);
const lanArg = process.argv.slice(2).find((arg) => arg === "--lan" || arg.startsWith("--lan="));

/** This computer's IPv4 addresses on its networks, the likely Wi-Fi or Ethernet one first. */
function networkAddresses() {
  const found = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) if (entry.family === "IPv4" && !entry.internal) found.push({ name, address: entry.address });
  }
  // Docker bridges and VPN tunnels aren't where phones are.
  const likely = (n) => (/^(eth|en|wl)/.test(n) ? 0 : /^(docker|br-|veth|tailscale|tun|utun)/.test(n) ? 2 : 1);
  return found.sort((a, b) => likely(a.name) - likely(b.name));
}

const env = { ...process.env };
if (lanArg !== undefined) {
  const candidates = networkAddresses();
  const address = lanArg.startsWith("--lan=") ? lanArg.slice("--lan=".length) : candidates[0]?.address;
  if (address === undefined || address === "") {
    console.error("No network address found. Name one: npm run dev -- --lan=192.168.1.20");
    process.exit(1);
  }
  // Every interface, so the address the phones use reaches the server (also through a port forward).
  env.HOST = "0.0.0.0";
  // Phones and the Screen must both use this address: the server accepts sockets only from it.
  env.SITE_ORIGIN = `http://${address}:${PORT}`;
  env.FRAME_URL = `http://${address}:${PORT + 1}/v1/`;
  console.log(
    [
      "",
      "  Serving to the network.",
      `  The Screen: open http://${address}:${PORT}/screen on this computer (this address, not localhost).`,
      `  Phones on the same Wi-Fi: open http://${address}:${PORT}/play`,
      "  Plain http from a network address isn't a secure context: the phones can't keep their screens awake.",
      `  This computer's addresses: ${candidates.map((c) => `${c.address} (${c.name})`).join(", ")}`,
      "",
    ].join("\n"),
  );
}

const children = [
  spawn("tsc", ["-b", "--watch", "--preserveWatchOutput", "tsconfig.build.json"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--watch", "server/dist/main.js"], { stdio: "inherit", env }),
];

// Stopping dev (Ctrl+C) stops both, and if either one dies the other is stopped too.
function stopAll() {
  for (const child of children) child.kill();
}
for (const child of children) child.on("exit", stopAll);
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
