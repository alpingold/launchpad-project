// Each Part of the Kit, drawn: what a Game writes shows up, and nothing it didn't ask for.
import type { ControllerPart, ControllerView } from "@boilergames/sdk/v1";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { View } from "./View.js";

const names = new Map([
  ["s1", "Ada"],
  ["s2", "Ben"],
]);

function draw(parts: readonly ControllerPart<unknown>[], options: { onAction?: (a: unknown) => void; timerEndsAt?: number | null } = {}): string {
  const view: ControllerView<unknown> = { parts };
  return renderToStaticMarkup(<View kind="controller" view={view} look={undefined} names={names} timerEndsAt={options.timerEndsAt ?? null} onAction={options.onAction ?? (() => undefined)} />);
}

describe("each Part", () => {
  test("text, with its size and tone", () => {
    expect(draw([{ kind: "text", text: "Hello <b>", size: "big", tone: "accent" }])).toContain('<p class="kit-text" data-size="big" data-tone="accent">Hello &lt;b&gt;</p>');
  });

  test("timer: the seconds left, and nothing when no timer runs", () => {
    expect(draw([{ kind: "timer" }], { timerEndsAt: Date.now() + 9_500 })).toMatch(/role="timer"[^>]*>10</);
    expect(draw([{ kind: "timer" }])).not.toContain("kit-timer");
  });

  test("scoreboard: names from the Room, highest first", () => {
    const html = draw([{ kind: "scoreboard", title: "Points", scores: { s1: 2, s2: 5 } }]);
    expect(html).toContain("<h2>Points</h2>");
    expect(html.indexOf("Ben")).toBeLessThan(html.indexOf("Ada"));
  });

  test("playerList: names, marks and notes", () => {
    const html = draw([{ kind: "playerList", players: [{ id: "s1", mark: "active", note: "red" }, { id: "s9" }] }]);
    expect(html).toContain('data-mark="active"');
    expect(html).toContain("Ada");
    expect(html).toContain("their turn");
    expect(html).toContain("red");
    expect(html).toContain("Someone who left");
  });

  test("drawing: each stroke as a line in the 1000-square, and its artist when named", () => {
    const html = draw([{ kind: "drawing", drawing: { strokes: [{ color: "#ff0000", width: 8, points: [0, 0, 500, 500] }] }, by: "s2" }]);
    expect(html).toContain('viewBox="0 0 1000 1000"');
    expect(html).toContain('<polyline points="0,0 500,500" fill="none" stroke="#ff0000" stroke-width="8"');
    expect(html).toContain("by Ben");
  });

  test("picture: each shape, with Look colours by name", () => {
    const html = draw([
      {
        kind: "picture",
        width: 200,
        height: 100,
        shapes: [
          { shape: "rect", x: 1, y: 2, width: 3, height: 4, radius: 5, fill: "accent" },
          { shape: "circle", x: 10, y: 10, r: 4, fill: "#00ff00" },
          { shape: "line", x1: 0, y1: 0, x2: 9, y2: 9 },
          { shape: "polygon", points: [0, 0, 10, 0, 5, 8] },
          { shape: "path", d: "M 0 0 L 5 5" },
          { shape: "label", x: 4, y: 4, text: "A1", size: 12, align: "middle" },
        ],
      },
    ]);
    expect(html).toContain('viewBox="0 0 200 100"');
    expect(html).toMatch(/<rect x="1" y="2" width="3" height="4" rx="5" style="fill:var\(--kit-accent\)/);
    expect(html).toContain('<circle cx="10" cy="10" r="4"');
    expect(html).toContain('<line x1="0" y1="0" x2="9" y2="9"');
    expect(html).toContain('<polygon points="0,0 10,0 5,8"');
    expect(html).toContain('<path d="M 0 0 L 5 5"');
    expect(html).toMatch(/<text x="4" y="4" font-size="12" text-anchor="middle"[^>]*>A1<\/text>/);
  });

  test("picture: a shape carrying fields the Kit doesn't list renders none of them", () => {
    const sneaky = {
      shape: "rect",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      onClick: "alert(1)",
      onload: "alert(2)",
      href: "javascript:alert(3)",
      style: "background:url(https://evil.example)",
      dangerouslySetInnerHTML: { __html: "<script>alert(4)</script>" },
      className: "injected",
      "data-x": "y",
    } as never;
    const html = draw([{ kind: "picture", width: 10, height: 10, shapes: [sneaky] }]);
    for (const leak of ["alert", "evil.example", "javascript:", "injected", "data-x", "script"]) expect(html, leak).not.toContain(leak);
  });

  test("picture: a shape is tappable only if it carries an Action and the page can send one", () => {
    const shapes = [{ shape: "circle" as const, x: 1, y: 1, r: 1, action: { type: "tap" } }];
    expect(draw([{ kind: "picture", width: 10, height: 10, shapes }])).toContain('role="button"');
    const screen = renderToStaticMarkup(<View kind="screen" view={{ parts: [{ kind: "picture", width: 10, height: 10, shapes: [{ shape: "circle", x: 1, y: 1, r: 1 }] }] }} look={undefined} names={names} timerEndsAt={null} />);
    expect(screen).not.toContain('role="button"');
  });

  test("button: its label; disabled when the Game says so", () => {
    expect(draw([{ kind: "button", label: "Vote", action: { type: "vote" } }])).toMatch(/<button class="kit-button" type="button">Vote<\/button>/);
    expect(draw([{ kind: "button", label: "Vote", action: { type: "vote" }, disabled: true }])).toContain("disabled");
  });

  test("textInput: a box limited to the Game's length, 80 if it names none, and a send button", () => {
    expect(draw([{ kind: "textInput", action: { type: "write" }, placeholder: "One word", maxLength: 24 }])).toMatch(/<input[^>]*maxLength="24"[^>]*placeholder="One word"/);
    expect(draw([{ kind: "textInput", action: { type: "write" } }])).toContain('maxLength="80"');
  });

  test("drawingPad: a 1000-square surface and the Game's pens, or the site's", () => {
    const html = draw([{ kind: "drawingPad", action: { type: "draw" }, colors: ["#111111", "#222222"] }]);
    expect(html).toContain('aria-label="drawing pad"');
    expect(html).toContain('aria-label="#111111"');
    expect(html.match(/class="kit-pen"/g)).toHaveLength(2);
    expect(draw([{ kind: "drawingPad", action: { type: "draw" } }]).match(/class="kit-pen"/g)!.length).toBeGreaterThan(2);
  });

  test("row: its Parts side by side", () => {
    expect(draw([{ kind: "row", parts: [{ kind: "text", text: "a" }, { kind: "text", text: "b" }] }])).toMatch(/<div class="kit-row"><p[^>]*>a<\/p><p[^>]*>b<\/p><\/div>/);
  });
});

test("the Look becomes CSS variables on the View's root, and button text is black or white, whichever reads on the accent", () => {
  const html = renderToStaticMarkup(<View kind="screen" view={{ parts: [] }} look={{ colors: { background: "#fff3b0", accent: "#9e2a2b" }, font: "mono", corners: "sharp" }} names={names} timerEndsAt={null} />);
  expect(html).toContain("--kit-background:#fff3b0");
  expect(html).toContain("--kit-accent:#9e2a2b");
  expect(html).toContain("--kit-on-accent:#ffffff");
  expect(html).toContain("--kit-radius:0px");
  expect(html).toContain("monospace");
});
