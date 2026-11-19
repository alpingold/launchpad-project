// The page for Creators' own AIs (/make), in each browser: the rules with the site's own limits,
// the prompt with the SDK's types and no example Game, and Copy. The clipboard itself isn't read:
// browsers allow that differently, so the test checks what the page says it did.
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";
import { PHONE } from "./site-helpers.js";

test("the rules quote the site's limits, and the prompt holds the rules, the SDK's types and a place for the idea", async ({ context }) => {
  const page = context.pages()[0] ?? (await context.newPage());
  const { limits } = (await (await page.request.get(`${APP}/api/config`)).json()) as { limits: { maxSourceBytes: number; uploadsPerHour: number } };
  await page.goto(`${APP}/make`);
  await expect(page.getByRole("heading", { name: "Write a Game with any AI, or by hand" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: `The file is at most ${limits.maxSourceBytes / 1024} KB` })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: `You can upload ${limits.uploadsPerHour} times an hour` })).toBeVisible();

  const prompt = page.getByRole("textbox", { name: "The prompt" });
  await expect(prompt).toHaveValue(/Its only import is "@boilergames\/sdk\/v1"/);
  await expect(prompt).toHaveValue(/export declare function defineGame</);
  await expect(prompt).toHaveValue(/My idea for the Game:\n\[Describe your Game here/);

  await page.getByRole("button", { name: "Copy the prompt" }).click();
  await expect(page.getByRole("status")).toHaveText(/^(Copied\.|It couldn't be copied here)/);

  await page.getByText("Show the types").click();
  await expect(page.locator(".make-types")).toContainText("export interface ButtonPart<Action>");
});

test("at phone width, the page doesn't scroll sideways: the types scroll inside their box", async ({ another }) => {
  const page = await (await another("narrow", PHONE)).newPage();
  await page.goto(`${APP}/make`);
  await expect(page.getByRole("textbox", { name: "The prompt" })).toBeVisible();
  await page.getByText("Show the types").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
