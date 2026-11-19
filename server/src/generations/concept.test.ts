// The Concept: checked field by field, with every problem named; drafted with the scripted model,
// an invalid answer going back with its problems at most 3 times; and a prompt that names the Kit's
// Parts but shows no example Concept and no example Game.
import { describe, expect, test } from "vitest";
import { checkConcept, conceptMessages, CONCEPT_LIMITS, draftConcept, invalidConceptsReason, readConcept, type Concept } from "./concept.js";
import { ScriptedModel } from "./fake-model.js";
import { MAX_INVALID_CONCEPTS } from "./numbers.js";
import { kitParts } from "./reference.js";

/** A Concept that passes every rule (test data: never shown to a model). */
const GOOD: Concept = {
  title: "Night Market",
  pitch: "Players run stalls at a night market, each secretly pricing a lantern, then everyone buys from the stall they trust.",
  players: { min: 3, max: 8 },
  phases: [
    { id: "price", name: "Set your price", screen: "A timer and who has priced", phone: "Pick a price from four buttons", ends: "Everyone has priced, or the timer runs out" },
    { id: "buy", name: "Go shopping", screen: "Every stall's price", phone: "Tap the stall to buy from", ends: "Everyone has bought" },
  ],
  scoring: { kind: "points", how: "A point for each lantern sold." },
  length: "About five minutes: three rounds.",
  look: { colors: { background: "#101828", text: "#f8fafc", accent: "#f59e0b" }, font: "rounded", corners: "soft" },
};

const problemsOf = (value: unknown) => {
  const checked = checkConcept(value);
  return checked.ok ? [] : checked.problems;
};
const withField = (field: string, value: unknown) => ({ ...GOOD, [field]: value });
const withPhase = (change: Record<string, unknown>) => ({ ...GOOD, phases: [{ ...GOOD.phases[0], ...change }, GOOD.phases[1]] });

describe("checking a Concept, field by field", () => {
  test("a good one passes, trimmed", () => {
    expect(checkConcept({ ...GOOD, title: `  ${GOOD.title}  ` })).toEqual({ ok: true, concept: GOOD });
  });

  test("title, pitch and length: text, not empty, within their lengths", () => {
    expect(problemsOf(withField("title", "x".repeat(CONCEPT_LIMITS.title + 1)))).toEqual([`title must be at most ${CONCEPT_LIMITS.title} characters (it is ${CONCEPT_LIMITS.title + 1}).`]);
    expect(problemsOf(withField("title", "   "))).toEqual(["title must be text, and not empty."]);
    expect(problemsOf(withField("pitch", "x".repeat(CONCEPT_LIMITS.pitch + 1)))[0]).toMatch(/^pitch must be at most 400/);
    expect(problemsOf(withField("length", 5))).toEqual(["length must be text, and not empty."]);
  });

  test("the Player count: whole numbers from 1 to 16, min not more than max", () => {
    expect(problemsOf(withField("players", { min: 0, max: 4 }))).toEqual(["players.min and players.max must be from 1 to 16."]);
    expect(problemsOf(withField("players", { min: 3, max: 17 }))).toEqual(["players.min and players.max must be from 1 to 16."]);
    expect(problemsOf(withField("players", { min: 5, max: 4 }))).toEqual(["players.min must not be more than players.max."]);
    expect(problemsOf(withField("players", { min: 2.5, max: 4 }))[0]).toMatch(/^players must be/);
    expect(problemsOf({ ...GOOD, players: { min: 1, max: 1 } })).toEqual([]);
  });

  test("phases: 1 to 8, each id lower-case letters and different, each field within its length", () => {
    expect(problemsOf(withField("phases", []))).toEqual(["phases must be a list of 1 to 8 phases."]);
    expect(problemsOf(withField("phases", Array.from({ length: 9 }, (_, n) => ({ ...GOOD.phases[0], id: "p".repeat(n + 1) }))))).toEqual(["phases must be a list of 1 to 8 phases."]);
    expect(problemsOf(withPhase({ id: "Price" }))).toEqual(['phases[0].id must be lower-case letters only, such as "vote".']);
    expect(problemsOf(withPhase({ id: "round2" }))).toEqual(['phases[0].id must be lower-case letters only, such as "vote".']);
    expect(problemsOf(withPhase({ id: "buy" }))).toEqual(['phases[1].id "buy" is used by another phase: each id must be different.']);
    expect(problemsOf(withPhase({ name: "x".repeat(41) }))).toEqual(["phases[0].name must be at most 40 characters (it is 41)."]);
    expect(problemsOf(withPhase({ screen: "x".repeat(301) }))[0]).toMatch(/^phases\[0\]\.screen must be at most 300/);
    expect(problemsOf(withPhase({ phone: "" }))).toEqual(["phases[0].phone must be text, and not empty."]);
    expect(problemsOf(withPhase({ ends: "x".repeat(201) }))[0]).toMatch(/^phases\[0\]\.ends must be at most 200/);
    expect(problemsOf(withPhase({ colour: "red" }))).toEqual(["phases[0].colour is not a field of a phase: leave it out."]);
  });

  test("scoring: none, points or winner, with how; none is a real choice", () => {
    expect(problemsOf(withField("scoring", { kind: "none", how: "Nobody scores: it's about the moment." }))).toEqual([]);
    expect(problemsOf(withField("scoring", { kind: "stars", how: "x" }))).toEqual(['scoring must be { "kind": "none", "points" or "winner", "how": text }.']);
    expect(problemsOf(withField("scoring", { kind: "winner", how: "x".repeat(401) }))[0]).toMatch(/^scoring\.how must be at most 400/);
  });

  test("the Look: the SDK's own type, and readable (the SDK's checkLook)", () => {
    const unreadable = problemsOf(withField("look", { colors: { background: "#ffffff", text: "#fefefe" } }));
    expect(unreadable.length).toBeGreaterThan(0);
    for (const problem of unreadable) expect(problem).toMatch(/^look/);
    expect(problemsOf(withField("look", { font: "comic" }))[0]).toMatch(/^look/);
    expect(problemsOf(withField("look", {}))).toEqual([]);
  });

  test("every problem at once, and fields it doesn't know named", () => {
    expect(problemsOf({ ...GOOD, title: "", length: "", tags: ["x"] })).toEqual(["tags is not a field of a Concept: leave it out.", "title must be text, and not empty.", "length must be text, and not empty."]);
    expect(problemsOf([GOOD])).toEqual(["The Concept must be one JSON object with the fields title, pitch, players, phases, scoring, length and look."]);
  });

  test("an edit that breaks a rule is refused with the rule named", () => {
    const edited = { ...GOOD, phases: [...GOOD.phases, { id: "price", name: "Again", screen: "s", phone: "p", ends: "e" }] };
    expect(problemsOf(edited)).toEqual(['phases[2].id "price" is used by another phase: each id must be different.']);
  });
});

