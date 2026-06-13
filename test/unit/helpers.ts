import { SourceKind, Surface, UsageEvent } from '../../src/domain/types';

let counter = 0;

/** Build a UsageEvent with sensible defaults for tests. */
export function makeEvent(partial: Partial<UsageEvent> & { ts: number }): UsageEvent {
  counter += 1;
  const credits = partial.credits ?? 1;
  const base: UsageEvent = {
    id: partial.id ?? `e${counter}`,
    ts: partial.ts,
    modelId: partial.modelId ?? 'gpt-4o',
    surface: (partial.surface ?? 'chat') as Surface,
    source: (partial.source ?? 'local') as SourceKind,
    credits,
    cost: partial.cost ?? credits * 0.04,
    estimated: partial.estimated ?? false,
  };
  return {
    ...base,
    ...(partial.promptTokens !== undefined ? { promptTokens: partial.promptTokens } : {}),
    ...(partial.completionTokens !== undefined ? { completionTokens: partial.completionTokens } : {}),
    ...(partial.repo !== undefined ? { repo: partial.repo } : {}),
    ...(partial.costByCategory !== undefined ? { costByCategory: partial.costByCategory } : {}),
  };
}
