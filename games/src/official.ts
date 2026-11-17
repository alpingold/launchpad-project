/**
 * The Official games, by id. The id is the Game's folder name; it names its bundle and its entry in
 * games.json. Each Game is its folder's default export, written as any Creator would write one.
 */
import allotments from "./allotments/index.js";
import scribblePick from "./scribble-pick/index.js";
import sumItUp from "./sum-it-up/index.js";

export const OFFICIAL = {
  "sum-it-up": sumItUp,
  "scribble-pick": scribblePick,
  allotments: allotments,
};
