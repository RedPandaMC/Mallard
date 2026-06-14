/**
 * Hand-written lexer for the alert-rule expression language.
 * Returns a flat list of tokens with byte-offset spans for diagnostics.
 */
import { ExprEvalError } from './ast';

// (re-exported via class import)

export type TokenKind = 'number' | 'string' | 'ident' | 'keyword' | 'punct' | 'op' | 'eof';

export interface Token {
  kind: TokenKind;
  /** For 'ident' | 'keyword': the identifier text. For 'string' | 'number': the value as parsed. */
  value: string;
  /** For 'op' | 'punct': the exact source text. */
  text: string;
  start: number;
  end: number;
}

const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'and',
  'or',
  'not',
  'in',
  'contains',
  'startsWith',
  'endsWith',
]);

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentCont(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const err = (msg: string, pos: number): never => {
    throw new ExprEvalError({ message: msg, pointer: String(pos) });
  };

  while (i < input.length) {
    const c = input[i]!;

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    // Numbers
    if (isDigit(c) || (c === '.' && isDigit(input[i + 1] ?? '') && input[i + 1] !== '.')) {
      const start = i;
      while (i < input.length && isDigit(input[i]!)) i++;
      if (input[i] === '.' && input[i + 1] !== '.') {
        i++;
        while (i < input.length && isDigit(input[i]!)) i++;
      }
      // Optional duration suffix
      let value = input.slice(start, i);
      if (
        i < input.length &&
        (input[i] === 'm' || input[i] === 'h' || input[i] === 'd' || input[i] === 'w')
      ) {
        // only treat as duration if not part of an identifier-like sequence;
        // we disambiguate: if a letter immediately follows, peek another ident char.
        // In practice durations are written like '30m', so we require the
        // preceding context to be a bare integer.
        const unit = input[i]!;
        if (i + 1 === input.length || !isIdentCont(input[i + 1] ?? '')) {
          i++;
          value = value + unit;
        }
      }
      out.push({ kind: 'number', value, text: value, start, end: i });
      continue;
    }

    // Identifiers and keywords
    if (isIdentStart(c)) {
      const start = i;
      while (i < input.length && isIdentCont(input[i]!)) i++;
      const text = input.slice(start, i);
      if (KEYWORDS.has(text)) {
        out.push({ kind: 'keyword', value: text, text, start, end: i });
      } else {
        out.push({ kind: 'ident', value: text, text, start, end: i });
      }
      continue;
    }

    // Strings (single or double quoted)
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let value = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1]!;
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else if (next === 'r') value += '\r';
          else if (next === '\\') value += '\\';
          else if (next === quote) value += quote;
          else value += next;
          i += 2;
        } else {
          value += input[i];
          i++;
        }
      }
      if (i >= input.length) err('Unterminated string literal', start);
      i++; // closing quote
      out.push({ kind: 'string', value, text: input.slice(start, i), start, end: i });
      continue;
    }

    // Multi-char operators
    if (c === '=' && input[i + 1] === '=') {
      out.push({ kind: 'op', value: '==', text: '==', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '!' && input[i + 1] === '=') {
      out.push({ kind: 'op', value: '!=', text: '!=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '>' && input[i + 1] === '=') {
      out.push({ kind: 'op', value: '>=', text: '>=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '<' && input[i + 1] === '=') {
      out.push({ kind: 'op', value: '<=', text: '<=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '?' && input[i + 1] === '?') {
      out.push({ kind: 'op', value: '??', text: '??', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // `..` range operator — must be checked before the single-dot check
    if (c === '.' && input[i + 1] === '.') {
      out.push({ kind: 'op', value: '..', text: '..', start: i, end: i + 2 });
      i += 2;
      continue;
    }

    // Single-char operators/punctuation
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%' || c === '>' || c === '<') {
      out.push({ kind: 'op', value: c, text: c, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === ',' || c === '$' || c === '.') {
      out.push({ kind: 'punct', value: c, text: c, start: i, end: i + 1 });
      i++;
      continue;
    }

    err(`Unexpected character '${c}'`, i);
  }

  out.push({ kind: 'eof', value: '', text: '', start: i, end: i });
  return out;
}
