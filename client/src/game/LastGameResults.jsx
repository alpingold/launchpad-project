/**
 * Shown in the lobby after a game: who won. Names come from the room's player list,
 * rendered as plain text.
 *
 * If the game sent scores, everyone with the top player's score shares the win (a tie).
 *
 * @param {{ results: {rankings?: string[], scores?: Record<string, number>, error?: true} | null, players: {id: string, name: string}[], youId?: string }} props
 */
export default function LastGameResults({ results, players, youId }) {
  const winnerId = results?.rankings?.[0];
  if (!winnerId) return null;

  const scores = results.scores;
  const topScore = scores?.[winnerId];
  const winnerIds =
    typeof topScore === 'number' ? results.rankings.filter((id) => scores[id] === topScore) : [winnerId];
  const nameOf = (id) => (id === youId ? 'You' : (players.find((p) => p.id === id)?.name ?? 'Someone'));

  let text;
  if (winnerIds.length > 1) {
    text = `It's a tie: ${winnerIds.map(nameOf).join(' & ')}!`;
  } else {
    text = winnerId === youId ? 'You won the last game!' : `${nameOf(winnerId)} won the last game!`;
  }
  return (
    <p className="last-results" role="status">
      🏆 {text}
    </p>
  );
}
