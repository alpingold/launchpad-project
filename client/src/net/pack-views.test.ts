// The Screen's sending, without a browser: Views packed into as few `views` messages as fit.
import { MAX_MESSAGE_BYTES, screenToServer } from "@boilergames/protocol";
import { MAX_VIEW_BYTES } from "@boilergames/sdk/v1/engine";
import { expect, test } from "vitest";
import { packViews } from "./pack-views.js";

const seats = Array.from({ length: 16 }, (_, i) => `s${i + 1}`);
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

test("16 Views at nearly the largest size go out as several messages, none too big, each View in exactly one", () => {
  // Each View just under MAX_VIEW_BYTES, with characters that take 2 bytes in UTF-8 (é).
  const views = new Map(seats.map((id) => [id, { parts: [{ kind: "text", text: "é".repeat((MAX_VIEW_BYTES - 100) / 2) }] }]));
  for (const view of views.values()) expect(size(view)).toBeLessThan(MAX_VIEW_BYTES);
  const messages = packViews(views, 12_000);
  expect(messages.length).toBeGreaterThan(1);
  const seen: string[] = [];
  for (const message of messages) {
    expect(size(message)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(screenToServer.safeParse(message).success).toBe(true);
    expect(message.timerMs).toBe(12_000);
    seen.push(...Object.keys(message.views));
  }
  expect(seen.sort()).toEqual([...seats].sort());
});

test("16 ordinary Views go out as one message", () => {
  const views = new Map(seats.map((id) => [id, { parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }]));
  const messages = packViews(views, null);
  expect(messages).toHaveLength(1);
  expect(Object.keys(messages[0]!.views)).toEqual(seats);
});

test("fills each message as far as it can: a message is started only when the next View won't fit", () => {
  // Views of a third of the limit: three don't fit with the message's own bytes, two do.
  const third = { t: "x".repeat(Math.floor(MAX_MESSAGE_BYTES / 3)) };
  const messages = packViews(new Map(seats.slice(0, 5).map((id) => [id, third])), null);
  expect(messages.map((m) => Object.keys(m.views).length)).toEqual([2, 2, 1]);
});

test("no changed Views still sends one message, for the timer", () => {
  expect(packViews(new Map(), 5_000)).toEqual([{ type: "views", views: {}, timerMs: 5_000 }]);
});
