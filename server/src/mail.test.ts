// Choosing how emails are sent, from the settings, and what development prints.
import { expect, test, vi } from "vitest";
import { mailFrom, RecordedMail } from "./mail.js";

test("in development, an email is recorded and its link printed, without the address", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const mail = await mailFrom({});
    expect(mail).toBeInstanceOf(RecordedMail);
    await mail.send({ to: "ada@purdue.edu", subject: "Your link", text: "Open this:\nhttp://localhost:3000/sign-in/confirm#abc\nThanks" });
    expect((mail as RecordedMail).sent).toEqual([{ to: "ada@purdue.edu", subject: "Your link", text: expect.stringContaining("#abc") }]);
    expect(log.mock.calls.map((call) => call.join(" "))).toEqual(["Email (not sent, development): Your link: http://localhost:3000/sign-in/confirm#abc"]);
  } finally {
    log.mockRestore();
  }
});

test("a RecordedMail made by a test prints nothing", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await new RecordedMail().send({ to: "ada@purdue.edu", subject: "s", text: "http://x/y" });
    expect(log).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

test("production must send through SES: without MAIL=ses, or with another value, the server doesn't start", async () => {
  await expect(mailFrom({ NODE_ENV: "production" })).rejects.toThrow(/MAIL=ses must be set in production/);
  await expect(mailFrom({ MAIL: "smtp" })).rejects.toThrow(/MAIL must be "ses" or unset, not "smtp"/);
});

test("MAIL=ses loads the SES sender at start, without sending anything", async () => {
  const mail = await mailFrom({ MAIL: "ses", NODE_ENV: "production" });
  expect(typeof mail.send).toBe("function");
  expect(mail).not.toBeInstanceOf(RecordedMail);
});
