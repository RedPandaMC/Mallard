/**
 * Drift guard: schemas/mallard-config.schema.json (editor validation) and the
 * zod ConfigSchema in UserConfigStore (runtime validation) describe the same
 * config.json independently. When they disagree, the editor blesses fields the
 * runtime strips — historically the `conditions` rule shorthand passed editor
 * validation but failed the runtime parse, silently resetting the whole
 * config. This test walks both trees and asserts property-name parity for
 * every plain-object node.
 */
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ConfigSchema } from '../../../src/extension-backend/app/UserConfigStore';

type JsonNode = {
  type?: string;
  properties?: Record<string, JsonNode>;
  items?: JsonNode;
  $ref?: string;
  [k: string]: unknown;
};

const doc = JSON.parse(
  readFileSync(path.join(__dirname, '../../../schemas/mallard-config.schema.json'), 'utf8'),
) as JsonNode & { $defs?: Record<string, JsonNode>; definitions?: Record<string, JsonNode> };

function resolveRef(node: JsonNode): JsonNode {
  if (!node.$ref) return node;
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(node.$ref);
  if (!m) return node;
  const bucket = m[1] === '$defs' ? doc.$defs : doc.definitions;
  return bucket?.[m[2]!] ?? node;
}

/** Strip optional/default/nullable wrappers to the underlying zod type. */
function unwrap(t: unknown): unknown {
  let cur = t as { def?: { type?: string; innerType?: unknown } };
  for (let i = 0; i < 10; i++) {
    const kind = cur?.def?.type;
    if (kind === 'optional' || kind === 'default' || kind === 'nullable') {
      cur = cur.def!.innerType as typeof cur;
    } else {
      return cur;
    }
  }
  /* c8 ignore next */
  return cur;
}

function zodKind(t: unknown): string | undefined {
  return (t as { def?: { type?: string } })?.def?.type;
}

function zodShape(t: unknown): Record<string, unknown> | undefined {
  return (t as { shape?: Record<string, unknown> })?.shape;
}

function zodElement(t: unknown): unknown {
  return (t as { def?: { element?: unknown } })?.def?.element;
}

/** Recursively assert property-name parity wherever BOTH sides are plain
 *  objects with named properties. Unions/conditions/records stop the walk. */
function assertParity(zodType: unknown, jsonNode: JsonNode, at: string): void {
  const zt = unwrap(zodType);
  const jn = resolveRef(jsonNode);

  if (zodKind(zt) === 'array' && jn.type === 'array' && jn.items) {
    assertParity(zodElement(zt), jn.items, `${at}[]`);
    return;
  }

  const shape = zodShape(zt);
  if (zodKind(zt) !== 'object' || !shape || !jn.properties) return;

  const zodKeys = Object.keys(shape).sort();
  const jsonKeys = Object.keys(jn.properties).sort();
  assert.deepEqual(
    jsonKeys,
    zodKeys,
    `property drift at "${at}" — JSON schema [${jsonKeys.join(', ')}] vs zod [${zodKeys.join(', ')}]`,
  );
  for (const key of zodKeys) {
    assertParity(shape[key], jn.properties[key]!, at ? `${at}.${key}` : key);
  }
}

describe('config schema drift guard', () => {
  it('zod ConfigSchema and mallard-config.schema.json declare the same properties', () => {
    assert.ok(ConfigSchema instanceof z.ZodObject, 'ConfigSchema is an object schema');
    assertParity(ConfigSchema, doc, '');
  });

  it('every documented rule field survives a runtime parse (no silent stripping)', () => {
    const rule = {
      id: 'r1',
      severity: 'warning',
      message: 'over {{ today.credits }}',
      conditions: [{ field: 'today.credits', op: '>', value: 100 }],
      match: 'all',
      thresholds: [{ field: 'today.credits', op: '>', value: 200, severity: 'critical' }],
      snoozeUntil: '2026-12-01T00:00:00Z',
    };
    const parsed = ConfigSchema.safeParse({ rules: [rule] });
    assert.ok(parsed.success, `documented rule shape must parse: ${JSON.stringify(parsed)}`);
    const out = parsed.data.rules?.[0] as Record<string, unknown>;
    for (const key of Object.keys(rule)) {
      assert.ok(key in out, `rule field "${key}" must survive the parse`);
    }
  });

  it('a rule using only the conditions shorthand (no "when") parses', () => {
    const parsed = ConfigSchema.safeParse({
      rules: [
        {
          id: 'shorthand',
          message: 'daily limit',
          conditions: [{ field: 'today.credits', op: '>=', value: 50 }],
        },
      ],
    });
    assert.ok(parsed.success, 'conditions-only rules are documented and must parse');
  });
});
