/**
 * AST for the alert-rule expression language.
 *
 * Grammar (informal):
 *   expr      := or
 *   or        := and ( 'or' and )*
 *   and       := not ( 'and' not )*
 *   not       := 'not' not | cmp
 *   cmp       := add ( ( '==' | '!=' | '>=' | '<=' | '>' | '<' ) add )?
 *   add       := mul ( ( '+' | '-' ) mul )*
 *   mul       := unary ( ( '*' | '/' | '%' ) unary )*
 *   unary     := '-' unary | primary
 *   primary   := literal | path | call | '(' expr ')' | list | range
 *   literal   := number | string | 'true' | 'false' | 'null'
 *   path      := IDENT ( '.' IDENT | '[' expr ']' )*
 *   list      := '[' (expr (',' expr)*)? ']'
 *   range     := '[' expr '..' expr ']'
 *   call      := IDENT '(' (expr (',' expr)*)? ')'
 */
export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'path'; parts: PathPart[] }
  | { kind: 'index'; base: Expr; key: Expr }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'unary'; op: UnaryOp; arg: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'list'; items: Expr[] }
  | { kind: 'range'; start: Expr; end: Expr }
  | { kind: 'var'; name: string };

export type PathPart = { kind: 'ident'; name: string } | { kind: 'index'; index: Expr };

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'and'
  | 'or'
  | 'in'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | '??';

export type UnaryOp = '-' | 'not';

export type ValueType = 'number' | 'string' | 'bool' | 'list' | 'duration' | 'unknown';

export type Value = number | string | boolean | null | Value[];

export interface ExprError {
  message: string;
  pointer?: string;
}

export class ExprEvalError extends Error {
  constructor(public readonly exprError: ExprError) {
    super(exprError.message);
    this.name = 'ExprEvalError';
  }
}
