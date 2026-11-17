// What the Official games promise together: each Look is readable, and between them they use every
// Part in the Kit, so the site's renderer has a real Game for each.
import { checkLook } from "@boilergames/sdk/v1/check";
import { simulate, type AnyGame } from "@boilergames/sdk/v1/engine";
import { expect, test } from "vitest";
import { OFFICIAL } from "./official.js";

test.each(Object.entries(OFFICIAL))("%s has a readable Look", (_id, game) => {
  expect(checkLook(game.about.look)).toMatchObject({ ok: true });
});

test("between them, the Official games use every Part in the Kit, on the Screen and on the phones", () => {
  const ALL = ["text", "timer", "scoreboard", "playerList", "drawing", "picture", "button", "textInput", "drawingPad", "row"];
  const used = new Set<string>();
  /** Notes the kind of each Part in a View, and of each Part inside a row. The Engine checks the View's shape. */
  const record = (view: unknown) => {
    for (const part of (view as { parts: readonly { kind: string; parts?: readonly { kind: string }[] }[] }).parts) {
      used.add(part.kind);
      for (const inner of part.parts ?? []) used.add(inner.kind);
    }
  };
  for (const game of Object.values(OFFICIAL) as AnyGame[]) {
    // The same Game, noting the kind of every Part it draws.
    const watched: AnyGame = {
      ...game,
      screen(state, players) {
        const view = game.screen(state, players);
        record(view);
        return view;
      },
      controller(state, player, players) {
        const view = game.controller(state, player, players);
        record(view);
        return view;
      },
    };
    for (const seed of [1, 2, 3]) expect(simulate(watched, { players: game.about.players.max, seed })).toMatchObject({ ok: true });
  }
  expect(ALL.filter((kind) => !used.has(kind))).toEqual([]);
});