describe("reading an answer", () => {
  test("a Concept inside other words, and the model's thinking, is found", () => {
    expect(readConcept(`<think>hmm {not this}</think> Here you go:\n${JSON.stringify(GOOD)}\nEnjoy!`)).toEqual({ ok: true, concept: GOOD });
  });

  test("no JSON, or JSON that can't be read, is a problem that goes back", () => {
    expect(readConcept("I can't do that.")).toEqual({ ok: false, problems: ["The answer holds no JSON object. Answer with the Concept as one JSON object."] });
    expect(readConcept("{ title: Night }")).toEqual({ ok: false, problems: [expect.stringMatching(/^The answer's JSON can't be read: /)] });
  });
});

describe("drafting", () => {
  const ask = (model: ScriptedModel) => (messages: Parameters<ScriptedModel["complete"]>[1]) => model.complete("k", messages);

  test("invalid twice, then valid: each invalid answer goes back with its problems, and only the latest", async () => {
    const model = new ScriptedModel([JSON.stringify({ ...GOOD, title: "" }), JSON.stringify({ ...GOOD, players: { min: 4, max: 2 } }), JSON.stringify(GOOD)]);
    const heard: (readonly string[])[] = [];
    expect(await draftConcept(ask(model), "A night market game", { onAttempt: (problems) => heard.push(problems) })).toEqual({ kind: "valid", concept: GOOD });
    expect(heard).toEqual([["title must be text, and not empty."], ["players.min must not be more than players.max."], []]);
    const third = model.calls[2]?.messages ?? [];
    expect(third.at(-1)?.content).toContain("- players.min must not be more than players.max.");
    expect(third.map((message) => message.content).join("\n")).not.toContain("title must be text, and not empty.");
  });

  test(`${MAX_INVALID_CONCEPTS} invalid answers fail, with a reason a person can read`, async () => {
    const model = new ScriptedModel(Array.from({ length: MAX_INVALID_CONCEPTS }, () => "Sorry, no JSON today."));
    const draft = await draftConcept(ask(model), "An idea");
    expect(draft.kind).toBe("invalid");
    expect(model.calls).toHaveLength(MAX_INVALID_CONCEPTS);
    if (draft.kind !== "invalid") return;
    expect(invalidConceptsReason(draft.attempts)).toBe(`The AI couldn't write a usable Concept in ${MAX_INVALID_CONCEPTS} tries. The last one's problems: The answer holds no JSON object. Answer with the Concept as one JSON object.`);
  });

  test("a model that fails ends the draft with how", async () => {
    expect(await draftConcept(ask(new ScriptedModel([{ failure: "keyRejected" }])), "An idea")).toEqual({ kind: "failed", failure: "keyRejected" });
  });

  test("a redraft carries the previous Concept and the Creator's note", () => {
    const messages = conceptMessages("An idea", { previous: GOOD, note: "Make it shorter, two rounds." });
    expect(messages.at(-1)?.content).toContain("Make it shorter, two rounds.");
    expect(messages.at(-1)?.content).toContain('"title": "Night Market"');
  });
});

describe("the prompt", () => {
  test("names the Kit's Parts from the SDK's own types, with where each can be shown", () => {
    const parts = kitParts();
    expect(parts.map((part) => part.kind).sort()).toEqual(["button", "drawing", "drawingPad", "picture", "playerList", "scoreboard", "text", "textInput", "timer"]);
    expect(parts.find((part) => part.kind === "button")).toEqual({ kind: "button", purpose: "A button.", on: "phone only" });
    expect(parts.find((part) => part.kind === "scoreboard")?.on).toBe("screen and phone");
    const system = conceptMessages("An idea")[0]?.content ?? "";
    for (const part of parts) expect(system).toContain(`- ${part.kind} (${part.on}): ${part.purpose}`);
    expect(system).toContain("export interface Look {");
  });

  test("holds no example Concept and no example Game", () => {
    const system = conceptMessages("An idea")[0]?.content ?? "";
    // A field's description never comes with a filled-in value, and no Game is written out.
    expect(system).not.toMatch(/"title"\s*:\s*"/);
    expect(system).not.toContain("defineGame");
    expect(system).not.toContain("{ \"id\":");
  });
});
