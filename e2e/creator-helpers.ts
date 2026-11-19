// What the browser tests of a Creator share: signing in from My Games, the test Game, and uploading.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures.js";
import { sentMail } from "./mail.js";
import { APP } from "./origins.js";

/** Best Word, importing the SDK by its name, with the default export a Game needs. */
export const BEST_WORD = `${readFileSync(new URL("../sdk/src/v1/best-word.fixture.ts", import.meta.url), "utf8").replace(`from "./index.js"`, `from "@boilergames/sdk/v1"`)}\nexport default bestWord;\n`;
/** Best Word with a type error on its last line. */
export const BROKEN = `${BEST_WORD}const broken: number = "three";\n`;
/** A newer Best Word whose Screen says so: a Screen showing it is playing Version 3's code. */
export const NEWER = BEST_WORD.replace('"Write your best word"', '"Write your best word, newer"');

/** An address and a name no other test or project has used: one database serves the whole run. */
export function someone(project: string): { email: string; name: string } {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { email: `c${project.replace(/[^a-z0-9]/g, "")}.${id}@purdue.edu`, name: `C ${id}` };
}

/**
 * Opens My Games signed out: the site sends the visitor to sign in, and once they have, with the
 * emailed link and a new display name, brings them back to My Games.
 */
export async function signInFromMyGames(page: Page, email: string, name: string): Promise<void> {
  await page.goto(`${APP}/my/games`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Purdue email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const sent = await sentMail();
  const link = /http:\S+/.exec(sent.filter((message) => message.to === email).at(-1)?.text ?? "")?.[0] ?? "";
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "My Games" })).toBeVisible();
}

/** The line for one Version on the Game's page. */
export const versionLine = (page: Page, number: number) => page.getByRole("listitem", { name: `Version ${number}` });

/** Waits for a Version's check to settle, as the page shows it by itself. The real Playtest takes about a second. */
export async function settles(page: Page, number: number, state: "Ready" | "Failed its check"): Promise<void> {
  await expect(versionLine(page, number)).toContainText(state, { timeout: 30_000 });
}

/** Uploads a new Game from My Games, and lands on its page. */
export async function uploadGame(page: Page, source: string): Promise<void> {
  await page.getByLabel("Or paste the code").fill(source);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(versionLine(page, 1)).toBeVisible();
}

