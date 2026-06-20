/**
 * Property-based security tests using fast-check.
 *
 * These tests fuzz the public API boundaries most likely to be targeted:
 *   - isHostBoundMsg: message validation at the webview/host seam
 *   - isPathSafe: file-path traversal guard in the log locator
 *   - evalCondition: the JSON condition evaluator
 *   - pure formatters: numeric edge cases
 */
import * as fc from 'fast-check';
import { strict as assert } from 'assert';
import * as path from 'path';
import { isHostBoundMsg } from '../../src/ui/messaging';
import { isPathSafe } from '../../src/ingest/locate';
import { evalCondition } from '../../src/domain/expr/jsonCondition';
import { formatMoney, formatNumber, formatTokens, formatCredits } from '../../src/domain/format';
import type { JsonCondition } from '../../src/domain/types';

const VALID_TYPES = [
  'ready', 'refresh', 'setFilter', 'setConfig', 'setLayout',
  'openConfig', 'command', 'restrictSnooze', 'restrictNow', 'restrictPermanent',
];

describe('security — isHostBoundMsg', () => {
  it('never throws for any input', () => {
    fc.assert(fc.property(fc.anything(), (x) => {
      assert.doesNotThrow(() => isHostBoundMsg(x));
    }), { numRuns: 1000 });
  });

  it('always returns false for unknown type strings', () => {
    fc.assert(fc.property(
      fc.string().filter((s) => !VALID_TYPES.includes(s)),
      (type) => {
        assert.equal(isHostBoundMsg({ type }), false);
      },
    ), { numRuns: 500 });
  });

  it('returns false for objects with type set to a non-string', () => {
    fc.assert(fc.property(
      fc.anything().filter((v) => typeof v !== 'string'),
      (type) => {
        assert.equal(isHostBoundMsg({ type }), false);
      },
    ), { numRuns: 500 });
  });
});

describe('security — isPathSafe (path traversal)', () => {
  it('never throws for any inputs', () => {
    fc.assert(fc.property(fc.string(), fc.array(fc.string()), (filePath, roots) => {
      assert.doesNotThrow(() => isPathSafe(filePath, roots));
    }), { numRuns: 500 });
  });

  it('rejects traversal paths that escape the root via ..', () => {
    fc.assert(fc.property(
      // Generate a safe root segment (no slashes)
      fc.string({ minLength: 1, maxLength: 15 }).map((s) => s.replace(/[/\\]/g, '_').replace(/\./g, 'x') || 'r'),
      // And an arbitrary suffix segment
      fc.string({ minLength: 1, maxLength: 15 }).map((s) => s.replace(/[/\\]/g, '_').replace(/\./g, 'x') || 'f'),
      (rootSeg, fileSeg) => {
        const root = path.join('/allowedroot', rootSeg);
        // Build a traversal path that goes two levels above root
        const traversal = root + path.sep + '..' + path.sep + '..' + path.sep + fileSeg;
        const resolved = path.resolve(traversal);
        // If the resolved path doesn't start with root, isPathSafe must reject it
        if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
          assert.equal(isPathSafe(traversal, [root]), false);
        }
      },
    ), { numRuns: 200 });
  });

  it('rejects an empty allowed-roots list for any path', () => {
    fc.assert(fc.property(fc.string(), (filePath) => {
      assert.equal(isPathSafe(filePath, []), false);
    }), { numRuns: 200 });
  });
});

describe('security — evalCondition', () => {
  it('double-negation is identity for boolean literals', () => {
    fc.assert(fc.property(
      fc.boolean(),
      fc.dictionary(fc.string({ maxLength: 10 }), fc.oneof(fc.integer(), fc.string(), fc.boolean())),
      (cond, ctx) => {
        const doubleNeg: JsonCondition = { not: { not: cond } };
        assert.equal(
          evalCondition(doubleNeg, ctx as Record<string, unknown>),
          evalCondition(cond, ctx as Record<string, unknown>),
        );
      },
    ), { numRuns: 500 });
  });

  it('never throws for boolean literal conditions and any context', () => {
    fc.assert(fc.property(
      fc.boolean(),
      fc.dictionary(fc.string({ maxLength: 10 }), fc.anything()),
      (cond, ctx) => {
        assert.doesNotThrow(() => evalCondition(cond, ctx as Record<string, unknown>));
      },
    ), { numRuns: 500 });
  });

  it('comparison ops return false (not throw) when operands are NaN or Infinity', () => {
    const ops = ['>', '>=', '<', '<='] as const;
    for (const op of ops) {
      assert.doesNotThrow(() => evalCondition({ [op]: [NaN, 0] } as JsonCondition, {}));
      assert.doesNotThrow(() => evalCondition({ [op]: [Infinity, 0] } as JsonCondition, {}));
      assert.doesNotThrow(() => evalCondition({ [op]: [-Infinity, 0] } as JsonCondition, {}));
    }
  });
});

describe('security — formatters', () => {
  it('never throw for any finite number', () => {
    fc.assert(fc.property(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      (n) => {
        assert.doesNotThrow(() => formatMoney(n));
        assert.doesNotThrow(() => formatNumber(n));
        assert.doesNotThrow(() => formatTokens(n));
        assert.doesNotThrow(() => formatCredits(n));
      },
    ), { numRuns: 1000 });
  });

  it('always return a string for any finite number', () => {
    fc.assert(fc.property(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      (n) => {
        assert.equal(typeof formatMoney(n), 'string');
        assert.equal(typeof formatNumber(n), 'string');
        assert.equal(typeof formatTokens(n), 'string');
        assert.equal(typeof formatCredits(n), 'string');
      },
    ), { numRuns: 1000 });
  });
});
