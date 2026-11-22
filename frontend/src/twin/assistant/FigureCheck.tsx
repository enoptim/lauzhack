// One quiet line under a reply: whether every figure in it matches the building model's results.
// The server compares each number with a unit (CHF, %, years, kWh, ppm …) with that turn's results (chat/grounding.py).
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ChatVerification } from '@/api/types';

const count = (n: number) => `${n} figure${n === 1 ? '' : 's'}`;

export default function FigureCheck({ check }: { check: ChatVerification }) {
  if (!check.checked) return null;
  const fixed = check.repaired ? ` A first draft had ${count(check.first_draft_unsupported.length)} that didn’t, so it was rewritten.` : '';
  const text = check.ok
    ? `${check.checked === 1 ? 'The 1 figure matches' : `All ${check.checked} figures match`} the building model.${fixed}`
    : `${count(check.unsupported.length)} could not be checked against the building model: ${check.unsupported.join(', ')}. Treat ${check.unsupported.length === 1 ? 'it' : 'them'} with care.`;
  const Icon = check.ok ? CircleCheck : CircleAlert;
  return (
    <p className="flex items-start gap-1.5 text-xs text-pretty text-muted-foreground"
      title="Each number with a unit (CHF, %, years, kWh …) was compared with the building model’s results for this question.">
      <Icon aria-hidden="true" className={check.ok ? 'mt-px size-3.5 shrink-0' : 'mt-px size-3.5 shrink-0 text-warning'} />
      <span>{text}</span>
    </p>
  );
}
