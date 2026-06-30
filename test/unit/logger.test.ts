import { strict as assert } from 'assert';
import { ConsoleLogger, defaultLogger } from '../../src/extension-backend/util/logger';

describe('ConsoleLogger', () => {
  it('info() calls console.log with formatted prefix', () => {
    const calls: unknown[][] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => calls.push(a);
    try {
      new ConsoleLogger().info('myTag', 'hello', 42);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]![0], '[mallard:myTag]');
      assert.equal(calls[0]![1], 'hello');
      assert.equal(calls[0]![2], 42);
    } finally {
      console.log = orig;
    }
  });

  it('warn() calls console.warn with formatted prefix', () => {
    const calls: unknown[][] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => calls.push(a);
    try {
      new ConsoleLogger().warn('w', 'warning msg');
      assert.equal(calls.length, 1);
      assert.equal(calls[0]![0], '[mallard:w]');
      assert.equal(calls[0]![1], 'warning msg');
    } finally {
      console.warn = orig;
    }
  });

  it('error() calls console.error with formatted prefix', () => {
    const calls: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => calls.push(a);
    try {
      new ConsoleLogger().error('e', 'err msg', new Error('boom'));
      assert.equal(calls.length, 1);
      assert.equal(calls[0]![0], '[mallard:e]');
      assert.equal(calls[0]![1], 'err msg');
      assert.ok(calls[0]![2] instanceof Error);
    } finally {
      console.error = orig;
    }
  });

  it('defaultLogger is a ConsoleLogger instance', () => {
    assert.ok(defaultLogger instanceof ConsoleLogger);
  });
});
