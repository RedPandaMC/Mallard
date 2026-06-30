import { strict as assert } from 'assert';
import { WorkspaceFolderMatcher } from '../../../src/extension/ingest/WorkspaceFolderMatcher';
import type { WorkspaceFolder } from 'vscode';

function makeFolder(name: string, fsPath: string): WorkspaceFolder {
  return { name, uri: { fsPath } } as unknown as WorkspaceFolder;
}

function hashOf(fsPath: string): string {
  return encodeURIComponent(fsPath).replace(/%/g, '').toLowerCase();
}

describe('WorkspaceFolderMatcher', () => {
  it('returns undefined when getFolders() returns undefined', () => {
    const m = new WorkspaceFolderMatcher(() => undefined);
    assert.equal(m.resolve('anything'), undefined);
  });

  it('returns undefined when getFolders() returns an empty array', () => {
    const m = new WorkspaceFolderMatcher(() => []);
    assert.equal(m.resolve('any-hash'), undefined);
  });

  it('returns undefined when no folder hash matches the sessionId', () => {
    const m = new WorkspaceFolderMatcher(() => [makeFolder('proj', '/home/user/proj')]);
    assert.equal(m.resolve('totally-different-hash'), undefined);
  });

  it('returns the folder name when the hash matches', () => {
    const fsPath = '/home/user/myproject';
    const m = new WorkspaceFolderMatcher(() => [makeFolder('myproject', fsPath)]);
    assert.equal(m.resolve(hashOf(fsPath)), 'myproject');
  });

  it('match is case-insensitive — upper-case sessionId resolves', () => {
    const fsPath = '/home/user/MYPROJECT';
    const expected = hashOf(fsPath); // already lowercase from the matcher
    const m = new WorkspaceFolderMatcher(() => [makeFolder('MYPROJECT', fsPath)]);
    assert.equal(m.resolve(expected.toUpperCase()), 'MYPROJECT');
  });

  it('returns the correct folder when multiple folders exist', () => {
    const fsPathA = '/home/user/alpha';
    const fsPathB = '/home/user/beta';
    const m = new WorkspaceFolderMatcher(() => [
      makeFolder('alpha', fsPathA),
      makeFolder('beta', fsPathB),
    ]);
    assert.equal(m.resolve(hashOf(fsPathB)), 'beta');
  });
});
