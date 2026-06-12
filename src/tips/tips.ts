/**
 * Cost-saving tip catalog. Some tips are contextual — surfaced first when the
 * current snapshot suggests they're relevant.
 */
import { Tip, UsageSnapshot } from '../model/types';
import { resolveMultiplier } from '../model/pricing';

export const TIPS: Tip[] = [
  {
    id: 'right-size-model',
    title: 'Right-size the model',
    body: 'Routine completions and small edits rarely need your most expensive model. Switch to a lighter model for boilerplate and save premium requests for hard problems.',
  },
  {
    id: 'inline-over-chat',
    title: 'Prefer inline for small asks',
    body: 'Inline completions are cheaper than multi-turn chat or agent runs for one-liners and quick fixes.',
  },
  {
    id: 'tighten-prompts',
    title: 'Tighten your prompts',
    body: 'Long pasted context inflates token use. Reference files and symbols instead of pasting whole files.',
  },
  {
    id: 'watch-agent-loops',
    title: 'Watch agent loops',
    body: 'Agent mode can fan out into many premium requests. Cap the scope and review the plan before letting it run.',
  },
  {
    id: 'use-included-first',
    title: 'Use your included credits first',
    body: 'Your plan includes a monthly allowance of premium requests. Weevil shows when you are approaching it so overage never surprises you.',
  },
  {
    id: 'batch-questions',
    title: 'Batch related questions',
    body: 'One well-scoped chat thread usually costs less than many cold starts on the same task.',
  },
];

const byId = new Map(TIPS.map((t) => [t.id, t]));

/** Pick a tip, preferring a contextually relevant one for the given snapshot. */
export function pickTip(snapshot: UsageSnapshot | undefined, seed = Date.now()): Tip {
  if (snapshot) {
    const top = snapshot.topModels[0];
    if (top && resolveMultiplier(top.key) >= 5) {
      return byId.get('right-size-model') ?? TIPS[0];
    }
    if (snapshot.budget.pace === 'warning' || snapshot.budget.pace === 'over') {
      return byId.get('watch-agent-loops') ?? TIPS[0];
    }
  }
  return TIPS[seed % TIPS.length];
}
