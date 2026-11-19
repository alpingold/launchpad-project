// A Creator on the real site, in each browser: signs in (the recorded link), uploads a Game, watches
// the real Playtest (in a child process) check it, plays it on a Screen, publishes it, and a stranger
// Hosts it. The Game is Best Word, the SDK's test Game, as a Creator would write it.
import type { BrowserContext, Page } from "@playwright/test";
import { BEST_WORD, BROKEN, NEWER, settles, signInFromMyGames, someone, uploadGame, versionLine } from "./creator-helpers.js";
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";
import { joinPhone, playToTheEnd, type Another } from "./site-helpers.js";

async function uploadVersion(page: Page, source: string, number: number): Promise<void> {
  await page.getByLabel("Or paste the code").fill(source);
  await page.getByRole("button", { name: "Upload this Version" }).click();
  await expect(versionLine(page, number)).toBeVisible();
}

/** A Screen, in `context`, opened at `path`, with its clock ours to move on when everyone waits. */
async function screenAt(context: BrowserContext, path: string): Promise<{ screen: Page; code: string }> {
  const screen = await context.newPage();
  await screen.clock.install();
  await screen.goto(`${APP}${path}`);
  const code = (await screen.getByLabel("Room Code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
  return { screen, code };
}

async function threePhones(another: Another, code: string): Promise<Page[]> {
  return [await joinPhone(another, code, "Ada"), await joinPhone(another, code, "Ben"), await joinPhone(another, code, "Cy")];
}

test("a Creator uploads Best Word, plays it from its page, then a broken Version 2 shows its problems and Version 1 still plays", async ({ context, another }, info) => {
  const { email, name } = someone(info.project.name);
  const page = context.pages()[0] ?? (await context.newPage());
  await signInFromMyGames(page, email, name);
  await expect(page.getByText("You haven't uploaded a Game yet.")).toBeVisible();
  // Beside Upload: how to write a Game with any AI (/make).
  await expect(page.getByRole("link", { name: "How to write a Game with any AI, or by hand" })).toHaveAttribute("href", "/make");

  await uploadGame(page, BEST_WORD);
  await expect(versionLine(page, 1)).toContainText("Being checked");
  await settles(page, 1, "Ready");
  await expect(page.getByRole("heading", { name: "Best Word" })).toBeVisible();

  // Play it: a Screen with a Room, offering this Version (in a new tab, so the page stays open).
  const playIt = versionLine(page, 1).getByRole("link", { name: "Play it" });
  await expect(playIt).toHaveAttribute("target", "_blank");
  const { screen, code } = await screenAt(context, (await playIt.getAttribute("href")) ?? "");
  await expect(screen.getByRole("region", { name: "Trying out" })).toContainText("Best Word");
  const phones = await threePhones(another, code);
  await screen.getByRole("region", { name: "Trying out" }).getByRole("button", { name: "Start Best Word" }).click();
  await expect(screen.locator(".screen-match .kit-view")).toBeVisible();
  await playToTheEnd(screen, phones);
  await expect(screen.locator(".page-notice")).toHaveText([]);
  await expect(screen.locator(".screen-result")).toContainText("Best Word: It finished.");

  // A broken Version 2: its problems, each with its stage and line. Version 1 is untouched.
  await uploadVersion(page, BROKEN, 2);
  await settles(page, 2, "Failed its check");
  const line = BROKEN.split("\n").findIndex((text) => text.startsWith("const broken")) + 1;
  await expect(versionLine(page, 2).getByRole("listitem")).toHaveText([`Type check, line ${line}: Type 'string' is not assignable to type 'number'.`]);
  await expect(versionLine(page, 2).getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(versionLine(page, 1)).toContainText("Ready");
  await screen.getByRole("region", { name: "Trying out" }).getByRole("button", { name: "Start Best Word" }).click();
  await expect(screen.locator(".screen-match .kit-view")).toBeVisible();
  await playToTheEnd(screen, phones);
  await expect(screen.locator(".screen-result")).toContainText("Best Word: It finished.");

  // My Games lists it: its title, not published, and its newest Version's state.
  await page.goto(`${APP}/my/games`);
  await expect(page.getByRole("listitem")).toHaveText([/Best Word\s*Not published\s*Version 2: failed its check/]);
});

test("published, a stranger Hosts it; a newer Version published mid-Match doesn't change that Match; unpublished, it is gone", async ({ context, another }, info) => {
  const { email, name } = someone(info.project.name);
  const page = context.pages()[0] ?? (await context.newPage());
  await signInFromMyGames(page, email, name);
  await uploadGame(page, BEST_WORD);
  await settles(page, 1, "Ready");
  await versionLine(page, 1).getByRole("button", { name: "Publish" }).click();
  await expect(versionLine(page, 1)).toContainText("Published");

  // A Host in another browser, signed out, sees it after the Official games, with its Creator's name.
  const hosts = await another("host");
  await hosts.clearCookies();
  const { screen, code } = await screenAt(hosts, "/screen");
  const games = screen.locator(".screen-games > li");
  const theirs = games.filter({ hasText: `Uploaded, by ${name}` });
  await expect(theirs).toContainText("Start Best Word");
  await expect(games.nth(0)).toContainText("Start Allotments");
  for (const at of [0, 1, 2]) await expect(games.nth(at)).not.toContainText("Uploaded");
  const phones = await threePhones(another, code);
  await theirs.getByRole("button", { name: "Start Best Word" }).click();
  await expect(screen.getByText("Write your best word", { exact: true })).toBeVisible();

  // Meanwhile, the Creator uploads a working Version 3 and publishes it.
  await uploadVersion(page, NEWER, 2);
  await settles(page, 2, "Ready");
  await versionLine(page, 2).getByRole("button", { name: "Publish" }).click();
  await expect(versionLine(page, 2)).toContainText("Published");

  // The Host reloads mid-Match: the same Match goes on, on the code it started with.
  await screen.reload();
  await expect(screen.locator(".screen-match .kit-view")).toBeVisible();
  await expect(screen.getByText("Write your best word", { exact: true })).toBeVisible();
  await playToTheEnd(screen, phones);
  await expect(screen.locator(".page-notice")).toHaveText([]);
  await expect(screen.locator(".screen-result")).toContainText("Best Word: It finished.");

  // Unpublished: gone from the list, and the code of each of its Versions refused to the signed-out Host.
  const versionIds = await page.getByRole("link", { name: "Play it" }).evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("play") ?? ""));
  expect(versionIds).toHaveLength(2);
  for (const id of versionIds) expect(await screen.evaluate(async (versionId) => (await fetch(`/api/games/${versionId}/bundle.js`)).status, id)).toBe(200);
  // A second Match, now on the newer Version, and the Creator unpublishes during it. The Host's
  // Screen has the code already and plays on; a reload can't fetch it any more, and says why.
  await theirs.getByRole("button", { name: "Start Best Word" }).click();
  await expect(screen.getByText("Write your best word, newer", { exact: true })).toBeVisible();
  await versionLine(page, 2).getByRole("button", { name: "Unpublish" }).click();
  await expect(versionLine(page, 2)).not.toContainText("Published");
  await screen.reload();
  await expect(screen.locator(".page-notice")).toHaveText(
    "This Game's code can't be loaded: it has been unpublished, or it's an unpublished Version and only its Creator, signed in on this browser, can play it.",
  );
  await expect(games.first()).toBeVisible();
  await expect(theirs).toHaveCount(0);
  for (const phone of phones) await expect(phone.getByText("Waiting for the Host to start a Game.")).toBeVisible();
  for (const id of versionIds) expect(await screen.evaluate(async (versionId) => (await fetch(`/api/games/${versionId}/bundle.js`)).status, id)).toBe(404);
});
