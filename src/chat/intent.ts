/**
 * Pure natural-language → intent mapping for the @weevil participant.
 */
import { Granularity, Metric } from '../model/types';

export type IntentKind = 'today' | 'forecast' | 'models' | 'repos' | 'tips' | 'summary';

export interface ChatIntent {
  kind: IntentKind;
  metric: Metric;
  granularity: Granularity;
}

const COMMANDS: IntentKind[] = ['today', 'forecast', 'models', 'repos', 'tips', 'summary'];

export function parseIntent(prompt: string, command?: string): ChatIntent {
  const p = (prompt || '').toLowerCase();

  let kind: IntentKind = 'summary';
  if (command && COMMANDS.includes(command as IntentKind)) {
    kind = command as IntentKind;
  } else if (/forecast|project|month.?end|rest of (the )?month|will i/.test(p)) {
    kind = 'forecast';
  } else if (/which model|by model|per model|models?\b/.test(p)) {
    kind = 'models';
  } else if (/which repo|by repo|per repo|repos?\b|repositor/.test(p)) {
    kind = 'repos';
  } else if (/\btip|save|reduce|cheaper|spend less/.test(p)) {
    kind = 'tips';
  } else if (/today|so far/.test(p)) {
    kind = 'today';
  }

  const metric: Metric = /token/.test(p)
    ? 'tokens'
    : /credit|request|premium/.test(p)
      ? 'credits'
      : 'cost';

  let granularity: Granularity = 'day';
  if (/hour/.test(p)) granularity = 'hour';
  else if (/week/.test(p)) granularity = 'week';
  else if (/quarter/.test(p)) granularity = 'quarter';
  else if (/year/.test(p)) granularity = 'year';
  else if (/month/.test(p)) granularity = 'month';

  return { kind, metric, granularity };
}
