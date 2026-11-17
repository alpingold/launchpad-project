// The checkers, from the outside: for every Part and shape in kit.ts, a valid one passes and a
// broken one is refused with a problem that says where it is and names what is wrong.
import { describe, expect, test } from "vitest";
import {
  checkControllerView,
  checkDrawing,
  checkLook,
  checkScreenView,
  MAX_ACTION_DEPTH,
  MAX_DRAWING_POINTS,
  MAX_LISTED_PLAYERS,
  MAX_PARTS,
  MAX_PATH_LENGTH,
  MAX_SHAPES,
  MAX_STROKES,
  MAX_TEXT_LENGTH,
} from "./check.js";
import type { ControllerPart, Drawing, Look, ScreenPart, Shape } from "./kit.js";

type Action = { readonly type: "go"; readonly n?: number } | { readonly type: "say"; readonly text: string } | { readonly type: "draw"; readonly drawing: Drawing };

const drawing: Drawing = { strokes: [{ color: "#e63946", width: 8, points: [10, 10, 500, 500, 990, 20] }] };

/** Problems for a Controller View holding just this one Part (or `[]` if it passes). */
function controllerProblems(part: unknown): string[] {
  const result = checkControllerView({ parts: [part] });
  return result.ok ? [] : result.problems;
}

function screenProblems(part: unknown): string[] {
  const result = checkScreenView({ parts: [part] });
  return result.ok ? [] : result.problems;
}

/** One valid example of every Part in kit.ts, typed so it can't drift from the contract. */
const validParts: Record<ControllerPart<Action>["kind"], ControllerPart<Action>> = {
  text: { kind: "text", text: "Hello", size: "big", tone: "accent" },
  timer: { kind: "timer" },
  scoreboard: { kind: "scoreboard", scores: { a: 3, b: -1.5 }, title: "Round 1" },
  playerList: { kind: "playerList", players: [{ id: "a", mark: "done", note: "plinth" }, { id: "b" }] },
  drawing: { kind: "drawing", drawing, by: "a" },
  picture: { kind: "picture", width: 100, height: 50, shapes: [{ shape: "circle", x: 5, y: 5, r: 2, action: { type: "go", n: 1 } }] },
  button: { kind: "button", label: "Go", action: { type: "go" }, disabled: false },
  textInput: { kind: "textInput", action: { type: "say" }, placeholder: "A word", maxLength: 20 },
  drawingPad: { kind: "drawingPad", action: { type: "draw" }, colors: ["#000", "#ffcc00"] },
  row: { kind: "row", parts: [{ kind: "text", text: "Left" }, { kind: "button", label: "Right", action: { type: "go" } }] },
};

/** One valid example of every shape in kit.ts. */
const validShapes: Record<Shape<Action>["shape"], Shape<Action>> = {
  rect: { shape: "rect", x: 0, y: 0, width: 10, height: 10, radius: 2, fill: "accent", stroke: "#123", strokeWidth: 1, opacity: 0.5 },
  circle: { shape: "circle", x: 5, y: 5, r: 3, fill: "#abcdef" },
  line: { shape: "line", x1: 0, y1: 0, x2: 10, y2: 10, stroke: "text" },
  polygon: { shape: "polygon", points: [0, 0, 10, 0, 5, 8], fill: "surface" },
  path: { shape: "path", d: "M 10 80 Q 95 10 180 80 L 1.5e2,-3 Z" },
  label: { shape: "label", x: 5, y: 5, text: "A1", size: 12, align: "middle" },
};

const picture = (...shapes: unknown[]) => ({ kind: "picture", width: 100, height: 100, shapes });

