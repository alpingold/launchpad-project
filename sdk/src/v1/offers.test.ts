// Which Actions a Controller's View offers. The Engine accepts a phone's Action only if this says yes.
import { describe, expect, test } from "vitest";
import { availableActions, checkControllerView, offers } from "./check.js";
import type { ControllerView, Drawing } from "./kit.js";

type Action =
  | { readonly type: "vote"; readonly for: string }
  | { readonly type: "claim"; readonly cell: { readonly row: number; readonly col: number } }
  | { readonly type: "write"; readonly text: string; readonly round: number }
  | { readonly type: "sketch"; readonly drawing: Drawing };

const drawing: Drawing = { strokes: [{ color: "#000", width: 6, points: [100, 100, 900, 900] }] };

const view: ControllerView<Action> = {
  parts: [
    { kind: "button", label: "Ada", action: { type: "vote", for: "a" } },
    { kind: "button", label: "Ben", action: { type: "vote", for: "b" }, disabled: true },
    {
      kind: "picture",
      width: 200,
      height: 100,
      shapes: [
        { shape: "rect", x: 0, y: 0, width: 100, height: 100, action: { type: "claim", cell: { row: 0, col: 0 } } },
        { shape: "label", x: 50, y: 50, text: "not tappable", size: 10 },
      ],
    },
    { kind: "row", parts: [{ kind: "textInput", action: { type: "write", round: 2 }, maxLength: 10 }] },
    { kind: "drawingPad", action: { type: "sketch" } },
  ],
};

test("the View used here passes the checker, as every View given to offers must", () => {
  expect(checkControllerView(view).ok).toBe(true);
});

describe("a button", () => {
  test("offers exactly its Action", () => {
    expect(offers(view, { type: "vote", for: "a" })).toBe(true);
  });

  test("offers nothing when disabled", () => {
    expect(offers(view, { type: "vote", for: "b" })).toBe(false);
  });

  test("offers nothing else: not a different value, an extra field or a missing one", () => {
    expect(offers(view, { type: "vote", for: "c" })).toBe(false);
    expect(offers(view, { type: "vote", for: "a", extra: 1 })).toBe(false);
    expect(offers(view, { type: "vote" })).toBe(false);
    expect(offers(view, { type: "vote", for: ["a"] })).toBe(false);
  });
});

describe("a tappable shape", () => {
  test("offers its Action, compared deeply and in any key order", () => {
    expect(offers(view, { cell: { col: 0, row: 0 }, type: "claim" })).toBe(true);
    expect(offers(view, { type: "claim", cell: { row: 0, col: 1 } })).toBe(false);
    expect(offers(view, { type: "claim", cell: { row: 0 } })).toBe(false);
  });
});

describe("a text box", () => {
  test("offers its Action with any non-blank text up to maxLength", () => {
    expect(offers(view, { type: "write", round: 2, text: "plinth" })).toBe(true);
    expect(offers(view, { type: "write", round: 2, text: "x".repeat(10) })).toBe(true);
  });

  test("refuses text that is too long, blank, missing or not text", () => {
    expect(offers(view, { type: "write", round: 2, text: "x".repeat(11) })).toBe(false);
    expect(offers(view, { type: "write", round: 2, text: "   " })).toBe(false);
    expect(offers(view, { type: "write", round: 2, text: "" })).toBe(false);
    expect(offers(view, { type: "write", round: 2 })).toBe(false);
    expect(offers(view, { type: "write", round: 2, text: 42 })).toBe(false);
  });

  test("refuses an Action that differs from the box's apart from its text", () => {
    expect(offers(view, { type: "write", round: 3, text: "plinth" })).toBe(false);
    expect(offers(view, { type: "write", text: "plinth" })).toBe(false);
    expect(offers(view, { type: "write", round: 2, text: "plinth", extra: true })).toBe(false);
  });

  test("allows 80 characters when the Game sets no maxLength", () => {
    const plain: ControllerView<Action> = { parts: [{ kind: "textInput", action: { type: "write", round: 1 } }] };
    expect(offers(plain, { type: "write", round: 1, text: "x".repeat(80) })).toBe(true);
    expect(offers(plain, { type: "write", round: 1, text: "x".repeat(81) })).toBe(false);
  });
});

describe("a drawing pad", () => {
  test("offers its Action with a valid Drawing of at least one stroke", () => {
    expect(offers(view, { type: "sketch", drawing })).toBe(true);
  });

  test("refuses an empty Drawing, a broken one, or none", () => {
    expect(offers(view, { type: "sketch", drawing: { strokes: [] } })).toBe(false);
    expect(offers(view, { type: "sketch", drawing: { strokes: [{ color: "#000", width: 6, points: [0, 2000] }] } })).toBe(false);
    expect(offers(view, { type: "sketch", drawing: "a cat" })).toBe(false);
    expect(offers(view, { type: "sketch" })).toBe(false);
  });
});

describe("whatever a phone sends", () => {
  // Each wrapped in [ ] so test.each passes it whole instead of spreading an array into arguments.
  test.each<[unknown]>([[undefined], [null], [0], ["vote"], [[]], [{}], [{ type: "vote", for: "a", toString: () => "a" }]])("%j is not offered, nor thrown on", (action) => {
    expect(offers(view, action)).toBe(false);
  });

  test("a deeply nested Action is refused without overflowing the stack", () => {
    let deep: unknown = "a";
    for (let i = 0; i < 100_000; i++) deep = { for: deep };
    expect(offers(view, { type: "vote", for: deep })).toBe(false);
    expect(offers(view, { type: "claim", cell: deep })).toBe(false);
  });

  test("an Action that went through JSON matches one whose View had an undefined field", () => {
    const withUndefined: ControllerView<unknown> = { parts: [{ kind: "button", label: "Go", action: { type: "vote", for: "a", note: undefined } }] };
    const fromPhone: unknown = JSON.parse(JSON.stringify({ type: "vote", for: "a", note: undefined }));
    expect(offers(withUndefined, fromPhone)).toBe(true);
  });
});

test("availableActions lists what the View offers, with text boxes and drawing pads as templates", () => {
  expect(availableActions(view)).toEqual([
    { kind: "exact", action: { type: "vote", for: "a" } },
    { kind: "exact", action: { type: "claim", cell: { row: 0, col: 0 } } },
    { kind: "text", template: { type: "write", round: 2 }, maxLength: 10 },
    { kind: "drawing", template: { type: "sketch" } },
  ]);
  expect(availableActions({ parts: [{ kind: "text", text: "Waiting..." }] })).toEqual([]);
});

test("site code reading a View without the Game's Action type sees each input's action as plain data", () => {
  // Before Unfilled had its `unknown` branch, these Actions had type `never` and this didn't compile.
  const read: ControllerView<unknown> = {
    parts: [
      { kind: "textInput", action: { type: "write", round: 1 } },
      { kind: "drawingPad", action: { type: "sketch" } },
    ],
  };
  const templates = read.parts.flatMap((part) => (part.kind === "textInput" || part.kind === "drawingPad" ? [part.action.type] : []));
  expect(templates).toEqual(["write", "sketch"]);
});
