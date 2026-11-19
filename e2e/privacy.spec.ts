// The privacy page, in each browser: reached from every page's foot and from signing in, and
// readable at phone width. What it says was checked against the code (BUILD-PLAN Step 23).
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";
import { openScreen, PHONE } from "./site-helpers.js";

test("the privacy page is linked from the foot of the front page, the Screen's Lobby and a phone, and from signing in", async ({ context, another }) => {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(APP);
  await page.locator(".site-foot").getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "hello@boilergames.party" })).toHaveAttribute("href", "mailto:hello@boilergames.party");

  await page.goto(`${APP}/sign-in`);
  await expect(page.getByRole("link", { name: "the privacy page" })).toHaveAttribute("href", "/privacy");

  const { screen } = await openScreen(await another("screen"));
  await expect(screen.locator(".site-foot").getByRole("link", { name: "Privacy" })).toBeVisible();
  const phone = await (await another("phone", PHONE)).newPage();
  await phone.goto(`${APP}/play`);
  await expect(phone.locator(".site-foot").getByRole("link", { name: "Privacy" })).toBeVisible();
});

test("at phone width, the privacy page doesn't scroll sideways", async ({ another }) => {
  const phone = await (await another("narrow", PHONE)).newPage();
  await phone.goto(`${APP}/privacy`);
  await expect(phone.getByRole("heading", { name: "Having your account removed" })).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