describe("every Part", () => {
  test.each(Object.entries(validParts))("a valid %s passes", (_kind, part) => {
    expect(controllerProblems(part)).toEqual([]);
  });

  // Each broken Part, and the start of the problem it must produce.
  const broken: [string, unknown, string][] = [
    ["text", { kind: "text", text: 7 }, "parts[0].text: must be text"],
    ["text", { kind: "text", text: "x", size: "giant" }, 'parts[0].size: must be one of "small"'],
    ["timer", { kind: "timer", seconds: 30 }, 'parts[0]: a timer has no field "seconds"'],
    ["scoreboard", { kind: "scoreboard", scores: { a: "3" } }, "parts[0].scores.a: must be a finite number"],
    ["scoreboard", { kind: "scoreboard" }, 'parts[0]: a scoreboard needs "scores"'],
    ["playerList", { kind: "playerList", players: [{ id: "a", mark: "asleep" }] }, "parts[0].players[0].mark: must be one of"],
    ["playerList", { kind: "playerList", players: [{ id: "" }] }, "parts[0].players[0].id: must be a Player's id"],
    ["drawing", { kind: "drawing", drawing: { strokes: [{ color: "red", width: 1, points: [0, 0] }] } }, "parts[0].drawing.strokes[0].color: must be a colour"],
    ["picture", { kind: "picture", width: 0, height: 10, shapes: [] }, "parts[0].width: must be more than 0"],
    ["button", { kind: "button", label: "Go", action: { kind: "go" } }, 'parts[0].action: a button needs an action with a "type"'],
    ["button", { kind: "button", label: "Go", action: { type: "go" }, disabled: "no" }, "parts[0].disabled: must be true or false"],
    ["textInput", { kind: "textInput", action: { type: "say" }, maxLength: 501 }, "parts[0].maxLength: must be at most 500"],
    ["textInput", { kind: "textInput", action: { type: "say" }, maxLength: 2.5 }, "parts[0].maxLength: must be a whole number"],
    ["textInput", { kind: "textInput", action: { type: "say", text: "hi" } }, 'parts[0].action.text: a text box fills in "text" itself'],
    ["drawingPad", { kind: "drawingPad", action: { type: "draw", drawing } }, 'parts[0].action.drawing: a drawing pad fills in "drawing" itself'],
    ["drawingPad", { kind: "drawingPad", action: { type: "draw" }, colors: ["blue"] }, "parts[0].colors[0]: must be a colour"],
    ["drawingPad", { kind: "drawingPad", action: { type: "draw" }, colors: [] }, "parts[0].colors: needs at least one colour"],
    ["row", { kind: "row", parts: [{ kind: "row", parts: [] }] }, "parts[0].parts[0]: rows don't nest"],
    ["row", { kind: "row", parts: [{ kind: "text" }] }, 'parts[0].parts[0]: a text needs "text"'],
  ];
  test.each(broken)("a broken %s is refused: %j", (_kind, part, problem) => {
    const problems = controllerProblems(part);
    expect(problems.some((p) => p.startsWith(problem)), problems.join("\n")).toBe(true);
  });

  test("every Part has a broken example above", () => {
    expect(new Set(broken.map(([kind]) => kind))).toEqual(new Set(Object.keys(validParts)));
  });

  test("an unknown kind, a missing kind and an unknown field are problems", () => {
    expect(controllerProblems({ kind: "slider" })[0]).toMatch(/^parts\[0\]\.kind: there is no part "slider"; use one of "text", /);
    expect(controllerProblems({ text: "hi" })[0]).toMatch(/^parts\[0\]: a part needs a "kind"/);
    expect(controllerProblems({ kind: "text", text: "hi", colour: "#000" })).toEqual(['parts[0]: a text has no field "colour"']);
  });

  test("an optional field set to undefined is the same as left out, as in TypeScript", () => {
    expect(controllerProblems({ kind: "text", text: "hi", size: undefined })).toEqual([]);
    expect(controllerProblems({ kind: "text", text: undefined })).toEqual(['parts[0]: a text needs "text"']);
  });
});

