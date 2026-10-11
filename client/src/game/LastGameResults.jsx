/**
 * Shown in the lobby after a game: who won. Names come from the room's player list,
 * rendered as plain text.
 *
 * @param {{ results: {rankings?: string[], error?: true} | null, players: {id: string, name: string}[], youId?: string }} props
 */
export default function LastGameResults({ results, players, youId }) {
  const winnerId = results?.rankings?.[0];
  if (!winnerId) return null;
  const winner = players.find((p) => p.id === winnerId);
  return (
    <p className="last-results" role="status">
      🏆 {winnerId === youId ? 'You won the last game!' : `${winner?.name ?? 'Someone'} won the last game!`}
    </p>
  );
}
