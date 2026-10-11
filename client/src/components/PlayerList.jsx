/**
 * The list of players in a room, used on both the host screen and phones.
 *
 * SECURITY: names come from other people. They are rendered as {player.name}, which
 * React always treats as plain text, so a name like "<img onerror=...>" just shows up
 * as those characters. Never use dangerouslySetInnerHTML for anything user-provided.
 *
 * @param {{ players: {id: string, name: string, connected: boolean}[], youId?: string, large?: boolean }} props
 */
export default function PlayerList({ players, youId, large = false }) {
  if (players.length === 0) return null;
  return (
    <ul className={large ? 'player-list player-list-large' : 'player-list'}>
      {players.map((player) => (
        <li key={player.id} className={player.connected ? '' : 'disconnected'}>
          {player.name}
          {player.id === youId && <span className="you-tag"> (you)</span>}
        </li>
      ))}
    </ul>
  );
}
