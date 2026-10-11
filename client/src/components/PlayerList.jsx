/**
 * The list of players in a room, used on both the host screen and phones.
 *
 * SECURITY: names come from other people. They are rendered as {player.name}, which
 * React always treats as plain text, so a name like "<img onerror=...>" just shows up
 * as those characters. Never use dangerouslySetInnerHTML for anything user-provided.
 *
 * @param {Object} props
 * @param {{id: string, name: string, connected: boolean}[]} props.players
 * @param {string} [props.youId]     marks this player with "(you)"
 * @param {boolean} [props.large]    big-screen sizing
 * @param {(player: {id: string, name: string}) => void} [props.onKick]  shows a remove button (host only)
 */
export default function PlayerList({ players, youId, large = false, onKick }) {
  if (players.length === 0) return null;
  return (
    <ul className={large ? 'player-list player-list-large' : 'player-list'}>
      {players.map((player) => (
        <li key={player.id} className={player.connected ? '' : 'disconnected'}>
          {player.name}
          {player.id === youId && <span className="you-tag"> (you)</span>}
          {!player.connected && <span className="you-tag"> (reconnecting…)</span>}
          {onKick && (
            <button
              type="button"
              className="kick-button"
              aria-label={`Remove ${player.name}`}
              title={`Remove ${player.name}`}
              onClick={() => onKick(player)}
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
