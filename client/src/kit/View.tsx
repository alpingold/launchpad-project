/**
 * `<View>`: draws a checked View (the Screen's or a Controller's) in a Game's Look. The page checks
 * every View with the SDK's checker before it gets here; this file only draws.
 */
import type { ControllerPart, ControllerView, Look, ScreenView } from "@boilergames/sdk/v1";
import "./fonts.css";
import "./kit.css";
import { lookFont, lookStyle, SINGLE_WEIGHT_FONTS } from "./look-style.js";
import { Button, DrawingPad, DrawingView, PlayerList, Picture, Scoreboard, Text, TextInput, Timer, type PartContext } from "./parts.js";

export interface ViewProps {
  readonly view: ControllerView<unknown> | ScreenView;
  /** The Game's Look as it wrote it, or undefined for the site's default. */
  readonly look: Look | undefined;
  /** Player names by Seat id, from the Room. */
  readonly names: ReadonlyMap<string, string>;
  /** When the Match's timer runs out (Date.now() time), or null. */
  readonly timerEndsAt: number | null;
  /** Sends an Action: a Controller's. Left out on the Screen. */
  readonly onAction?: (action: unknown) => void;
  /** "screen" fills the Screen's display; "controller" fits a phone. */
  readonly kind: "screen" | "controller";
}

export function View({ view, look, names, timerEndsAt, onAction, kind }: ViewProps) {
  const context: PartContext = { names, onAction, timerEndsAt };
  return (
    <div className="kit-view" data-kind={kind} data-single-weight={SINGLE_WEIGHT_FONTS.has(lookFont(look)) ? "" : undefined} style={lookStyle(look)}>
      {(view.parts as readonly ControllerPart<unknown>[]).map((part, i) => (
        <Part key={i} part={part} context={context} />
      ))}
    </div>
  );
}

function Part({ part, context }: { part: ControllerPart<unknown>; context: PartContext }) {
  switch (part.kind) {
    case "text":
      return <Text part={part} />;
    case "timer":
      return <Timer context={context} />;
    case "scoreboard":
      return <Scoreboard part={part} context={context} />;
    case "playerList":
      return <PlayerList part={part} context={context} />;
    case "drawing":
      return <DrawingView part={part} context={context} />;
    case "picture":
      return <Picture part={part} context={context} />;
    case "button":
      return <Button part={part} context={context} />;
    case "textInput":
      return <TextInput part={part} context={context} />;
    case "drawingPad":
      return <DrawingPad part={part} context={context} />;
    case "row":
      return (
        <div className="kit-row">
          {part.parts.map((inner, i) => (
            <Part key={i} part={inner} context={context} />
          ))}
        </div>
      );
  }
}
