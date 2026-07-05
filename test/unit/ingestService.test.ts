import { strict as assert } from 'assert';
import { IngestService } from '../../src/extension-backend/ingest/IngestService';
import type { LogConnector } from '../../src/extension-backend/ingest/LogConnector';

function makeStub(over: Partial<LogConnector> = {}): LogConnector {
  return {
    id: 'stub',
    displayName: 'Stub',
    capabilities: { tokenFields: [], costCategories: [], supportsRepoAttribution: false, sources: ['ndjson'] },
    start: async () => {},
    dispose: () => {},
    getStatus: () => 'idle',
    getLogPaths: () => [],
    getSearchedDirs: () => [],
    getSetupRequirements: () => [],
    ...over,
  };
}

describe('IngestService', () => {
  it('getStatus returns empty when no connectors are idle', () => {
    const svc = new IngestService([]);
    assert.equal(svc.getStatus().kind, 'empty');
  });

  it('getStatus returns loading when any connector is loading', () => {
    const svc = new IngestService([makeStub({ getStatus: () => 'loading' }), makeStub({ getStatus: () => 'ok' })]);
    assert.equal(svc.getStatus().kind, 'loading');
  });

  it('getStatus returns ok when any connector is ok (and none loading)', () => {
    const svc = new IngestService([makeStub({ getStatus: () => 'ok' }), makeStub({ getStatus: () => 'idle' })]);
    assert.equal(svc.getStatus().kind, 'ok');
  });

  it('getStatus returns degraded when any connector errored (none loading/ok)', () => {
    const svc = new IngestService([makeStub({ getStatus: () => 'error' }), makeStub({ getStatus: () => 'idle' })]);
    assert.equal(svc.getStatus().kind, 'degraded');
  });

  it('getLogPaths flattens paths from all connectors', () => {
    const svc = new IngestService([
      makeStub({ id: 'a', getLogPaths: () => ['/a/1', '/a/2'] }),
      makeStub({ id: 'b', getLogPaths: () => ['/b/1'] }),
    ]);
    assert.deepEqual(svc.getLogPaths(), ['/a/1', '/a/2', '/b/1']);
  });

  it('getConnectorLogPaths returns paths for the matching connector id, empty otherwise', () => {
    const svc = new IngestService([
      makeStub({ id: 'a', getLogPaths: () => ['/a/1'] }),
      makeStub({ id: 'b', getLogPaths: () => ['/b/1'] }),
    ]);
    assert.deepEqual(svc.getConnectorLogPaths('a'), ['/a/1']);
    assert.deepEqual(svc.getConnectorLogPaths('missing'), []);
  });

  it('getSearchedDirs deduplicates across connectors', () => {
    const svc = new IngestService([
      makeStub({ getSearchedDirs: () => ['/dir1', '/dir2'] }),
      makeStub({ getSearchedDirs: () => ['/dir2', '/dir3'] }),
    ]);
    assert.deepEqual(svc.getSearchedDirs(), ['/dir1', '/dir2', '/dir3']);
  });

  it('start() starts all connectors and dispose() disposes them', async () => {
    let started = 0;
    let disposed = 0;
    const svc = new IngestService([
      makeStub({ start: async () => { started++; }, dispose: () => { disposed++; } }),
      makeStub({ start: async () => { started++; }, dispose: () => { disposed++; } }),
    ]);
    await svc.start();
    assert.equal(started, 2);
    svc.dispose();
    assert.equal(disposed, 2);
  });

  it('getKnownDirs returns the platform default log dirs', () => {
    const svc = new IngestService([]);
    const dirs = svc.getKnownDirs();
    assert.ok(Array.isArray(dirs));
    assert.ok(dirs.length > 0, 'at least one default dir');
  });
});
