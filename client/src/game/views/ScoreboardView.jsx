/**
 * { view: 'scoreboard', title, rows: [{ playerId, score }] }: rows in the order the game sent.
 * Games send ids, not names; names come from the room's player list (as plain text).
 */
export default function ScoreboardView({ view, players = [], youId }) {
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  return (
    <div className="view view-scoreboard">
      <h2>{view.title}</h2>
      <ol className="scoreboard">
        {view.rows.map((row) => (
          <li key={row.playerId} className={row.playerId === youId ? 'you' : ''}>
            <span className="scoreboard-name">
              {nameOf.get(row.playerId) ?? '(left the room)'}
              {row.playerId === youId && ' (you)'}
            </span>
            <span className="scoreboard-score">{row.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
