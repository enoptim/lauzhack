// Just enough Markdown for the assistant's replies: paragraphs, lists, headings, **bold** and `code`.
// Builds React elements only (no innerHTML), so model output can't inject markup.
import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

type Block = { kind: 'p' | 'h'; text: string; items?: never } | { kind: 'ul' | 'ol'; items: string[]; text?: never };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const kind = numbered ? 'ol' : 'ul';
      const last = blocks.at(-1);
      const item = (bullet ?? numbered)![1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (heading) {
      endParagraph();
      blocks.push({ kind: 'h', text: heading[1] });
    } else if (line) {
      paragraph.push(line);
    } else {
      endParagraph();
    }
  }
  endParagraph();
  return blocks;
}

/** caret: the reply is still being written; a blinking block ends the text so far. */
export default function Markdown({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks = parse(text);
  const mark = <span aria-hidden="true" className="twin-caret" />;
  if (caret && !blocks.length) return <p>{mark}</p>;
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => {
        const end = caret && i === blocks.length - 1 ? mark : null;
        if (block.items) {
          const List = block.kind === 'ol' ? 'ol' : 'ul';
          return (
            <List key={i} className={List === 'ul' ? 'flex list-disc flex-col gap-1 pl-5' : 'flex list-decimal flex-col gap-1 pl-5'}>
              {block.items.map((item, j) => <li key={j}>{inline(item)}{j === block.items.length - 1 && end}</li>)}
            </List>
          );
        }
        return <p key={i} className={block.kind === 'h' ? 'font-semibold' : undefined}>{inline(block.text)}{end}</p>;
      })}
    </div>
  );
}
