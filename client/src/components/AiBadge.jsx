/**
 * Marks a game the AI made (plan §11), so hosts know it isn't one of the hand-made games.
 * A game still in playtest is visible only to its owner, so say so; an admin also sees one its
 * owner asked to publish (plan §44), to try it: that's someone else's (they may vote on it).
 *
 * @param {{ game: { source?: 'official' | 'generated', status?: string, version?: number, canVote?: boolean } }} props
 */
export default function AiBadge({ game }) {
  if (game.source !== 'generated') return null;
  if (game.status !== 'playtest') return <span className="ai-badge">AI-made</span>;
  return <span className="ai-badge">{`AI-made · v${game.version} playtest, ${game.canVote ? 'waiting for approval' : 'only you'}`}</span>;
}
