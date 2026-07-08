import { SourceKind, Surface, UsageEvent } from '../../src/extension-backend/domain/types';
import { VscodeHost } from '../../src/extension-backend/util/vscodeHost';

export interface StubVscodeHost extends VscodeHost {
  warnings: string[];
  commands: Array<{ command: string; args: unknown[] }>;
}

export function makeStubVscodeHost(): StubVscodeHost {
  const warnings: string[] = [];
  const commands: Array<{ command: string; args: unknown[] }> = [];
  return {
    warnings,
    commands,
    showWarningMessage: (msg) => { warnings.push(msg); return Promise.resolve(undefined); },
    executeCommand: (cmd, ...args) => { commands.push({ command: cmd, args }); return Promise.resolve(undefined); },
  };
}

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
    ...(partial.branch !== undefined ? { branch: partial.branch } : {}),
    ...(partial.attribution !== undefined ? { attribution: partial.attribution } : {}),
    ...(partial.language !== undefined ? { language: partial.language } : {}),
    ...(partial.costByCategory !== undefined ? { costByCategory: partial.costByCategory } : {}),
  };
}
