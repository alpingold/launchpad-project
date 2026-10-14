import { Column, Row, Grid, Card } from './layout.jsx';
import { Text, Image, Timer, Progress, Scoreboard, PlayerName, Divider, Drawing } from './display.jsx';
import { Button, Choice, TextInput, MultiChoice, Slider, Rank } from './input.jsx';
import { Reaction, Mash, TimingBar, TapTargets, DrawPad } from './widgets.jsx';

// One trusted component per block type (plan §12b). Must match server/src/games/kit/blocks.js:
// a server test checks every block there has an entry here.
export const BLOCK_COMPONENTS = {
  column: Column,
  row: Row,
  grid: Grid,
  card: Card,
  text: Text,
  image: Image,
  timer: Timer,
  progress: Progress,
  scoreboard: Scoreboard,
  playerName: PlayerName,
  divider: Divider,
  button: Button,
  choice: Choice,
  textInput: TextInput,
  multiChoice: MultiChoice,
  slider: Slider,
  rank: Rank,
  reaction: Reaction,
  mash: Mash,
  timingBar: TimingBar,
  tapTargets: TapTargets,
  drawPad: DrawPad,
  drawing: Drawing,
};

/**
 * Draws a list of blocks. The server has already checked them; an unknown type here means
 * the client is out of date, so it throws and GameScreen shows "Waiting…" instead.
 */
export function Blocks({ blocks }) {
  return blocks.map((block, i) => {
    const Component = Object.hasOwn(BLOCK_COMPONENTS, block.type) ? BLOCK_COMPONENTS[block.type] : null;
    if (!Component) throw new Error(`unknown block type ${JSON.stringify(block.type)}`);
    // Blocks have no ids; their position is stable for the life of one screen.
    return <Component key={i} block={block} />;
  });
}
