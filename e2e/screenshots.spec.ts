// Screenshots of the site for the owner, not a test: the Lobby, and each Official game mid-Match on
// the Screen and on a phone, in each Game's own Look and in the site's default Look. Runs only when
// asked: SCREENSHOTS=1 npx playwright test -c e2e/playwright.config.ts screenshots --project=chromium
// The pictures go to .scratch/rewrite/screenshots/ (kept out of git).
import type { BrowserContext, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";

const OUT = fileURLToPath(new URL("../.scratch/rewrite/screenshots/", import.meta.url));
const SCREEN = { viewport: { width: 1280, height: 720 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 };

test.skip(process.env["SCREENSHOTS"] !== "1", "only when asked: SCREENSHOTS=1");

async function shoot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}${name}.png` });
}

/** The Screen, optionally with every Game's Look taken out of /api/games, so the site's default is used. */
async function openScreen(another: (name: string, options?: object) => Promise<BrowserContext>, look: "own" | "default"): Promise<{ screen: Page; code: string }> {
  const context = await another(`screen-${look}`, SCREEN);
  const screen = context.pages()[0] ?? (await context.newPage());
  if (look === "default") {
    await screen.route("**/api/games", async (route) => {
      const listing = (await (await route.fetch()).json()) as { look?: unknown }[];
      await route.fulfill({ json: listing.map(({ look: _look, ...rest }) => rest) });
    });
  }
  await screen.goto(`${APP}/screen`);
  const code = ((await screen.getByLabel("Room Code").textContent()) ?? "").trim();
  return { screen, code };
}

async function join(another: (name: string, options?: object) => Promise<BrowserContext>, code: string, name: string, look: string): Promise<Page> {
  const context = await another(`${name}-${look}`, PHONE);
  const phone = context.pages()[0] ?? (await context.newPage());
  await phone.goto(`${APP}/play`);
  await phone.getByLabel("Room Code").fill(code);
  await phone.getByLabel("Your name").fill(name);
  await phone.getByRole("button", { name: "Join" }).click();
  await expect(phone.getByRole("heading", { name: `You're in, ${name}` })).toBeVisible();
  return phone;
}

async function scribble(phone: Page): Promise<void> {
  const box = (await phone.locator(".kit-pad-surface").boundingBox())!;
  const at = (x: number, y: number) => phone.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  await at(0.2, 0.75);
  await phone.mouse.down();
  await at(0.5, 0.2);
  await at(0.8, 0.75);
  await at(0.2, 0.75);
  await phone.mouse.up();
}

for (const look of ["own", "default"] as const) {
  test(`screenshots, ${look} Look`, async ({ another }) => {
    test.setTimeout(180_000);
    const { screen, code } = await openScreen(another, look);
    const [ada, ben, cy] = [await join(another, code, "Ada", look), await join(another, code, "Ben", look), await join(another, code, "Cy", look)];
    if (look === "own") {
      await shoot(screen, "lobby-screen");
      await shoot(ada!, "lobby-phone");
    }

    // Sum It Up: writing, then voting.
    await screen.getByRole("button", { name: "Start Sum It Up" }).click();
    await expect(ben!.locator(".kit-text-input")).toBeVisible();
    await ada!.locator(".kit-text-input input").fill("soggy");
    await ada!.locator(".kit-text-input button").click();
    await shoot(screen, `sum-it-up-${look}-screen-writing`);
    await ben!.locator(".kit-text-input input").fill("regret");
    await shoot(ben!, `sum-it-up-${look}-phone-writing`);
    await ben!.locator(".kit-text-input button").click();
    await cy!.locator(".kit-text-input input").fill("perfection");
    await cy!.locator(".kit-text-input button").click();
    await expect(ada!.locator(".kit-row")).toBeVisible();
    await shoot(screen, `sum-it-up-${look}-screen-voting`);
    await shoot(ada!, `sum-it-up-${look}-phone-voting`);
    await screen.getByRole("button", { name: "Stop" }).click();

    // Scribble Pick: drawing, then picking.
    await screen.getByRole("button", { name: "Start Scribble Pick" }).click();
    await expect(ada!.locator(".kit-pad")).toBeVisible();
    await scribble(ada!);
    await shoot(ada!, `scribble-pick-${look}-phone-drawing`);
    await shoot(screen, `scribble-pick-${look}-screen-drawing`);
    for (const phone of [ada!, ben!, cy!]) {
      if ((await phone.locator(".kit-pad").count()) === 0) continue;
      await scribble(phone);
      await phone.getByRole("button", { name: "Send" }).click();
    }
    await expect(screen.locator(".kit-drawing")).toBeVisible();
    await shoot(screen, `scribble-pick-${look}-screen-picking`);
    for (const phone of [ada!, ben!, cy!]) {
      if ((await phone.locator(".kit-row").count()) > 0) {
        await shoot(phone, `scribble-pick-${look}-phone-picking`);
        break;
      }
    }
    await screen.getByRole("button", { name: "Stop" }).click();

    // Allotments: a few turns in.
    await screen.getByRole("button", { name: "Start Allotments" }).click();
    for (let turn = 0; turn < 7; turn++) {
      for (const phone of [ada!, ben!, cy!]) {
        const plot = phone.locator('.kit-picture [role="button"]');
        if ((await plot.count()) > 0) {
          await plot.nth((turn * 5) % (await plot.count())).click();
          await screen.waitForTimeout(150);
          break;
        }
      }
    }
    await shoot(screen, `allotments-${look}-screen`);
    for (const phone of [ada!, ben!, cy!]) {
      if ((await phone.locator('.kit-picture [role="button"]').count()) > 0) {
        await shoot(phone, `allotments-${look}-phone-your-turn`);
      } else {
        await shoot(phone, `allotments-${look}-phone-waiting`);
      }
    }
    await screen.getByRole("button", { name: "Stop" }).click();
    if (look === "own") await shoot(screen, "lobby-screen-after-a-match");
  });
}
