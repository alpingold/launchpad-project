// A Creator's GenAI Studio key, in each browser, against the development fake (nothing leaves this
// machine): saved from its page, shown only as its last 4 characters, and deleted.
import { FAKE_REJECTED_KEY } from "../server/src/generations/dev-fake.js";
import { expect, test } from "./fixtures.js";
import { APP } from "./origins.js";

test("a Creator saves their key from My Games, sees only its last 4 characters, and deletes it", async ({ context, signedIn }) => {
  const key = `sk-e2e-${Date.now().toString(36)}-KEYZ`;
  await context.addCookies(signedIn.cookies);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${APP}/my/games`);
  await page.getByRole("link", { name: "Your GenAI Studio key" }).click();
  await expect(page.getByRole("heading", { name: "Your GenAI Studio key" })).toBeVisible();
  await expect(page.getByText("No key is saved.")).toBeVisible();

  // A key GenAI Studio refuses isn't saved.
  await page.getByLabel("GenAI Studio key").fill(FAKE_REJECTED_KEY);
  await page.getByRole("button", { name: "Save the key" }).click();
  await expect(page.getByRole("alert")).toContainText("didn't accept that key");

  await page.getByLabel("GenAI Studio key").fill(key);
  await page.getByRole("button", { name: "Save the key" }).click();
  await expect(page.getByText("Your key ending in KEYZ is saved.")).toBeVisible();
  // Gone from the box, and nowhere on the page, then or after a reload.
  await expect(page.getByLabel("Replace it with a new key")).toHaveValue("");
  expect(await page.content()).not.toContain(key);
  await page.reload();
  await expect(page.getByText("Your key ending in KEYZ is saved.")).toBeVisible();
  expect(await page.content()).not.toContain(key);

  await page.getByRole("button", { name: "Delete my key" }).click();
  await expect(page.getByText("No key is saved.")).toBeVisible();
});
