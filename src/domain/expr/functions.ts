/**
 * Built-in functions for the expression language. Each entry is a pure JS
 * function called with already-evaluated arguments. The host registers extra
 * functions (e.g. `sum`, `avg`) here as features are added.
 */
import { Value, ValueType } from './ast';

export type FunctionImpl = (args: Value[], ctx: { vars: Record<string, Value> }) => Value;

export interface FunctionSpec {
  name: string;
  minArity: number;
  maxArity: number;
  returnType: ValueType;
  impl: FunctionImpl;
  description: string;
  /** Argument type hints, used by staticCheck to surface better diagnostics. */
  argTypes?: ValueType[];
}

const FUNCTIONS = new Map<string, FunctionSpec>();

export function registerFunction(spec: FunctionSpec): void {
  FUNCTIONS.set(spec.name, spec);
}

export function getFunction(name: string): FunctionSpec | undefined {
  return FUNCTIONS.get(name);
}

function asNumber(v: Value, name: string): number {
  if (typeof v === 'number') return v;
  throw new Error(`function '${name}' expected a number, got ${v === null ? 'null' : typeof v}`);
}

function asList(v: Value, name: string): Value[] {
  if (Array.isArray(v)) return v;
  throw new Error(`function '${name}' expected a list, got ${v === null ? 'null' : typeof v}`);
}

function asNumberList(v: Value, name: string): number[] {
  const list = asList(v, name);
  return list.map((x) => asNumber(x, name));
}

function flatten(v: Value): Value[] {
  if (!Array.isArray(v)) return [v];
  const out: Value[] = [];
  for (const x of v) out.push(...flatten(x));
  return out;
}

// ── Core numeric helpers ─────────────────────────────────────────────────────

registerFunction({
  name: 'abs',
  minArity: 1,
  maxArity: 1,
  returnType: 'number',
  argTypes: ['number'],
  impl: (args) => Math.abs(asNumber(args[0]!, 'abs')),
  description: 'absolute value of a number',
});

registerFunction({
  name: 'round',
  minArity: 1,
  maxArity: 2,
  returnType: 'number',
  argTypes: ['number', 'number'],
  impl: (args) => {
    const num = asNumber(args[0]!, 'round');
    const decimalPlaces = args.length > 1 ? asNumber(args[1]!, 'round') : 0;
    const magnitude = Math.pow(10, decimalPlaces);
    return Math.round(num * magnitude) / magnitude;
  },
  description: 'round a number to `n` decimal places (default 0)',
});

registerFunction({
  name: 'floor',
  minArity: 1,
  maxArity: 1,
  returnType: 'number',
  argTypes: ['number'],
  impl: (args) => Math.floor(asNumber(args[0]!, 'floor')),
  description: 'largest integer ≤ x',
});

registerFunction({
  name: 'ceil',
  minArity: 1,
  maxArity: 1,
  returnType: 'number',
  argTypes: ['number'],
  impl: (args) => Math.ceil(asNumber(args[0]!, 'ceil')),
  description: 'smallest integer ≥ x',
});

registerFunction({
  name: 'min',
  minArity: 1,
  maxArity: -1,
  returnType: 'number',
  argTypes: ['number'],
  impl: (args) => {
    if (args.length === 1 && Array.isArray(args[0])) {
      const xs = asNumberList(args[0], 'min');
      return xs.length === 0 ? 0 : Math.min(...xs);
    }
    return Math.min(...args.map((x) => asNumber(x, 'min')));
  },
  description: 'minimum of its arguments (or of a list)',
});

registerFunction({
  name: 'max',
  minArity: 1,
  maxArity: -1,
  returnType: 'number',
  argTypes: ['number'],
  impl: (args) => {
    if (args.length === 1 && Array.isArray(args[0])) {
      const xs = asNumberList(args[0], 'max');
      return xs.length === 0 ? 0 : Math.max(...xs);
    }
    return Math.max(...args.map((x) => asNumber(x, 'max')));
  },
  description: 'maximum of its arguments (or of a list)',
});

registerFunction({
  name: 'sum',
  minArity: 1,
  maxArity: 1,
  returnType: 'number',
  argTypes: ['list'],
  impl: (args) => {
    const xs = flatten(args[0]!);
    let total = 0;
    for (const x of xs) total += asNumber(x, 'sum');
    return total;
  },
  description: 'sum of a numeric list (or nested lists of numbers)',
});

registerFunction({
  name: 'avg',
  minArity: 1,
  maxArity: 1,
  returnType: 'number',
  argTypes: ['list'],
  impl: (args) => {
    const xs = flatten(args[0]!);
    if (xs.length === 0) return 0;
    let total = 0;
    for (const x of xs) total += asNumber(x, 'avg');
    return total / xs.length;
  },
  description: 'arithmetic mean of a numeric list',
});

registerFunction({
  name: 'count',
  minArity: 1,
  maxArity: 1,
  returnType: 'number',
  argTypes: ['list'],
  impl: (args) => flatten(args[0]!).length,
  description: 'count items in a list (recursively flattened)',
});

registerFunction({
  name: 'len',
  minArity: 1,
  maxArity: 1,
  returnType: 'number',
  impl: (args) => {
    const v = args[0]!;
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) return v.length;
    throw new Error("'len' expects a string or list");
  },
  description: 'length of a string or list',
});

registerFunction({
  name: 'percent',
  minArity: 1,
  maxArity: 2,
  returnType: 'string',
  argTypes: ['number', 'number'],
  impl: (args) => {
    const num = asNumber(args[0]!, 'percent');
    const decimalPlaces = args.length > 1 ? asNumber(args[1]!, 'percent') : 0;
    return `${(num * 100).toFixed(decimalPlaces)}%`;
  },
  description: 'format a fraction (0.83) as "83%" (used in message templates)',
});

// ── Placeholders for richer features; registered later by the host ───────────
// `window(metric, period)`, `change(metric, period)`, `distinct(...)`,
// `any/all/none`, `top(n, by)`, `cooldownLeft`, `timeSinceLastEvent` are
// added by the alert-rule engine once it knows the snapshot shape.