describe("every shape", () => {
  test.each(Object.entries(validShapes))("a valid %s passes", (_shape, shape) => {
    expect(controllerProblems(picture(shape))).toEqual([]);
  });

  const broken: [string, unknown, string][] = [
    ["rect", { shape: "rect", x: 0, y: 0, width: -1, height: 1 }, "parts[0].shapes[0].width: must be at least 0"],
    ["circle", { shape: "circle", x: 0, y: 0 }, 'parts[0].shapes[0]: a circle needs "r"'],
    ["line", { shape: "line", x1: 0, y1: 0, x2: Infinity, y2: 0 }, "parts[0].shapes[0].x2: must be a finite number"],
    ["polygon", { shape: "polygon", points: [0, 0, 1] }, "parts[0].shapes[0].points: holds 3 numbers; points come in pairs"],
    ["path", { shape: "path", d: "M 0 0 <script>" }, "parts[0].shapes[0].d: may hold only path commands"],
    ["label", { shape: "label", x: 0, y: 0, text: "A", size: 0 }, "parts[0].shapes[0].size: must be more than 0"],
  ];
  test.each(broken)("a broken %s is refused", (_shape, shape, problem) => {
    const problems = controllerProblems(picture(shape));
    expect(problems.some((p) => p.startsWith(problem)), problems.join("\n")).toBe(true);
  });

  test("every shape has a broken example above", () => {
    expect(new Set(broken.map(([shape]) => shape))).toEqual(new Set(Object.keys(validShapes)));
  });

  test("the style every shape shares is checked", () => {
    expect(controllerProblems(picture({ ...validShapes.circle, fill: "red" }))[0]).toMatch(/^parts\[0\]\.shapes\[0\]\.fill: must be a colour/);
    expect(controllerProblems(picture({ ...validShapes.circle, opacity: 2 }))).toEqual(["parts[0].shapes[0].opacity: must be at most 1, not 2"]);
    expect(controllerProblems(picture({ ...validShapes.circle, action: { type: 3 } }))).toEqual([
      'parts[0].shapes[0].action: a circle that can be tapped needs an action with a "type"',
    ]);
    expect(controllerProblems(picture({ shape: "star", x: 0 }))[0]).toMatch(/^parts\[0\]\.shapes\[0\]\.shape: there is no shape "star"/);
    expect(controllerProblems(picture({ ...validShapes.circle, glow: true }))).toEqual(['parts[0].shapes[0]: a circle has no field "glow"']);
  });

  test("colours: #rgb, #rrggbb and the Look's four names, nothing else", () => {
    for (const fill of ["#abc", "#ABCDEF", "background", "surface", "text", "accent"]) {
      expect(controllerProblems(picture({ ...validShapes.circle, fill }))).toEqual([]);
    }
    for (const fill of ["#abcd", "#ggg", "abc", "rgb(0,0,0)", "url(#x)", "transparent"]) {
      expect(controllerProblems(picture({ ...validShapes.circle, fill }))).toHaveLength(1);
    }
  });
});

