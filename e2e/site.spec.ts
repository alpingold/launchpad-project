// The real site, end to end: one Screen and phones in separate browsers, over the real server,
// the real Game frame and the built Official games.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";
import { actOnce, joinLate, joinPhone, openScreen, playToTheEnd, scribble, startWith, waitOnTheScreen } from "./site-helpers.js";

for (const [id, title] of [
  ["sum-it-up", "Sum It Up"],
  ["scribble-pick", "Scribble Pick"],
  ["allotments", "Allotments"],
] as const) {
  test(`plays ${title} to its end with one Screen and three phones`, async ({ context, another }) => {
    const { screen, code } = await openScreen(context);
    const phones = [await joinPhone(another, code, "Ada"), await joinPhone(another, code, "Ben"), await joinPhone(another, code, "Cy")];
    await screen.getByRole("button", { name: `Start ${title}` }).click();
    await expect(screen.locator(".screen-match .kit-view")).toBeVisible();
    await playToTheEnd(screen, phones);
    await expect(screen.locator(".page-notice")).toHaveText([]);
    await expect(screen.locator(".screen-result")).toContainText(`${title}: It finished.`);
    // The Official games end with scores only: the top score wins.
    await expect(screen.locator(".screen-result")).toContainText("Won by");
    for (const phone of phones) await expect(phone.getByText("Waiting for the Host to start a Game.")).toBeVisible();
  });
}

test("the Screen reloads mid-Match and the Match carries on", async ({ context, another }) => {
  const { screen, phones } = await startWith(context, another, ["Ada", "Ben", "Cy"], "Sum It Up");
  await actOnce(phones[0]!);
  await expect(phones[0]!.getByText('You wrote "lanterns". Waiting for the others.')).toBeVisible();
  await screen.reload();
  // Back with the same Room and the same Match: the Screen's View, and Ada still done.
  await expect(screen.locator(".screen-match .kit-view")).toBeVisible();
  await expect(screen.locator(".kit-players li").first()).toHaveAttribute("data-mark", "done");
  await expect(phones[0]!.getByText('You wrote "lanterns"')).toBeVisible();
  await playToTheEnd(screen, phones);
  await expect(screen.locator(".page-notice")).toHaveText([]);
  await expect(screen.locator(".screen-result")).toContainText("Sum It Up: It finished.");
});

test("a phone reloads and keeps its Seat and its View", async ({ context, another }) => {
  const { screen, phones } = await startWith(context, another, ["Ada", "Ben", "Cy"], "Scribble Pick");
  const ben = phones[1]!;
  const secret = await ben.locator(".kit-text[data-tone=accent]").textContent();
  expect(secret).toMatch(/^Draw: /);
  await ben.reload();
  await expect(ben.locator(".kit-text[data-tone=accent]")).toHaveText(secret!);
  await expect(screen.locator(".kit-players li")).toHaveCount(3);
  await playToTheEnd(screen, phones);
  await expect(screen.locator(".screen-result")).toContainText("Scribble Pick: It finished.");
});

test("the Host removes a Player: their phone is told, and the Seat is gone", async ({ context, another }) => {
  const { screen, code } = await openScreen(context);
  await joinPhone(another, code, "Ada");
  const ben = await joinPhone(another, code, "Ben");
  await screen.getByRole("button", { name: "Remove Ben" }).click();
  await expect(ben.getByText("The Host removed you from the Room.")).toBeVisible();
  await expect(screen.locator(".screen-seats li")).toHaveCount(1);
});

test("a latecomer plays at once in a Game that takes them, and waits for the next Match in one that doesn't", async ({ context, another }) => {
  const { screen, code, phones } = await startWith(context, another, ["Ada", "Ben"], "Allotments");
  await actOnce(phones[0]!);
  // Allotments takes late joiners: Dee gets the board, and a colour of her own.
  const dee = await joinLate(another, code, "Dee");
  await expect(dee.locator(".kit-picture")).toBeVisible();
  await expect(dee.getByText(/Your plots are the \w+ ones\./)).toBeVisible();
  for (let round = 0; round < 400 && (await screen.locator(".screen-result").count()) === 0; round++) {
    let acted = false;
    for (const phone of [...phones, dee]) if (await actOnce(phone)) acted = true;
    await screen.waitForTimeout(100);
    if (!acted) await waitOnTheScreen(screen);
  }
  await expect(screen.locator(".screen-result")).toContainText("Allotments: It finished.");
  // Dee's score is her biggest patch: at least 1 means she had turns and claimed plots.
  await expect(screen.locator(".screen-result")).toContainText(/Dee: [1-9]/);

  // Scribble Pick doesn't: Eve waits for the next Match.
  await screen.getByRole("button", { name: "Start Scribble Pick" }).click();
  await expect(dee.locator(".kit-pad")).toBeVisible();
  const eve = await joinLate(another, code, "Eve");
  await expect(eve.getByText("You're in from the next Match. Scribble Pick is on now.")).toBeVisible();
  await expect(eve.locator(".kit-view")).toHaveCount(0);
});

