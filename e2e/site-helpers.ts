// What the browser tests of the real site share: opening a Screen, seating phones, playing, and
// measuring whether the Screen's View fits.
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "./fixtures.js";
import { APP } from "./origins.js";

/** Opens another browser: the `another` fixture. */
export type Another = (name: string, options?: object) => Promise<BrowserContext>;

export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };

/** Opens the Screen and returns it with its Room Code. Its clock is ours to move on when everyone waits. */
export async function openScreen(context: BrowserContext): Promise<{ screen: Page; code: string }> {
  const screen = context.pages()[0] ?? (await context.newPage());
  await screen.clock.install();
  await screen.goto(`${APP}/screen`);
  const code = (await screen.getByLabel("Room Code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
  return { screen, code };
}

/** A phone that joins the Room as `name`. */
export async function joinPhone(another: Another, code: string, name: string): Promise<Page> {
  const context = await another(name, PHONE);
  const phone = context.pages()[0] ?? (await context.newPage());
  await phone.goto(`${APP}/play`);
  await phone.getByLabel("Room Code").fill(code);
  await phone.getByLabel("Your name").fill(name);
  await phone.getByRole("button", { name: "Join" }).click();
  await expect(phone.getByRole("heading", { name: `You're in, ${name}` })).toBeVisible();
  return phone;
}

/**
 * Has `phone` do the first thing its Controller offers: type a word, draw a line, tap a picture's
 * shape, or press a button. False if it offers nothing.
 */
export async function actOnce(phone: Page): Promise<boolean> {
  const view = phone.locator(".kit-view");
  if ((await view.count()) === 0) return false;
  const input = view.locator(".kit-text-input input");
  if ((await input.count()) > 0) {
    await input.fill("lanterns");
    await view.locator(".kit-text-input button").click();
    return true;
  }
  const pad = view.locator(".kit-pad-surface");
  if ((await pad.count()) > 0) {
    const box = (await pad.boundingBox())!;
    await phone.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await phone.mouse.down();
    await phone.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 8 });
    await phone.mouse.up();
    await view.getByRole("button", { name: "Send" }).click();
    return true;
  }
  const shape = view.locator('svg [role="button"]');
  if ((await shape.count()) > 0) {
    await shape.first().click();
    return true;
  }
  const button = view.locator("button.kit-button:not([disabled])");
  if ((await button.count()) > 0) {
    await button.first().click();
    return true;
  }
  return false;
}

/**
 * When nobody can act, the Screen's clock runs on, a second at a time with a real pause between: a
 * jump of several seconds would also run out the two seconds the frame has to answer the timer.
 */
export async function waitOnTheScreen(screen: Page): Promise<void> {
  await screen.clock.runFor(1_000);
  await screen.waitForTimeout(60);
}

/** Plays until the Screen is back in the Lobby with a result. */
export async function playToTheEnd(screen: Page, phones: readonly Page[]): Promise<void> {
  for (let round = 0; round < 400; round++) {
    if ((await screen.locator(".screen-result").count()) > 0) return;
    let acted = false;
    for (const phone of phones) if (await actOnce(phone)) acted = true;
    await screen.waitForTimeout(150);
    if (!acted) await waitOnTheScreen(screen);
  }
  throw new Error("the Match didn't end");
}

/** Opens the Screen, seats these phones, and starts `title`. */
export async function startWith(context: BrowserContext, another: Another, names: readonly string[], title: string) {
  const { screen, code } = await openScreen(context);
  const phones: Page[] = [];
  for (const name of names) phones.push(await joinPhone(another, code, name));
  await screen.getByRole("button", { name: `Start ${title}` }).click();
  await expect(screen.locator(".screen-match .kit-view")).toBeVisible();
  for (const phone of phones) await expect(phone.locator(".kit-view")).toBeVisible();
  return { screen, code, phones };
}

/** A phone that joins during a Match: it may get a View at once, so no "You're in" check. */
export async function joinLate(another: Another, code: string, name: string): Promise<Page> {
  const context = await another(name, PHONE);
  const phone = context.pages()[0] ?? (await context.newPage());
  await phone.goto(`${APP}/play`);
  await phone.getByLabel("Room Code").fill(code);
  await phone.getByLabel("Your name").fill(name);
  await phone.getByRole("button", { name: "Join" }).click();
  return phone;
}


/** Draws a triangle on `phone`'s drawing pad. */
export async function scribble(phone: Page): Promise<void> {
  const box = (await phone.locator(".kit-pad-surface").boundingBox())!;
  const at = (x: number, y: number) => phone.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  await at(0.2, 0.75);
  await phone.mouse.down();
  await at(0.5, 0.2);
  await at(0.8, 0.75);
  await at(0.2, 0.75);
  await phone.mouse.up();
}

/** Sixteen characters each, the longest a name may be; the first comes twice, so one gets " (2)". */
export const LONG_NAMES = ["Alexandria Jones", "Bartholomew Ross", "Christopherson B", "Dorothea Marquez", "Evangeline Pratt", "Fitzgerald Moore", "Guinevere Holmes", "Alexandria Jones"];

/**
 * How the Screen's View sits in the window: every element that reaches outside the visible area
 * (the space above the Host's bar), the stage's scale, and the smallest text there in real pixels
 * (its CSS size times the scale; text inside a Game's pictures is left out, being the Game's).
 */
export async function fitReport(screen: Page): Promise<{ outside: string[]; scale: number; smallestTextPx: number; pictureHeightPx: number; spaceHeightPx: number }> {
  await screen.waitForTimeout(150);
  return screen.evaluate(() => {
    const space = document.querySelector(".screen-stage-space")!.getBoundingClientRect();
    const stage = document.querySelector<HTMLElement>(".screen-stage")!;
    const scale = Number(stage.dataset["scale"]);
    const outside: string[] = [];
    let smallestTextPx = Infinity;
    for (const element of stage.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.left < space.left - 0.5 || box.right > space.right + 0.5 || box.top < space.top - 0.5 || box.bottom > space.bottom + 0.5) {
        outside.push(`${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`);
      }
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
      if (hasText && element.closest("svg") === null) smallestTextPx = Math.min(smallestTextPx, parseFloat(getComputedStyle(element).fontSize) * scale);
    }
    // The tallest drawing or picture: what everyone is looking at, and what should shrink last.
    let pictureHeightPx = 0;
    for (const picture of stage.querySelectorAll(".kit-drawing svg, .kit-picture")) pictureHeightPx = Math.max(pictureHeightPx, picture.getBoundingClientRect().height);
    return { outside, scale, smallestTextPx: Math.round(smallestTextPx * 10) / 10, pictureHeightPx: Math.round(pictureHeightPx), spaceHeightPx: Math.round(space.height) };
  });
}
