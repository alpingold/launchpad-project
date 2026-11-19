// The Library on the real site, in each browser: a Creator publishes two Games, and a stranger,
// signed out, finds them by searching, filters and sorts them, opens one's page and hosts it from
// there. One database serves the whole run, so every check is scoped to this test's own Games.
import type { BrowserContext, Page } from "@playwright/test";
import { BEST_WORD, settles, uploadGame, versionLine } from "./creator-helpers.js";
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";
import { joinPhone, PHONE, type Another } from "./site-helpers.js";

/** Best Word under another title and Player count: a Game of this test's own. */
function bestWordAs(title: string, players: { min: number; max: number }): string {
  return BEST_WORD.replace('title: "Best Word"', `title: ${JSON.stringify(title)}`).replace("players: { min: 3, max: 8 }", `players: { min: ${players.min}, max: ${players.max} }`);
}

/** From My Games: uploads a Game, waits for its check, gives it a description and publishes it. Returns its Game id. */
async function publishGame(page: Page, source: string, description: string): Promise<string> {
  await page.goto(`${APP}/my/games`);
  await uploadGame(page, source);
  await settles(page, 1, "Ready");
  await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Save the description" }).click();
  await expect(page.getByRole("button", { name: "Save the description" })).toBeDisabled();
  await versionLine(page, 1).getByRole("button", { name: "Publish" }).click();
  await expect(versionLine(page, 1)).toContainText("Published");
  return decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1) ?? "");
}

/** The titles of the cards the Library shows now, in order. */
const cardTitles = (page: Page) => page.locator(".library-card h2");

async function hostWithPhones(screen: Page, another: Another, title: string): Promise<void> {
  const code = (await screen.getByLabel("Room Code").textContent())?.trim() ?? "";
  for (const name of ["Ada", "Ben", "Cy"]) await joinPhone(another, code, name);
  await screen.getByRole("region", { name: "Chosen" }).getByRole("button", { name: `Start ${title}` }).click();
  await expect(screen.locator(".screen-match .kit-view")).toBeVisible();
}

