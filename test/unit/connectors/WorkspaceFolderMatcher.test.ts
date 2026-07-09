import { strict as assert } from 'assert';
import { WorkspaceFolderMatcher } from '../../../src/extension-backend/ingest/WorkspaceFolderMatcher';
import type { WorkspaceFolder } from 'vscode';

function makeFolder(name: string, fsPath: string): WorkspaceFolder {
  return { name, uri: { fsPath } } as unknown as WorkspaceFolder;
}

describe('WorkspaceFolderMatcher', () => {
  it('returns undefined when getFolders() returns undefined', () => {
    const m = new WorkspaceFolderMatcher(() => undefined);
    assert.equal(m.resolve('/anything'), undefined);
  });

  it('returns undefined when getFolders() returns an empty array', () => {
    const m = new WorkspaceFolderMatcher(() => []);
    assert.equal(m.resolve('/home/user/proj'), undefined);
  });

  it('returns undefined for an empty cwd', () => {
    const m = new WorkspaceFolderMatcher(() => [makeFolder('proj', '/home/user/proj')]);
    assert.equal(m.resolve(''), undefined);
  });

  it('returns undefined when the cwd is outside every folder', () => {
    const m = new WorkspaceFolderMatcher(() => [makeFolder('proj', '/home/user/proj')]);
    assert.equal(m.resolve('/home/user/other'), undefined);
  });

  it('returns the folder name when the cwd equals the folder path', () => {
    const m = new WorkspaceFolderMatcher(() => [makeFolder('myproject', '/home/user/myproject')]);
    assert.equal(m.resolve('/home/user/myproject'), 'myproject');
  });

  it('returns the folder name when the cwd is nested inside the folder', () => {
    const m = new WorkspaceFolderMatcher(() => [makeFolder('myproject', '/home/user/myproject')]);
    assert.equal(m.resolve('/home/user/myproject/src/deep'), 'myproject');
  });

  it('does not match a sibling folder that shares a path prefix', () => {
    // /home/user/proj must NOT match a cwd under /home/user/proj-two
    const m = new WorkspaceFolderMatcher(() => [makeFolder('proj', '/home/user/proj')]);
    assert.equal(m.resolve('/home/user/proj-two/src'), undefined);
  });

  it('match is case-insensitive', () => {
    const m = new WorkspaceFolderMatcher(() => [makeFolder('MYPROJECT', '/home/user/MYPROJECT')]);
    assert.equal(m.resolve('/home/user/myproject/src'), 'MYPROJECT');
  });

  it('normalises backslashes and trailing separators', () => {
    const m = new WorkspaceFolderMatcher(() => [makeFolder('win', 'C:\\Users\\me\\proj')]);
    assert.equal(m.resolve('C:\\Users\\me\\proj\\src\\'), 'win');
  });

  it('picks the most specific (longest) matching folder', () => {
    const m = new WorkspaceFolderMatcher(() => [
      makeFolder('outer', '/home/user/outer'),
      makeFolder('inner', '/home/user/outer/inner'),
    ]);
    assert.equal(m.resolve('/home/user/outer/inner/pkg'), 'inner');
  });
});