test("the Host stops a Match: everyone is back in the Lobby, and the Screen says it was stopped", async ({ context, another }) => {
  const { screen, phones } = await startWith(context, another, ["Ada", "Ben", "Cy"], "Sum It Up");
  await screen.getByRole("button", { name: "Stop" }).click();
  await expect(screen.locator(".screen-result")).toContainText("Sum It Up: The Host stopped it.");
  for (const phone of phones) await expect(phone.getByText("Waiting for the Host to start a Game.")).toBeVisible();
});

test("a second tab taking a phone's Seat: the first says so and doesn't take it back", async ({ context, another }) => {
  const { code } = await openScreen(context);
  const ada = await joinPhone(another, code, "Ada");
  const second = await ada.context().newPage();
  await second.goto(`${APP}/play`);
  await expect(second.getByRole("heading", { name: "You're in, Ada" })).toBeVisible();
  await expect(ada.getByText("Your Seat is open in another tab or on another device.")).toBeVisible();
  await ada.waitForTimeout(1_500);
  await expect(second.getByRole("heading", { name: "You're in, Ada" })).toBeVisible();
});

test("the Screen's socket drops mid-Match and comes back: phones catch up, newcomers are seen, and a Match stopped meanwhile ends for everyone", async ({ context, another }) => {
  // The Screen's socket goes through here, so the test can cut it and keep it cut.
  let cut = false;
  const routes: { close(): Promise<void> }[] = [];
  const screenPage = context.pages()[0] ?? (await context.newPage());
  await screenPage.routeWebSocket(/\/ws$/, async (ws) => {
    if (cut) return void (await ws.close());
    const server = ws.connectToServer();
    routes.push({ close: async () => (await ws.close(), await server.close()) });
  });
  const { screen, code, phones } = await startWith(context, another, ["Ada", "Ben", "Cy"], "Sum It Up");
  expect(screen).toBe(screenPage);
  const cutTheScreen = async () => {
    cut = true;
    for (const route of routes.splice(0)) await route.close();
    await expect(screen.getByText("Reconnecting…")).toBeVisible();
  };

  // Two words in, then down while the writing time runs out: the voting Views are made but can't be sent.
  await actOnce(phones[0]!);
  await actOnce(phones[1]!);
  await expect(phones[1]!.getByText('You wrote "lanterns". Waiting for the others.')).toBeVisible();
  await cutTheScreen();
  for (let s = 0; s < 46; s++) await waitOnTheScreen(screen);
  // A newcomer while the Screen is away: Sum It Up takes latecomers.
  const dee = await joinLate(another, code, "Dee");
  cut = false;
  await expect(screen.getByText("Reconnecting…")).toHaveCount(0, { timeout: 15_000 });
  for (const phone of phones) await expect(phone.locator(".kit-row").first()).toBeVisible();
  await expect(dee.locator(".kit-view")).toBeVisible();

  // Down when the Host stops the Match: the end reaches the server once the socket is back.
  await cutTheScreen();
  await screen.getByRole("button", { name: "Stop" }).click();
  cut = false;
  for (const phone of [...phones, dee]) await expect(phone.getByText("Waiting for the Host to start a Game.")).toBeVisible({ timeout: 15_000 });
});

test("a phone that sends too much at once is told to slow down, and keeps its Seat and its View", async ({ context, another }) => {
  const { phones } = await startWith(context, another, ["Ada", "Ben", "Cy"], "Sum It Up");
  const ada = phones[0]!;
  // Ada's page, sending 25 actions in one go through its own socket.
  const server: { send(message: string): void }[] = [];
  await ada.routeWebSocket(/\/ws$/, (ws) => void server.push(ws.connectToServer()));
  await ada.reload();
  await expect(ada.locator(".kit-text-input")).toBeVisible();
  for (let i = 0; i < 25; i++) server[0]!.send(JSON.stringify({ type: "action", action: { type: "nothing" } }));
  await expect(ada.getByText("Slow down: that was too much at once. Your Seat is kept.")).toBeVisible();
  await expect(ada.locator(".kit-text-input")).toBeVisible();
  await ada.reload();
  await expect(ada.locator(".kit-text-input")).toBeVisible();
});

