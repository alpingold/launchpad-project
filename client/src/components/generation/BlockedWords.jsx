/**
 * Why a game can't go public (plan §49): words its name or description can't have, shown in
 * place and highlighted, so its creator sees exactly what to change. The server found them
 * (server/src/games/wordFilter.js) and sends `blocked` with the BLOCKED_WORDS error.
 *
 * @param {{ blocked: { field: string, text: string, words: { word: string, start: number, end: number }[] }[],
 *   fix?: import('react').ReactNode }} props  fix: where to change them
 */
export default function BlockedWords({ blocked, fix }) {
  return (
    <div className="blocked-words" role="alert">
      <p>
        <strong>Some words can't be in a public game.</strong> Change the highlighted words, then try again.
      </p>
      <dl>
        {blocked.map(({ field, text, words }) => (
          <div key={field}>
            <dt>{FIELD_NAMES[field] ?? field}</dt>
            <dd>{highlighted(text, words)}</dd>
          </div>
        ))}
      </dl>
      {fix && <p className="small">{fix}</p>}
    </div>
  );
}

const FIELD_NAMES = { name: 'Name', description: 'Description' };

/** The text, with each blocked word in a <mark>. */
function highlighted(text, words) {
  const parts = [];
  let at = 0;
  for (const { start, end } of words) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));
  return parts;
}
