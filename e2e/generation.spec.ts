// The site's AI maker, in each browser, against the development fake (nothing leaves this machine)
// and the real Playtest in a child process: an idea to a Concept, edited and approved, to a Game
// that is published and says AI-made in the Library; and a failed Generation with its reason. At
// phone width, with no page scrolling sideways.
import type { Page } from "@playwright/test";
import { FAKE_FAIL } from "../server/src/generations/dev-fake.js";
import { signInFromMyGames, someone, versionLine } from "./creator-helpers.js";
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";

const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** Saves a key from My Games, and comes back. */
async function saveAKey(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Your GenAI Studio key" }).click();
  await page.getByLabel("GenAI Studio key").fill(`sk-e2e-${Date.now().toString(36)}-MAKE`);
  await page.getByRole("button", { name: "Save the key" }).click();
  await expect(page.getByText("Your key ending in MAKE is saved.")).toBeVisible();
  await page.getByRole("link", { name: "My Games" }).click();
}

/** From My Games: describes an idea and lands on its Generation's page. */
async function makeFromIdea(page: Page, idea: string): Promise<void> {
  await page.getByRole("link", { name: "Describe an idea" }).click();
  await expect(page.getByRole("heading", { name: "Make a Game with the AI" })).toBeVisible();
  await page.getByLabel("Your idea").fill(idea);
  expect(await scrollsSideways(page)).toBe(false);
  await page.getByRole("button", { name: "Make it" }).click();
  await expect(page).toHaveURL(/\/my\/generations\/[^/]+$/);
}

test("an idea becomes a Concept, edited and approved, then a Game that is published as AI-made", async ({ context }, info) => {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 390, height: 844 });
  const { email, name } = someone(info.project.name);
  await signInFromMyGames(page, email, name);
  await saveAKey(page);
  await makeFromIdea(page, "A game where everyone taps their phone, and then votes.");

  // The fake drafts at once; the page asks again until the Concept is there to read.
  await expect(page.getByRole("status")).toHaveText("Waiting on you: read the Concept, change it if you like, and approve it.", { timeout: 15_000 });
  await expect(page.getByLabel("Title")).toHaveValue("Tap Vote");
  await expect(page.getByRole("group", { name: "Phase 2 (vote)" })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);

  const title = `Taps ${name.slice(2)}`;
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Approve and make the Game" }).click();
  // The real Playtest checks the Game: a second or two, and the page asks every few seconds.
  await expect(page.getByRole("status")).toHaveText("Ready: the Game passed its check.", { timeout: 60_000 });
  await expect(page.getByRole("listitem", { name: "Step 1" })).toContainText("Drafting the Concept: a usable Concept");
  await expect(page.getByRole("listitem", { name: "Step 3" })).toContainText("Checking the Game: passed");
  expect(await scrollsSideways(page)).toBe(false);

  // A Game like any other on My Games: its title is the edited one, and it can be published.
  await page.getByRole("link", { name: "Go to the Game" }).click();
  await versionLine(page, 1).getByRole("button", { name: "Publish" }).click();
  await expect(versionLine(page, 1)).toContainText("Published");
  await page.goto(`${APP}/library`);
  const card = page.getByRole("listitem", { name: title });
  await expect(card).toContainText("AI-made");
  await card.getByRole("link", { name: title }).click();
  await expect(page.getByText(`AI-made by ${name}`)).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
});

test("a Generation that fails says why, and leaves no Game", async ({ context }, info) => {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 390, height: 844 });
  const { email, name } = someone(info.project.name);
  await signInFromMyGames(page, email, name);
  await saveAKey(page);
  await makeFromIdea(page, `A game the fake can't design ${FAKE_FAIL}`);
  await expect(page.getByRole("status")).toContainText("Failed. The AI couldn't write a usable Concept in 3 tries.", { timeout: 15_000 });
  await expect(page.getByRole("listitem", { name: "Step 3" })).toContainText("Drafting the Concept: not usable");
  expect(await scrollsSideways(page)).toBe(false);
  await page.getByRole("link", { name: "My Games" }).click();
  await expect(page.getByText("You haven't uploaded a Game yet.")).toBeVisible();
  await expect(page.getByRole("listitem")).toContainText(["failed"]);
});
