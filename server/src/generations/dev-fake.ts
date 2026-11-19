/**
 * The model the server uses with GENAI_BASE_URL=fake: development and the browser tests, never
 * production (config.ts refuses it there). It reaches nothing. GenAI Studio's key check says every
 * key is valid except one, so a test can see a refusal.
 *
 * It answers the maker's prompts with canned answers, so the whole maker can be tried without a
 * model: a Concept prompt with FAKE_CONCEPT, and a Build prompt with FAKE_GAME, titled as the
 * Concept the prompt holds (so a Creator who edits the title sees it in the Game). An idea that
 * holds FAKE_FAIL gets no usable Concept, so a failed Generation can be seen too. A Revision gets
 * its file back with one line added, a comment saying what was asked (FAKE_CHANGED), so its changed
 * lines can be seen.
 *
 * These answers are the fake model's side of the conversation: none of them is ever put in a prompt.
 */
import type { Concept } from "./concept.js";
import { ScriptedModel } from "./fake-model.js";
import { longestCodeBlock, type ChatMessage } from "./model.js";

/** The one key the fake GenAI Studio refuses. */
export const FAKE_REJECTED_KEY = "rejected-key-0000";
/** In an idea, makes every Concept the fake drafts unusable. */
export const FAKE_FAIL = "[fail]";
/** The line the fake adds to a file it is asked to change, before the request's first line. */
export const FAKE_CHANGED = "// Changed by the AI, as asked: ";
const ASKED_FOR = "The Creator asked for this change to their Game:\n";

export const FAKE_CONCEPT: Concept = {
  title: "Tap Vote",
  pitch: "Everyone taps their phone; the third tap opens the vote, and the sixth ends the Match.",
  players: { min: 2, max: 4 },
  phases: [
    { id: "write", name: "Tap to write", screen: "How many taps so far", phone: "A Tap button", ends: "Three taps from anyone" },
    { id: "vote", name: "Tap to vote", screen: "How many taps so far", phone: "A Tap button", ends: "Six taps from anyone" },
  ],
  scoring: { kind: "points", how: "A point for each tap." },
  length: "Under a minute.",
  look: { colors: { background: "#101828", text: "#f8fafc", accent: "#f59e0b" }, font: "rounded", corners: "soft" },
};

/** A Game for FAKE_CONCEPT that passes the Playtest, with its title as `title` (JSON text). */
function fakeGame(title: string): string {
  const about = `{ "title": ${title}, "players": ${JSON.stringify(FAKE_CONCEPT.players)}, "look": ${JSON.stringify(FAKE_CONCEPT.look)} }`;
  return `\`\`\`ts
import { defineGame, type Context, type ControllerView, type Player, type ScreenView, type Step } from "@boilergames/sdk/v1";

type Phase = "write" | "vote";

interface State {
  readonly phase: Phase;
  readonly taps: number;
  readonly by: Readonly<Record<string, number>>;
}

type Action = { readonly type: "tap" };

export default defineGame<State, Action>({
  about: ${about},

  start(_ctx: Context): Step<State> {
    return { state: { phase: "write", taps: 0, by: {} } };
  },

  onAction(state: State, player: Player, _action: Action, ctx: Context): Step<State> {
    const by = { ...state.by, [player.id]: (state.by[player.id] ?? 0) + 1 };
    const taps = state.taps + 1;
    if (taps >= 6) return { state: { ...state, taps, by }, end: { scores: Object.fromEntries(ctx.players.map((p) => [p.id, by[p.id] ?? 0])) } };
    return { state: { phase: taps >= 3 ? "vote" : "write", taps, by } };
  },

  onLeave(state: State): Step<State> {
    return { state };
  },

  screen(state: State): ScreenView {
    return { parts: [{ kind: "text", text: \`\${state.taps} taps\` }] };
  },

  controller(): ControllerView<Action> {
    return { parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] };
  },
});
\`\`\``;
}

/** The fake's answer to any prompt of the maker's. */
export function fakeAnswer(messages: readonly ChatMessage[]): string {
  const system = messages[0]?.content ?? "";
  const asked = messages.map((message) => message.content).join("\n");
  if (system.startsWith("You write party games") && asked.includes(ASKED_FOR)) {
    // A Revision: the file it was given (or its own last one), with the change written in as a comment.
    const file = longestCodeBlock(messages.at(-1)?.content ?? "") ?? "";
    if (file.includes(FAKE_CHANGED)) return `\`\`\`ts\n${file}\`\`\``;
    const request = (asked.split(ASKED_FOR)[1] ?? "").split("\n")[0] ?? "";
    return `\`\`\`ts\n${FAKE_CHANGED}${request}\n${file}\`\`\``;
  }
  if (system.startsWith("You write party games")) {
    // The skeleton (or the last file) names the Concept's title; keep it.
    const title = /"title": ("(?:[^"\\]|\\.)*")/.exec(asked)?.[1] ?? JSON.stringify(FAKE_CONCEPT.title);
    return fakeGame(title);
  }
  if (asked.includes(FAKE_FAIL)) return "I can't make a Concept for that.";
  return JSON.stringify(FAKE_CONCEPT);
}

export function devFakeModel(): ScriptedModel {
  return new ScriptedModel([], { rejectedKeys: [FAKE_REJECTED_KEY], record: false, respond: fakeAnswer });
}
