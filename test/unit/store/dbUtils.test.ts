import { strict as assert } from 'assert';
import { bindParam } from '../../../src/client_extension/store/dbUtils';

type Calls = { method: string; value?: unknown }[];

function makeStmt(): { calls: Calls; stmt: Parameters<typeof bindParam>[0] } {
  const calls: Calls = [];
  const stmt = {
    bindNull:    (_i: number)             => { calls.push({ method: 'null' }); },
    bindBigInt:  (_i: number, v: bigint)  => { calls.push({ method: 'bigint', value: v }); },
    bindBoolean: (_i: number, v: boolean) => { calls.push({ method: 'boolean', value: v }); },
    bindDouble:  (_i: number, v: number)  => { calls.push({ method: 'double', value: v }); },
    bindVarchar: (_i: number, v: string)  => { calls.push({ method: 'varchar', value: v }); },
  } as unknown as Parameters<typeof bindParam>[0];
  return { calls, stmt };
}

describe('bindParam', () => {
  it('calls bindNull for null', () => {
    const { calls, stmt } = makeStmt();
    bindParam(stmt, 1, null);
    assert.deepStrictEqual(calls, [{ method: 'null' }]);
  });

  it('calls bindNull for undefined', () => {
    const { calls, stmt } = makeStmt();
    bindParam(stmt, 1, undefined);
    assert.deepStrictEqual(calls, [{ method: 'null' }]);
  });

  it('calls bindBigInt for bigint values', () => {
    const { calls, stmt } = makeStmt();
    bindParam(stmt, 1, 42n);
    assert.deepStrictEqual(calls, [{ method: 'bigint', value: 42n }]);
  });

  it('calls bindBigInt for integer numbers', () => {
    const { calls, stmt } = makeStmt();
    bindParam(stmt, 1, 7);
    assert.deepStrictEqual(calls, [{ method: 'bigint', value: 7n }]);
  });

  it('calls bindDouble for non-integer numbers', () => {
    const { calls, stmt } = makeStmt();
    bindParam(stmt, 1, 3.14);
    assert.deepStrictEqual(calls, [{ method: 'double', value: 3.14 }]);
  });

  it('calls bindBoolean for boolean values', () => {
    const { calls, stmt } = makeStmt();
    bindParam(stmt, 1, true);
    assert.deepStrictEqual(calls, [{ method: 'boolean', value: true }]);
  });

  it('calls bindVarchar for string values', () => {
    const { calls, stmt } = makeStmt();
    bindParam(stmt, 1, 'hello');
    assert.deepStrictEqual(calls, [{ method: 'varchar', value: 'hello' }]);
  });
});