/** A word no other test has used: one database serves the whole run, and the account is shared. */
const freshTag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Whether the page is wider than the window: something that doesn't wrap. */
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test("a stranger searches the Library, filters and sorts it, opens a Game's page and hosts it from there", async ({ context, another, signedIn }) => {
  const { name } = signedIn;
  const tag = freshTag();
  await context.addCookies(signedIn.cookies);
  const creator = context.pages()[0] ?? (await context.newPage());
  // Aster first, so Zinnia is the newer.
  const asterId = await publishGame(creator, bestWordAs(`Aster ${tag}`, { min: 3, max: 4 }), `A small garden game, ${tag}.`);
  const zinniaId = await publishGame(creator, bestWordAs(`Zinnia ${tag}`, { min: 3, max: 8 }), `A bigger garden game, ${tag}.`);
  // The Creator's page links to the Game's public page.
  await expect(creator.getByRole("link", { name: "Its page in the Library" })).toHaveAttribute("href", `/library/${zinniaId}`);

  const stranger: BrowserContext = await another("stranger");
  await stranger.clearCookies();
  const page = await stranger.newPage();
  await page.goto(`${APP}/`);
  await page.getByRole("link", { name: "Browse the Library" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  // The Official games are there for everyone.
  await expect(page.getByRole("listitem", { name: "Allotments", exact: true })).toContainText("Official");

  // Search finds both by a word in their descriptions, and only them.
  await page.getByLabel("Search").fill(`garden ${tag}`);
  await expect(cardTitles(page)).toHaveText([`Aster ${tag}`, `Zinnia ${tag}`]);
  await expect(page.getByRole("listitem", { name: `Zinnia ${tag}` })).toContainText(`3 to 8 players`);
  await expect(page.getByRole("listitem", { name: `Zinnia ${tag}` })).toContainText(`by ${name}`);
  await expect(page.getByRole("listitem", { name: `Zinnia ${tag}` })).toContainText("Not played yet");

  // Sorting: newest puts Zinnia first; A–Z puts it back; most played (both unplayed) goes by title.
  await page.getByLabel("Sort by").selectOption({ label: "Newest" });
  await expect(cardTitles(page)).toHaveText([`Zinnia ${tag}`, `Aster ${tag}`]);
  await page.getByLabel("Sort by").selectOption({ label: "Most played" });
  await expect(cardTitles(page)).toHaveText([`Aster ${tag}`, `Zinnia ${tag}`]);
  await page.getByLabel("Sort by").selectOption({ label: "A–Z" });
  await expect(cardTitles(page)).toHaveText([`Aster ${tag}`, `Zinnia ${tag}`]);

  // Six people: Aster takes at most 4.
  await page.getByLabel("How many of you are there?").selectOption("6");
  await expect(cardTitles(page)).toHaveText([`Zinnia ${tag}`]);
  await page.getByLabel("How many of you are there?").selectOption("4");
  await expect(cardTitles(page)).toHaveText([`Aster ${tag}`, `Zinnia ${tag}`]);

  // A Game's page, by its Game id.
  await page.getByRole("link", { name: `Zinnia ${tag}` }).click();
  await expect(page).toHaveURL(`${APP}/library/${zinniaId}`);
  await expect(page.getByRole("heading", { name: `Zinnia ${tag}` })).toBeVisible();
  await expect(page.getByText(`A bigger garden game, ${tag}.`)).toBeVisible();
  await expect(page.getByText(`Uploaded by ${name}`)).toBeVisible();
  await expect(page.getByText("3 to 8 players")).toBeVisible();
  await expect(page.getByText("Not played yet")).toBeVisible();

  // Host this Game: a Screen with a Room, offering it to anyone (not as a Creator's private try).
  await page.clock.install();
  await page.getByRole("link", { name: "Host this Game" }).click();
  await expect(page.getByRole("region", { name: "Chosen" })).toContainText(`Zinnia ${tag}`);
  await expect(page.getByRole("region", { name: "Trying out" })).toHaveCount(0);
  await hostWithPhones(page, another, `Zinnia ${tag}`);
  expect(asterId).not.toBe(zinniaId);
});

test("an Official game's page, and hosting it from there", async ({ context, another }) => {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${APP}/library/sum-it-up`);
  await expect(page.getByRole("heading", { name: "Sum It Up" })).toBeVisible();
  await expect(page.getByText("An Official game, made by BoilerGames")).toBeVisible();
  await expect(page.getByText(/everyone sums it up in one word/)).toBeVisible();
  await page.clock.install();
  await page.getByRole("link", { name: "Host this Game" }).click();
  await hostWithPhones(page, another, "Sum It Up");
});

test("a Game nobody can see has no page: the same answer as one that never existed", async ({ context }) => {
  const page = context.pages()[0] ?? (await context.newPage());
  for (const id of ["no-such-game", "x".repeat(22)]) {
    await page.goto(`${APP}/library/${id}`);
    await expect(page.getByRole("alert")).toHaveText("There's no such Game in the Library. It may have been unpublished.");
  }
});

test("at phone width, a long title and a description with no spaces wrap instead of widening the page", async ({ context, another, signedIn }) => {
  const tag = freshTag();
  await context.addCookies(signedIn.cookies);
  const creator = context.pages()[0] ?? (await context.newPage());
  const title = `W${tag}${"W".repeat(60)}`.slice(0, 60);
  const id = await publishGame(creator, bestWordAs(title, { min: 3, max: 8 }), `${tag}${"m".repeat(280)}`);

  const phone = await (await another("narrow", PHONE)).newPage();
  await phone.goto(`${APP}/library`);
  await phone.getByLabel("Search").fill(tag);
  await expect(cardTitles(phone)).toHaveText([title]);
  expect(await scrollsSideways(phone)).toBe(false);
  await phone.goto(`${APP}/library/${id}`);
  await expect(phone.getByRole("heading", { name: title })).toBeVisible();
  await expect(phone.getByRole("link", { name: "Host this Game" })).toBeInViewport();
  expect(await scrollsSideways(phone)).toBe(false);
});
