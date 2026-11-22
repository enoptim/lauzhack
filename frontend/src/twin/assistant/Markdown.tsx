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

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      {parse(text).map((block, i) => {
        if (block.items) {
          const List = block.kind === 'ol' ? 'ol' : 'ul';
          return (
            <List key={i} className={List === 'ul' ? 'flex list-disc flex-col gap-1 pl-5' : 'flex list-decimal flex-col gap-1 pl-5'}>
              {block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
            </List>
          );
        }
        return <p key={i} className={block.kind === 'h' ? 'font-semibold' : undefined}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
