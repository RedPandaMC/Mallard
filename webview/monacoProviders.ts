/**
 * Monaco language configuration, completion provider, and hover provider for
 * the Weevil alert-rule document. Operates on the JSON envelope (so Monaco's
 * built-in JSON tooling — schema validation, bracket matching — still works)
 * and injects our expression language into the `when` / `active` / `derived`
 * string fields.
 */
import * as monaco from 'monaco-editor';
import { getFunction } from '../src/domain/expr/functions';
import { inferType } from '../src/domain/expr/staticCheck';
import { parseExpr } from '../src/domain/expr/parse';

// (reserved for future use; fields are detected by string-literal regex)
const EXPRESSION_FIELDS = new Set(['when', 'active']);
void EXPRESSION_FIELDS;

const IDENTIFIER_PARTS: { label: string; detail: string; insertText?: string }[] = [
  { label: 'today.credits', detail: 'Credits used today' },
  { label: 'today.cost', detail: 'USD cost today' },
  { label: 'today.tokens', detail: 'Tokens used today' },
  { label: 'month.credits', detail: 'Credits used month-to-date' },
  { label: 'month.cost', detail: 'USD cost month-to-date' },
  { label: 'window7d.credits', detail: 'Credits used in the last 7 days' },
  { label: 'budget.monthly', detail: 'Configured monthly USD budget (null if unset)' },
  { label: 'budget.includedCredits', detail: 'Included credits per month' },
  { label: 'budget.usedCredits', detail: 'MTD credits used' },
  { label: 'budget.usedCost', detail: 'MTD USD cost' },
  { label: 'budget.percentOfBudget', detail: 'MTD cost / monthly budget (0..n)' },
  { label: 'budget.percentOfIncluded', detail: 'MTD credits / included credits (0..1)' },
  { label: 'budget.projectedOverage', detail: 'forecast.projectedCost − budget, or null' },
  { label: 'budget.pace', detail: 'no-budget | under | on-track | warning | over' },
  { label: 'forecast.projectedCredits', detail: 'Projected month-end credits' },
  { label: 'forecast.projectedCost', detail: 'Projected month-end USD cost' },
  { label: 'forecast.low', detail: 'Forecast low band' },
  { label: 'forecast.high', detail: 'Forecast high band' },
  { label: 'forecast.basis', detail: 'linear | seasonal | insufficient-data' },
  { label: 'velocity.creditsPerHour', detail: 'Credits per hour over the rolling window' },
  { label: 'velocity.windowMinutes', detail: 'Window size in minutes' },
  { label: 'topModel.id', detail: 'Top model ID, or null' },
  { label: 'topModel.credits', detail: 'Top model credits' },
  { label: 'topModel.cost', detail: 'Top model USD cost' },
  { label: 'topRepo.id', detail: 'Top repo ID, or null' },
  { label: 'topRepo.credits', detail: 'Top repo credits' },
  { label: 'model', detail: 'map: model id → {credits, cost, tokens}' },
  { label: 'surface', detail: 'map: surface name → {credits, cost, tokens}' },
  { label: 'repo', detail: 'map: repo id → {credits, cost, tokens}' },
  { label: 'billing.netAmount', detail: 'GitHub billing net amount (USD), or null' },
  { label: 'billing.grossAmount', detail: 'GitHub billing gross amount (USD), or null' },
  { label: 'billing.quotaPercentRemaining', detail: '0..1, or 1 if unlimited' },
  { label: 'billing.unlimited', detail: 'true/false' },
  { label: 'now.weekday', detail: '0=Sunday .. 6=Saturday' },
  { label: 'now.hour', detail: '0..23' },
  { label: 'now.minute', detail: '0..59' },
  { label: 'now.iso', detail: 'ISO timestamp' },
  { label: 'now.ts', detail: 'Epoch ms' },
  { label: 'signedIn', detail: 'true when the user is signed in to GitHub' },
];

