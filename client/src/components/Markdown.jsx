/**
 * Shows a small Markdown text (a game design, plan §13i; the game SDK guide) as React
 * elements: headings, paragraphs, lists, code blocks, and `code` and **bold** inside lines.
 * Everything else stays plain text. It never builds HTML from the text, so a design written
 * by the model (or anyone) can't put scripts or links into the page.
 *
 * @param {{ text: string, headingOffset?: number, className?: string }} props
 *   headingOffset: "#" becomes h(1 + offset), so a design inside a page starts at h3 or so.
 */
export default function Markdown({ text, headingOffset = 0, className = 'markdown' }) {
  return <div className={className}>{blocks(String(text ?? '')).map((block, i) => render(block, i, headingOffset))}</div>;
}

/** Splits the text into blocks: { kind: 'heading' | 'code' | 'list' | 'para', ... } */
function blocks(text) {
  const out = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      out.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    const item = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = item[1] !== undefined;
      const last = out.at(-1);
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item[2]);
      else out.push({ kind: 'list', ordered, start: ordered ? Number(item[1]) : 1, items: [item[2]] });
      continue;
    }
    if (line.trim() === '') {
      out.push({ kind: 'break' });
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === 'para') last.text += ` ${line.trim()}`;
    else if (last?.kind === 'list' && /^\s{2,}\S/.test(line)) last.items[last.items.length - 1] += ` ${line.trim()}`;
    else out.push({ kind: 'para', text: line.trim() });
  }
  return out.filter((b) => b.kind !== 'break');
}

function render(block, key, headingOffset) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(6, block.level + headingOffset)}`;
      return <Tag key={key}>{inline(block.text)}</Tag>;
    }
    case 'code':
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case 'list': {
      const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>);
      return block.ordered ? (
        <ol key={key} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    default:
      return <p key={key}>{inline(block.text)}</p>;
  }
}

/** `code` and **bold** inside a line; the rest is text. */
function inline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    if (/^`[^`]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}
