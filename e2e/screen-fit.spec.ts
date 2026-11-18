// The Screen's View, fitted to the display by the site: at 1280x720 and 1920x1080, with the most Players
// and the longest names, nothing in any phase of the three Games reaches outside the visible area.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { actOnce, fitReport, joinPhone, LONG_NAMES, openScreen, scribble } from "./site-helpers.js";

/** At each size, the smallest text allowed, in real pixels: the busiest View (Scribble Pick's reveal) measured 14.4 to 16 at 720p and 22 to 24.4 at 1080p across the three browsers when this was written. */
const SIZES = [
  { name: "720p", width: 1280, height: 720, smallestTextPx: 14 },
  { name: "1080p", width: 1920, height: 1080, smallestTextPx: 21 },
] as const;

test("the Screen's View fits the window at 720p and 1080p, with 8 Players and the longest names, in every phase", async ({ context, another, profile }) => {
  // Nine browsers per run; in saved profiles that is nine browser processes, and a layout doesn't
  // depend on what a profile has stored.
  test.skip(profile === "saved", "a layout check: the fresh profiles cover it");
  test.setTimeout(240_000);
  const { screen, code } = await openScreen(context);
  const phones: Page[] = [];
  for (const name of LONG_NAMES) phones.push(await joinPhone(another, code, name));

  const smallest: Record<string, Record<string, number>> = {};
  const pictures: Record<string, Record<string, string>> = {};
  /** `pictureShare`: the least part of the height the View's drawing or picture must keep. */
  const fits = async (phase: string, pictureShare = 0) => {
    smallest[phase] = {};
    pictures[phase] = {};
    for (const size of SIZES) {
      await screen.setViewportSize({ width: size.width, height: size.height });
      const report = await fitReport(screen);
      expect(report.outside, `${phase} at ${size.name} (scale ${report.scale})`).toEqual([]);
      expect(report.smallestTextPx, `the smallest text in ${phase} at ${size.name}`).toBeGreaterThanOrEqual(size.smallestTextPx);
      smallest[phase]![size.name] = report.smallestTextPx;
      if (report.pictureHeightPx > 0) pictures[phase]![size.name] = `${report.pictureHeightPx} of ${report.spaceHeightPx} px`;
      expect(report.pictureHeightPx, `the drawing in ${phase} at ${size.name}`).toBeGreaterThanOrEqual(report.spaceHeightPx * pictureShare);
    }
  };

  // Sum It Up: writing, voting (seven 24-letter words each), the round's results.
  await screen.getByRole("button", { name: "Start Sum It Up" }).click();
  await expect(screen.getByText("Sum it up in one word")).toBeVisible();
  await fits("Sum It Up, writing");
  for (const [i, phone] of phones.entries()) {
    await phone.locator(".kit-text-input input").fill(`${"abcdefgh"[i]}extraordinarilywordyxyz`.slice(0, 24));
    await phone.locator(".kit-text-input button").click();
  }
  await expect(screen.getByText("Vote for the best word")).toBeVisible();
  await fits("Sum It Up, voting");
  for (const phone of phones) await actOnce(phone);
  await expect(screen.getByText("Votes so far")).toBeVisible();
  await fits("Sum It Up, results");
  await screen.getByRole("button", { name: "Stop" }).click();

  // Scribble Pick: drawing, picking, the reveal.
  await screen.getByRole("button", { name: "Start Scribble Pick" }).click();
  await expect(screen.getByText("Draw your secret word")).toBeVisible();
  await fits("Scribble Pick, drawing");
  for (const phone of phones) {
    await scribble(phone);
    await phone.getByRole("button", { name: "Send" }).click();
  }
  await expect(screen.getByText("What is it? Pick on your phone.")).toBeVisible();
  // The drawing everyone is looking at: the lists give up their place before it shrinks.
  await fits("Scribble Pick, picking", 0.55);
  for (const phone of phones) await actOnce(phone);
  await expect(screen.getByText(/^It was "/)).toBeVisible();
  await fits("Scribble Pick, reveal");
  await screen.getByRole("button", { name: "Stop" }).click();

  // Allotments holds 6: two leave first. A dozen turns in.
  for (const phone of phones.slice(6)) await phone.getByRole("button", { name: "Leave the Room" }).click();
  await screen.getByRole("button", { name: "Start Allotments" }).click();
  await expect(screen.getByText(/is choosing a plot/)).toBeVisible();
  for (let turn = 0; turn < 12; turn++) {
    for (const phone of phones.slice(0, 6)) if (await actOnce(phone)) break;
    await screen.waitForTimeout(100);
  }
  await fits("Allotments, a dozen turns in");

  console.log(`Drawing or picture height on the Screen:\n${Object.entries(pictures).filter(([, s]) => Object.keys(s).length > 0).map(([phase, sizes]) => `  ${phase}: ${Object.entries(sizes).map(([s, h]) => `${h} at ${s}`).join(", ")}`).join("\n")}`);
  console.log(`Smallest text on the Screen, in real pixels:\n${Object.entries(smallest).map(([phase, sizes]) => `  ${phase}: ${Object.entries(sizes).map(([s, px]) => `${px} px at ${s}`).join(", ")}`).join("\n")}`);
});