const OP_SUGGESTIONS: { label: string; detail: string; insertText: string }[] = [
  { label: '>', detail: 'greater than', insertText: ' > ' },
  { label: '>=', detail: 'greater or equal', insertText: ' >= ' },
  { label: '<', detail: 'less than', insertText: ' < ' },
  { label: '<=', detail: 'less or equal', insertText: ' <= ' },
  { label: '==', detail: 'equal', insertText: ' == ' },
  { label: '!=', detail: 'not equal', insertText: ' != ' },
  { label: 'and', detail: 'logical and', insertText: ' and ' },
  { label: 'or', detail: 'logical or', insertText: ' or ' },
  { label: 'not', detail: 'logical not', insertText: 'not ' },
  { label: 'in', detail: 'membership', insertText: ' in ' },
  { label: 'contains', detail: 'string/list contains', insertText: ' contains ' },
  { label: 'startsWith', detail: 'string prefix', insertText: ' startsWith ' },
  { label: 'endsWith', detail: 'string suffix', insertText: ' endsWith ' },
  { label: '??', detail: 'null coalesce', insertText: ' ?? ' },
];

const TEMPLATE_SNIPPETS: { label: string; detail: string; insertText: string }[] = [
  {
    label: 'rule.budget-80',
    detail: 'Budget 80% used',
    insertText: [
      '{',
      '  "id": "budget-80",',
      '  "severity": "warning",',
      '  "cooldown": "4h",',
      '  "message": "Used 80% of monthly budget",',
      '  "when": "budget.percentOfBudget >= 0.8 and budget.percentOfBudget < 1.0"',
      '}',
    ].join('\n'),
  },
  {
    label: 'rule.daily-50',
    detail: '50 credits in a day',
    insertText: [
      '{',
      '  "id": "daily-50",',
      '  "severity": "warning",',
      '  "cooldown": "6h",',
      '  "message": "Daily 50 credits reached",',
      '  "when": "today.credits >= 50"',
      '}',
    ].join('\n'),
  },
  {
    label: 'rule.velocity',
    detail: 'Fast spending',
    insertText: [
      '{',
      '  "id": "fast-spending",',
      '  "severity": "warning",',
      '  "cooldown": "1h",',
      '  "message": "Spending at {{velocity.creditsPerHour | round}} credits/hour",',
      '  "when": "velocity.creditsPerHour > 100 and velocity.windowMinutes >= 30"',
      '}',
    ].join('\n'),
  },
  {
    label: 'rule.premium-spike',
    detail: 'Premium models dominate',
    insertText: [
      '{',
      '  "id": "premium-spike",',
      '  "severity": "warning",',
      '  "cooldown": "30m",',
      '  "derived": { "premiumShare": "sum(model[$vars.premiumModels].credits) / max(today.credits, 1)" },',
      '  "message": "Premium models drove {{premiumShare | percent}} of today\'s spend",',
      '  "when": "premiumShare > 0.8"',
      '}',
    ].join('\n'),
  },
  {
    label: 'restrict.hard-budget',
    detail: 'Hard restrict when over budget',
    insertText: [
      '{',
      '  "mode": "hard",',
      '  "scope": "copilot",',
      '  "reEnableWhen": "budget.percentOfBudget < 0.8",',
      '  "graceMinutes": 10',
      '}',
    ].join('\n'),
  },
  {
    label: 'restrict.soft-nudge',
    detail: 'Soft nag when over budget',
    insertText: '{ "mode": "soft", "scope": "copilot" }',
  },
];

/** Provide identifier and function completions inside a string-literal value. */
function expressionProvider(): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: ['.', ' ', '$', '('],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      if (!/['"][^'"]*$/.test(before)) return { suggestions: [] };

      // Field: dollar-vars and identifiers
      const suggestions: monaco.languages.CompletionItem[] = [];
      for (const ident of IDENTIFIER_PARTS) {
        suggestions.push({
          label: ident.label,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: ident.insertText ?? ident.label,
          detail: ident.detail,
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
        });
      }
      for (const op of OP_SUGGESTIONS) {
        suggestions.push({
          label: op.label,
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: op.insertText,
          detail: op.detail,
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
        });
      }
      // Function names registered in the engine
      const funcs: { name: string; description: string; returnType: string }[] = [];
      // Lazy: import the function table indirectly via getFunction on known names
      for (const name of [
        'abs',
        'round',
        'floor',
        'ceil',
        'min',
        'max',
        'sum',
        'avg',
        'count',
        'len',
        'percent',
      ]) {
        const f = getFunction(name);
        if (f) funcs.push({ name: f.name, description: f.description, returnType: f.returnType });
      }
      for (const f of funcs) {
        suggestions.push({
          label: `${f.name}()`,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${f.name}($1)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: `${f.returnType} — ${f.description}`,
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
        });
      }
      return { suggestions };
    },
  };
}

