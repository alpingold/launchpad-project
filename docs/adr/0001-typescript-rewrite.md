# Rewrite in TypeScript, compiled with tsc

Decided 2026-10-30, reversing "TypeScript: not now" (old plan, 2026-10-15). BoilerGames is
rewritten from scratch in TypeScript, with the whole design open to change, rather than converted
file by file. The 2026-10-15 trial of TypeScript's checker found about 20 places where the JSDoc
comments had drifted from the code. Types can't drift silently, because CI fails. The owner now
knows the language well enough to want all of it.

## Considered options

- **Gradual conversion, keeping `main` deployable:** safer, but it keeps the old design. Rejected
  because the rewrite is also a redesign.
- **Run `.ts` directly with Node 24's type stripping (no build step):** simpler to deploy, but it
  allows only the TypeScript that can simply be deleted (no `enum`, `namespace` or parameter
  properties). Rejected because we want the whole language. `tsc` compiles to JavaScript for the
  server; Vite builds the client, the Game frame's page and the Game bundles.
- **Build scripts are the exception (2026-11-17).** A script that only builds something (the
  Official games' build, `games/scripts/build.ts`) runs as `.ts` directly with Node's type
  stripping, on a developer's machine and in CI, and keeps to the TypeScript that allows. The
  server never does: it still runs the output `tsc` compiled.

## Consequences

- Deploy (`update.sh`) and CI gain a build step.
- Types are checked when the code is built, never while it runs. Data from outside (socket
  messages, uploads, the model's replies) still needs checking at runtime.
- Games are TypeScript too, written against the SDK's types; strict `tsc` is the first Playtest
  step for generated and uploaded games alike (ADR 0003).
