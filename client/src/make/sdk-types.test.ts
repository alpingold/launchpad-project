// The SDK's types as the page shows them (sdk-v1.d.ts.txt): made from the SDK as it is now, and
// complete. They run TypeScript's compiler, so they get more time than a unit test usually needs.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { makeSdkTypes, SDK_TYPES_FILE, tsc } from "../../scripts/sdk-types.js";

const COMPILER = { timeout: 60_000 };
const OFFICIAL = ["allotments", "scribble-pick", "sum-it-up"];
const kept = () => readFileSync(SDK_TYPES_FILE, "utf8");

test("the text kept for the page is the SDK's as it is now (if not: npm run sdk-types -w @boilergames/client)", COMPILER, () => {
  expect(makeSdkTypes()).toBe(kept());
});

/**
 * Type-checks the Official games in a folder outside the workspace, where nothing else can resolve
 * `@boilergames/sdk/v1`: `declarations` is its only declaration. The Playtest's own strict settings.
 */
function checkOfficialGamesAgainst(declarations: string): void {
  const folder = mkdtempSync(join(tmpdir(), "sdk-types-games-"));
  try {
    for (const id of OFFICIAL) copyFileSync(fileURLToPath(new URL(`../../../games/src/${id}/index.ts`, import.meta.url)), join(folder, `${id}.ts`));
    writeFileSync(join(folder, "sdk-v1.d.ts"), declarations);
    writeFileSync(
      join(folder, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2024",
          lib: ["ES2024"],
          module: "preserve",
          moduleResolution: "bundler",
          types: [],
          strict: true,
          noUncheckedIndexedAccess: true,
          isolatedModules: true,
          verbatimModuleSyntax: true,
          noEmit: true,
          paths: { "@boilergames/sdk/v1": ["./sdk-v1.d.ts"] },
        },
        files: OFFICIAL.map((id) => `${id}.ts`),
      }),
    );
    tsc(["-p", join(folder, "tsconfig.json"), "--pretty", "false"], folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("the three Official games type-check with the page's text as the only declaration of @boilergames/sdk/v1: the text is complete", COMPILER, () => {
  expect(() => checkOfficialGamesAgainst(kept())).not.toThrow();
});

test("and the same check fails when the text declares nothing: it isn't finding the SDK some other way", COMPILER, () => {
  expect(() => checkOfficialGamesAgainst("export {};\n")).toThrow(/defineGame/);
});
