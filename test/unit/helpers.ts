import { SourceKind, Surface, UsageEvent } from '../../src/model/types';

let counter = 0;

/** Build a UsageEvent with sensible defaults for tests. */
export function makeEvent(partial: Partial<UsageEvent> & { ts: number }): UsageEvent {
  counter += 1;
  const credits = partial.credits ?? 1;
  return {
    id: partial.id ?? `e${counter}`,
    ts: partial.ts,
    modelId: partial.modelId ?? 'gpt-4o',
    surface: (partial.surface ?? 'chat') as Surface,
    source: (partial.source ?? 'sample') as SourceKind,
    promptTokens: partial.promptTokens,
    completionTokens: partial.completionTokens,
    credits,
    cost: partial.cost ?? credits * 0.04,
    estimated: partial.estimated ?? false,
    repo: partial.repo,
    workspaceFolder: partial.workspaceFolder,
    chatId: partial.chatId,
  };
}