test("on a phone, a short View sits in the middle and a tall one scrolls from its top", async ({ context, another }) => {
  const { phones } = await startWith(context, another, ["Ada", "Ben", "Cy"], "Scribble Pick");
  const [ada, ben] = [phones[0]!, phones[1]!];
  const gaps = (page: Page) =>
    page.evaluate(() => {
      const view = document.querySelector(".kit-view")!.getBoundingClientRect();
      const parts = [...document.querySelectorAll(".kit-view > *")].map((p) => p.getBoundingClientRect());
      return { above: parts[0]!.top - view.top, below: view.bottom - parts.at(-1)!.bottom, pageTaller: document.documentElement.scrollHeight > innerHeight + 1 };
    });

  // The drawing pad is taller than a 390x560 phone: the page scrolls, and its top is still reachable.
  await ada.setViewportSize({ width: 390, height: 560 });
  await expect(ada.locator(".kit-pad")).toBeVisible();
  expect((await gaps(ada)).pageTaller).toBe(true);
  expect((await gaps(ada)).above).toBeGreaterThanOrEqual(0);
  expect(await ada.evaluate(() => document.querySelector(".kit-view > *")!.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);

  // After drawing, Ben's View is a line of text: it sits in the middle of the page.
  await scribble(ben);
  await ben.getByRole("button", { name: "Send" }).click();
  await expect(ben.getByText("Sent. Waiting for the others to finish.")).toBeVisible();
  const short = await gaps(ben);
  expect(short.pageTaller).toBe(false);
  expect(Math.abs(short.above - short.below)).toBeLessThan(4);
});

test("a text box's send button stays on screen when the keyboard takes half the page", async ({ context, another }) => {
  const { phones } = await startWith(context, another, ["Ada", "Ben", "Cy"], "Sum It Up");
  const ada = phones[0]!;
  // The keyboard open: with interactive-widget=resizes-content, the page gets this much shorter,
  // shorter than the View, so the box starts below the fold. (A test browser has no keyboard.)
  await ada.setViewportSize({ width: 390, height: 90 });
  await ada.evaluate(() => scrollTo(0, 0));
  expect(await ada.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(90);
  await ada.locator(".kit-text-input input").focus();
  await ada.waitForTimeout(400);
  const send = (await ada.locator(".kit-text-input button").boundingBox())!;
  expect(send.y).toBeGreaterThanOrEqual(0);
  expect(send.y + send.height).toBeLessThanOrEqual(90);
});

/** Holds back every font file a page asks for until `release()`, and lists which it asked for. */
async function holdFonts(page: Page): Promise<{ requested: string[]; release: () => void }> {
  const requested: string[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/fonts/*.woff2", async (route) => {
    requested.push(new URL(route.request().url()).pathname.replace("/fonts/", ""));
    await released;
    await route.continue();
  });
  return { requested, release };
}

/** Whether a face of `family` has finished loading on the page. */
const loaded = (page: Page, family: string) => page.evaluate((f) => [...document.fonts].some((face) => face.family.replaceAll('"', "") === f && face.status === "loaded"), family);

/** Every button, text box and tappable shape on the page: where it is. */
const controls = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.kit-view button, .kit-view input, .kit-view [role="button"]')].map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    }),
  );

for (const [title, family, file] of [
  ["Sum It Up", "Anton", "anton-400.woff2"],
  ["Scribble Pick", "Patrick Hand", "patrick-hand-400.woff2"],
  ["Allotments", "Nunito", "nunito-700.woff2"],
] as const) {
  test(`${title}: pages load only their Look's font, show text before it arrives, and the swap moves no button from under a thumb`, async ({ context, another }) => {
    const { screen, code } = await openScreen(context);
    const screenFonts = await holdFonts(screen);
    const phones: Page[] = [];
    const held: Awaited<ReturnType<typeof holdFonts>>[] = [];
    for (const name of ["Ada", "Ben", "Cy"]) {
      const phone = await joinPhone(another, code, name);
      held.push(await holdFonts(phone));
      phones.push(phone);
    }
    await screen.getByRole("button", { name: `Start ${title}` }).click();
    for (const p of phones) await expect(p.locator(".kit-view .kit-text").first()).toBeVisible();
    // The phone with something to tap (in Allotments, only the one whose turn it is).
    const phone = (await Promise.all(phones.map(async (p) => ((await controls(p)).length > 0 ? p : undefined)))).find((p) => p !== undefined)!;
    // The View is up and readable before any font has arrived.
    expect(await loaded(phone, family)).toBe(false);
    const before = await controls(phone);
    expect(before.length).toBeGreaterThan(0);

    for (const h of [...held, screenFonts]) h.release();
    await expect.poll(() => loaded(phone, family)).toBe(true);
    await phone.waitForTimeout(100);
    const after = await controls(phone);
    // Where a thumb was aiming at each control is still on it.
    for (const [i, old] of before.entries()) {
      const now = after[i]!;
      const centre = { x: old.x + old.width / 2, y: old.y + old.height / 2 };
      expect(centre.x >= now.x && centre.x <= now.x + now.width && centre.y >= now.y && centre.y <= now.y + now.height, `control ${i} moved from under its old centre`).toBe(true);
    }
    console.log(`${title}: the largest move of a control when ${family} arrived: ${Math.max(...before.map((old, i) => Math.max(Math.abs(after[i]!.x - old.x), Math.abs(after[i]!.y - old.y)))).toFixed(1)} px`);

    // Only this Look's typeface was asked for, by the phones and by the Screen.
    for (const h of [...held, screenFonts]) expect(h.requested.every((f) => f.startsWith(file.split("-").slice(0, -1).join("-")))).toBe(true);
    expect(held[0]!.requested).toContain(file);
  });
}
