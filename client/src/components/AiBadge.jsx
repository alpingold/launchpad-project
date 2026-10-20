/**
 * Marks a game the AI made (plan §11), so hosts know it isn't one of the hand-made games.
 * A game still in playtest is visible only to its owner, so say so.
 *
 * @param {{ game: { source?: 'official' | 'generated', status?: string, version?: number } }} props
 */
export default function AiBadge({ game }) {
  if (game.source !== 'generated') return null;
  if (game.status !== 'playtest') return <span className="ai-badge">AI-made</span>;
  return <span className="ai-badge">{`AI-made · v${game.version} playtest, only you`}</span>;
}
