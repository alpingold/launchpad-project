/**
 * Where the SDK is, for the type check and the bundle. Two ways:
 *
 * - "source": the SDK's TypeScript (sdk/src). Development and tests use it, as the rest of the
 *   workspace does, so nothing needs building first.
 * - "built": the SDK's compiled output (sdk/dist: .js and .d.ts). A release has only this.
 *
 * Unless told, the Playtest uses the source if it is there, else the built output. The build checks
 * the built way on purpose (scripts/check-built.ts), since that is the one a release runs.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultClientConditions } from "vite";

export type SdkForm = "source" | "built";

/**
 * The sdk folder: a sibling of this package's, both in the workspace and in a release (which keeps
 * the same folders). The same path from src/ and from dist/, which both sit one folder down.
 */
export const SDK_FOLDER = fileURLToPath(new URL("../../sdk/", import.meta.url));

/** The one thing a Game may import. */
export const SDK_IMPORT = "@boilergames/sdk/v1";

export function sdkForm(asked?: SdkForm): SdkForm {
  if (asked !== undefined) return asked;
  return existsSync(`${SDK_FOLDER}src/v1/index.ts`) ? "source" : "built";
}

/** What tsc reads for `@boilergames/sdk/v1`. */
export function sdkTypes(form: SdkForm): string {
  return form === "source" ? `${SDK_FOLDER}src/v1/index.ts` : `${SDK_FOLDER}dist/v1/index.d.ts`;
}

/**
 * The export conditions Vite resolves the SDK with. "@boilergames/source" picks sdk/src (see
 * tsconfig.base.json); without it, the package's "default" picks sdk/dist.
 */
export function sdkConditions(form: SdkForm): string[] {
  return form === "source" ? ["@boilergames/source", ...defaultClientConditions] : [...defaultClientConditions];
}
