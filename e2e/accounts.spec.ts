// Signing in on the real site, in each browser: the emailed link (recorded by the test servers, never
// sent), the button on its page, a display name, and staying signed in until signing out.
import { expect, test } from "./fixtures.js";
import { sentMail } from "./mail.js";
import { APP } from "./origins.js";

/** The link in the latest email to `email`. */
async function linkFor(email: string): Promise<string> {
  const sent = await sentMail();
  const text = sent.filter((message) => message.to === email).at(-1)?.text ?? "";
  const link = /http:\S+/.exec(text)?.[0];
  expect(link, `an email to ${email}`).toBeDefined();
  return link ?? "";
}

/** An address and a name no other test or project has used: one database serves the whole run. */
function someone(project: string): { email: string; name: string } {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { email: `${project.replace(/[^a-z0-9]/g, "")}.${id}@purdue.edu`, name: `P ${id}` };
}

test("signs in with the emailed link, picks a name, stays signed in, and signs out", async ({ context, profile, restart }, info) => {
  const { email, name } = someone(info.project.name);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(APP);
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Purdue email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText(`Check your email at ${email}`);

  // Opened, as a mail scanner would, and opened again: neither uses it up.
  const link = await linkFor(email);
  expect(link).toMatch(new RegExp(`^${APP}/sign-in/confirm#[A-Za-z0-9_-]{43}$`));
  await page.goto(link);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.goto(`${APP}/`);
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Pick a display name" })).toBeVisible();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();

  // The browser closed and opened again: a saved profile keeps the session; a fresh one starts empty.
  const again = await restart();
  const reopened = again.pages()[0] ?? (await again.newPage());
  await reopened.goto(APP);
  if (profile === "saved") {
    await expect(reopened.getByText(`Signed in as ${name}`)).toBeVisible();
    await reopened.getByRole("button", { name: "Sign out" }).click();
  }
  await expect(reopened.getByRole("link", { name: "Sign in" })).toBeVisible();
  await reopened.reload();
  await expect(reopened.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(reopened.getByText("Signed in as")).toHaveCount(0);
});

test("signing out, then the same link again: it was used, and says so", async ({ context }, info) => {
  const { email, name } = someone(info.project.name);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${APP}/sign-in`);
  await page.getByLabel("Purdue email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const link = await linkFor(email);
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("This sign-in link has been used or has run out. Ask for a new one.");
  await page.goto(APP);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