function hoverProvider(): monaco.languages.HoverProvider {
  return {
    provideHover(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      if (!/['"][^'"]*$/.test(before)) return null;
      // Try to parse the substring up to the cursor and hover the trailing identifier
      const m = /([a-zA-Z_][\w.]*)\s*$/.exec(before);
      if (!m) return null;
      const word = m[1]!;
      const ident = IDENTIFIER_PARTS.find(
        (i) => i.label === word || i.label.startsWith(word + '.'),
      );
      if (ident) {
        return {
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
          contents: [{ value: `**${ident.label}**\n\n${ident.detail}` }],
        };
      }
      return null;
    },
  };
}

const RULE_DOC_SCHEMA: monaco.languages.json.JSONSchema = {
  $id: 'weevil/alert-rules',
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'number', enum: [1, 2] },
    vars: { type: 'object', additionalProperties: true },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'active'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9-]+$' },
          label: { type: 'string' },
          active: { type: 'string' },
        },
      },
    },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'message', 'when'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9-]+$' },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          cooldown: { type: 'string', pattern: '^\\d+\\s*[mhdw]$' },
          message: { type: 'string' },
          when: { type: 'string' },
          active: { type: 'string' },
          derived: { type: 'object', additionalProperties: { type: 'string' } },
          requiresAuth: { type: 'boolean' },
          notify: { type: 'boolean' },
          restrict: {
            type: 'object',
            required: ['mode', 'scope'],
            properties: {
              mode: { type: 'string', enum: ['soft', 'hard'] },
              scope: { type: 'string', enum: ['copilot', 'copilot+lab', 'custom'] },
              reEnableWhen: { type: 'string' },
              graceMinutes: { type: 'number', minimum: 0, maximum: 1440 },
            },
          },
        },
      },
    },
    budget: {
      type: 'object',
      required: ['monthlyUsd', 'includedCredits'],
      properties: {
        monthlyUsd: { type: 'number', minimum: 0 },
        includedCredits: { type: 'number', minimum: 0 },
      },
    },
  },
};

let installed = false;

export function installMonacoProviders(): void {
  if (installed) return;
  installed = true;
  // Disable Monaco's web workers — they would need a separate bundle and
  // worker-src: blob: handling. The editor degrades to synchronous mode,
  // which is fine for our read-mostly alert-rule document.
  type NoopWorker = {
    postMessage(msg: unknown, transfer?: Transferable[]): void;
    postMessage(msg: unknown, options?: StructuredSerializeOptions): void;
    terminate(): void;
    addEventListener(t: string, l: EventListenerOrEventListenerObject): void;
    removeEventListener(t: string, l: EventListenerOrEventListenerObject): void;
    dispatchEvent(ev: Event): boolean;
    onmessage: ((this: AbstractWorker, ev: MessageEvent) => unknown) | null;
    onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null;
  };
  const shim: NoopWorker = {
    postMessage() {
      /* no-op */
    },
    terminate() {
      /* no-op */
    },
    addEventListener() {
      /* no-op */
    },
    removeEventListener() {
      /* no-op */
    },
    dispatchEvent() {
      return true;
    },
    onmessage: null,
    onerror: null,
  };
  (self as unknown as { MonacoEnvironment?: { getWorker(): Worker } }).MonacoEnvironment = {
    getWorker() {
      return shim as unknown as Worker;
    },
  };
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    schemas: [
      {
        uri: 'weevil/alert-rules.json',
        fileMatch: ['*'],
        schema: RULE_DOC_SCHEMA,
      },
    ],
  });
  monaco.languages.registerCompletionItemProvider('json', expressionProvider());
  monaco.languages.registerHoverProvider('json', hoverProvider());
}

export function getTemplateSnippets(): typeof TEMPLATE_SNIPPETS {
  return TEMPLATE_SNIPPETS;
}

/** Diagnostic check the webview runs locally: best-effort parse + static type check. */
export function checkExpression(
  src: string,
): { ok: true; type: string } | { ok: false; error: string } {
  try {
    const ast = parseExpr(src);
    return { ok: true, type: inferType(ast) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