describe("the Screen", () => {
  test("holds every Part that only shows something", () => {
    for (const kind of ["text", "timer", "scoreboard", "playerList", "drawing"] as const) {
      expect(screenProblems(validParts[kind])).toEqual([]);
    }
    const row: ScreenPart = { kind: "row", parts: [{ kind: "text", text: "a" }, { kind: "timer" }] };
    expect(screenProblems(row)).toEqual([]);
  });

  test("refuses every Part that sends an Action, even inside a row", () => {
    expect(screenProblems(validParts.button)).toEqual(["parts[0]: the Screen can't hold a button: it has no inputs. Put it on a Controller"]);
    expect(screenProblems(validParts.textInput)[0]).toMatch(/can't hold a text box/);
    expect(screenProblems(validParts.drawingPad)[0]).toMatch(/can't hold a drawing pad/);
    expect(screenProblems(validParts.row)).toEqual(["parts[0].parts[1]: the Screen can't hold a button: it has no inputs. Put it on a Controller"]);
  });

  test("refuses a shape with an action", () => {
    expect(screenProblems(validParts.picture)).toEqual(["parts[0].shapes[0].action: nothing on the Screen can be tapped; put actions on Controllers"]);
  });
});

describe("Actions inside a View", () => {
  const button = (action: unknown) => ({ kind: "button", label: "Go", action });

  test("may hold any plain data", () => {
    expect(controllerProblems(button({ type: "go", list: [1, "two", null, { three: true }], skip: undefined }))).toEqual([]);
  });

  test("must be JSON: no functions, Dates, NaN or holes JSON would turn into null", () => {
    expect(controllerProblems(button({ type: "go", at: new Date(0) }))).toEqual(["parts[0].action.at: must be plain data (text, numbers, true/false, null, lists and plain objects)"]);
    expect(controllerProblems(button({ type: "go", f: () => 1 }))).toHaveLength(1);
    expect(controllerProblems(button({ type: "go", n: NaN }))).toEqual(["parts[0].action.n: must be a finite number: JSON can't carry NaN or Infinity"]);
    expect(controllerProblems(button({ type: "go", list: [undefined] }))).toEqual(["parts[0].action.list[0]: must not be undefined: JSON turns it into null"]);
  });

  test(`may nest at most ${MAX_ACTION_DEPTH} levels, and a cycle is refused, not walked forever`, () => {
    let deep: unknown = 0;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(controllerProblems(button({ type: "go", deep }))[0]).toMatch(/nest at most/);

    const cycle: Record<string, unknown> = { type: "go" };
    cycle["self"] = cycle;
    expect(controllerProblems(button(cycle))[0]).toMatch(/nest at most/);
  });
});

describe("limits", () => {
  test(`a View holds at most ${MAX_PARTS} Parts, a row's Parts counted too`, () => {
    const text = { kind: "text", text: "." };
    expect(checkControllerView({ parts: Array(MAX_PARTS).fill(text) }).ok).toBe(true);
    expect(checkControllerView({ parts: Array(MAX_PARTS + 1).fill(text) }).ok).toBe(false);
    // 50 rows of one Part each: 100 Parts in all, so one more text tips it over.
    const rows = Array(MAX_PARTS / 2).fill({ kind: "row", parts: [text] });
    expect(checkControllerView({ parts: rows }).ok).toBe(true);
    expect(checkControllerView({ parts: [...rows, text] })).toEqual({
      ok: false,
      problems: [`parts: the view holds ${MAX_PARTS + 1} parts (a row's parts count too); the most is ${MAX_PARTS}`],
    });
  });

  test(`text is at most ${MAX_TEXT_LENGTH} characters, wherever it is`, () => {
    const long = "x".repeat(MAX_TEXT_LENGTH + 1);
    expect(controllerProblems({ kind: "text", text: "x".repeat(MAX_TEXT_LENGTH) })).toEqual([]);
    expect(controllerProblems({ kind: "text", text: long })).toEqual([`parts[0].text: is ${MAX_TEXT_LENGTH + 1} characters long; the most is ${MAX_TEXT_LENGTH}`]);
    expect(controllerProblems({ kind: "button", label: long, action: { type: "go" } })).toHaveLength(1);
    expect(controllerProblems(picture({ ...validShapes.label, text: long }))).toHaveLength(1);
    expect(controllerProblems({ kind: "playerList", players: [{ id: "a", note: long }] })).toHaveLength(1);
  });

  test(`a scoreboard and a player list hold at most ${MAX_LISTED_PLAYERS} entries: more than a Room's 16, for Players who left`, () => {
    const ids = Array.from({ length: MAX_LISTED_PLAYERS + 1 }, (_, i) => `p${i}`);
    const scores = (n: number) => Object.fromEntries(ids.slice(0, n).map((id) => [id, 1]));
    expect(controllerProblems({ kind: "scoreboard", scores: scores(17) })).toEqual([]);
    expect(controllerProblems({ kind: "scoreboard", scores: scores(MAX_LISTED_PLAYERS + 1) })).toHaveLength(1);
    expect(controllerProblems({ kind: "playerList", players: ids.map((id) => ({ id })) })).toHaveLength(1);
  });

  test(`a Picture holds at most ${MAX_SHAPES} shapes`, () => {
    expect(controllerProblems({ ...picture(), shapes: Array(MAX_SHAPES).fill(validShapes.circle) })).toEqual([]);
    expect(controllerProblems({ ...picture(), shapes: Array(MAX_SHAPES + 1).fill(validShapes.circle) })).toEqual([
      `parts[0].shapes: holds ${MAX_SHAPES + 1} shapes; the most is ${MAX_SHAPES}`,
    ]);
  });

  test(`a path's d is at most ${MAX_PATH_LENGTH} characters`, () => {
    expect(controllerProblems(picture({ shape: "path", d: "M".repeat(MAX_PATH_LENGTH + 1) }))[0]).toMatch(/the most is 2000/);
  });

  test(`a Drawing holds at most ${MAX_STROKES} strokes and ${MAX_DRAWING_POINTS} points, inside the 1000 square`, () => {
    const stroke = { color: "#000", width: 4, points: [0, 0, 1000, 1000] };
    expect(checkDrawing({ strokes: Array(MAX_STROKES).fill(stroke) }).ok).toBe(true);
    expect(checkDrawing({ strokes: Array(MAX_STROKES + 1).fill(stroke) }).ok).toBe(false);

    const half = Array(MAX_DRAWING_POINTS).fill(500); // 2,500 points
    expect(checkDrawing({ strokes: [{ ...stroke, points: half }, { ...stroke, points: half }] }).ok).toBe(true);
    expect(checkDrawing({ strokes: [{ ...stroke, points: half }, { ...stroke, points: [...half, 1, 1] }] })).toEqual({
      ok: false,
      problems: [`drawing.strokes: holds ${MAX_DRAWING_POINTS + 1} points in all; the most is ${MAX_DRAWING_POINTS}`],
    });

    expect(checkDrawing({ strokes: [{ ...stroke, points: [0, 1001] }] })).toEqual({ ok: false, problems: ["drawing.strokes[0].points[1]: must be at most 1000, not 1001"] });
    expect(checkDrawing({ strokes: [{ ...stroke, points: [] }] }).ok).toBe(false);
    expect(checkDrawing({ strokes: [] }).ok).toBe(true);
  });
});

describe("the Look", () => {
  test("a full Look and an empty one pass", () => {
    const look: Look = { colors: { background: "#14213d", surface: "#22335c", text: "#f5f5f5", accent: "#fca311" }, font: "poster", corners: "round" };
    expect(checkLook(look)).toEqual({ ok: true, look });
    expect(checkLook({}).ok).toBe(true);
  });

  test("a broken Look is refused, saying where (readability has its own tests in look.test.ts)", () => {
    expect(checkLook({ colors: { accent: "accent" } })).toEqual({ ok: false, problems: ['look.colors.accent: must be a colour written "#rgb" or "#rrggbb"'] });
    expect(checkLook({ font: "comic" })).toMatchObject({ ok: false, problems: [expect.stringMatching(/^look\.font: must be one of "plain"/)] });
    expect(checkLook({ corners: "pointy" }).ok).toBe(false);
    expect(checkLook({ colors: { border: "#000" } })).toEqual({ ok: false, problems: ['look.colors: a look\'s colours has no field "border"'] });
    expect(checkLook("dark")).toEqual({ ok: false, problems: ["look: a look must be an object"] });
  });
});

describe("whatever arrives", () => {
  // Each wrapped in [ ] so test.each passes it whole instead of spreading an array into arguments.
  test.each<[unknown]>([[undefined], [null], [3], ["parts"], [[]], [{ parts: "x" }], [{ parts: [], extra: 1 }]])("%j is refused, not thrown on", (value) => {
    expect(checkControllerView(value).ok).toBe(false);
    expect(checkScreenView(value).ok).toBe(false);
  });

  test("a getter that throws becomes a problem", () => {
    const view = {
      get parts(): never {
        throw new Error("boom");
      },
    };
    expect(checkControllerView(view)).toEqual({ ok: false, problems: [expect.stringMatching(/could not be read/)] });
  });

  test("a class instance is not plain data", () => {
    class Text {
      kind = "text";
      text = "hi";
    }
    expect(controllerProblems(new Text())[0]).toMatch(/a part needs a "kind"/);
  });

  test("a key named __proto__ is just an unknown field", () => {
    const part = JSON.parse('{"kind":"text","text":"hi","__proto__":{"size":"big"}}') as unknown;
    expect(controllerProblems(part)).toEqual(['parts[0]: a text has no field "__proto__"']);
  });

  test("a View that is wrong everywhere lists the first 50 problems and counts the rest", () => {
    const result = checkControllerView({ parts: Array(MAX_PARTS).fill({ kind: "text", text: 1, size: 2 }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(51);
      expect(result.problems[50]).toBe("...and 150 more problems");
    }
  });
});
