import { expect, test } from "vitest";
import { phoneToServer, PROTOCOL_VERSION, screenToServer, serverToPhone, type Room } from "./index.js";

const v = PROTOCOL_VERSION;
const room: Room = {
  code: "KRWM",
  seats: [{ id: "s1", name: "Ada", connected: true }],
  screenConnected: true,
  match: null,
  lastMatch: null,
};

test("a phone's join is accepted, and its name is trimmed", () => {
  expect(phoneToServer.parse({ type: "join", v, code: "KRWM", name: "  Ada " })).toEqual({
    type: "join",
    v,
    code: "KRWM",
    name: "Ada",
  });
});

test.each([
  ["a message type that doesn't exist", { type: "becomeHost", v, code: "KRWM" }],
  ["a Room Code that isn't four letters", { type: "join", v, code: "krwm1", name: "Ada" }],
  ["an empty name", { type: "join", v, code: "KRWM", name: "   " }],
  ["a name that is too long", { type: "join", v, code: "KRWM", name: "A".repeat(17) }],
  ["a field the message doesn't have", { type: "leave", seatId: "s2" }],
  ["a page from before the messages changed", { type: "join", v: v + 1, code: "KRWM", name: "Ada" }],
  ["something that isn't an object", "join"],
])("a phone's message is refused: %s", (_what, message) => {
  expect(phoneToServer.safeParse(message).success).toBe(false);
});

test("the server passes a view and an action along without knowing what is in them", () => {
  const views = { type: "views", views: { s1: { parts: [{ kind: "text", text: "hi" }] } }, timerMs: 30_000 };
  expect(screenToServer.parse(views)).toEqual(views);
  const action = { type: "action", action: { type: "vote", for: "s2" } };
  expect(phoneToServer.parse(action)).toEqual(action);
});

test("a Match's look must be real colours", () => {
  const start = (background: string) => ({
    type: "startMatch",
    match: { gameId: "best-word", title: "Best Word", look: { colors: { background }, font: "poster" } },
  });
  expect(screenToServer.safeParse(start("#14213d")).success).toBe(true);
  expect(screenToServer.safeParse(start("url(https://example.com)")).success).toBe(false);
});

test("a phone is given its Seat, its secret and the whole Room", () => {
  const seated = { type: "seated", seatId: "s1", seatToken: "t".repeat(32), room };
  expect(serverToPhone.parse(seated)).toEqual(seated);
});
