import { strict as assert } from 'assert';
import { ConnectorRegistry } from '../../../src/extension/ingest/ConnectorRegistry';
import type { LogConnector } from '../../../src/extension/ingest/LogConnector';

function makeStub(id: string): LogConnector {
  return {
    id,
    displayName: id,
    capabilities: { tokenFields: [], costCategories: [], supportsRepoAttribution: false },
    start: async () => {},
    dispose: () => {},
    getStatus: () => 'idle',
    getLogPaths: () => [],
    getSearchedDirs: () => [],
  };
}

describe('ConnectorRegistry', () => {
  it('build() returns empty array when nothing is registered', () => {
    assert.deepEqual(new ConnectorRegistry().build(), []);
  });

  it('build() returns all registered connectors in registration order', () => {
    const a = makeStub('a');
    const b = makeStub('b');
    const list = new ConnectorRegistry().register(a).register(b).build();
    assert.equal(list.length, 2);
    assert.equal(list[0], a);
    assert.equal(list[1], b);
  });

  it('register() returns the registry instance for fluent chaining', () => {
    const reg = new ConnectorRegistry();
    const returned = reg.register(makeStub('x'));
    assert.strictEqual(returned, reg);
  });

  it('build() returns a defensive copy each time', () => {
    const reg = new ConnectorRegistry().register(makeStub('x'));
    const first = reg.build();
    const second = reg.build();
    assert.notStrictEqual(first, second);
    assert.deepEqual(first, second);
  });

  it('mutating the built array does not affect the registry', () => {
    const reg = new ConnectorRegistry().register(makeStub('x'));
    const built = reg.build() as LogConnector[];
    built.push(makeStub('extra'));
    assert.equal(reg.build().length, 1);
  });
});
