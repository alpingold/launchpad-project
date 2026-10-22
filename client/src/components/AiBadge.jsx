/**
 * Marks a game the AI made (plan §11), or a game file someone uploaded (plan §57), so hosts know
 * it isn't one of the hand-made games. A game still in playtest is visible only to its owner,
 * so say so.
 *
 * @param {{ game: { source?: 'official' | 'generated', madeBy?: 'ai' | 'upload', status?: string, version?: number } }} props
 */
export default function AiBadge({ game }) {
  if (game.source !== 'generated') return null;
  const label = game.madeBy === 'upload' ? 'Uploaded' : 'AI-made';
  if (game.status !== 'playtest') return <span className="ai-badge">{label}</span>;
  return <span className="ai-badge">{`${label} · v${game.version} playtest, only you`}</span>;
}
