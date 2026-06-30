import { strict as assert } from 'assert';
import { isHostBoundMsg, isWebviewBoundMsg } from '../../src/extension/ui/messaging';

describe('isHostBoundMsg', () => {
  it('accepts "ready"', () => assert.equal(isHostBoundMsg({ type: 'ready' }), true));
  it('accepts "refresh"', () => assert.equal(isHostBoundMsg({ type: 'refresh' }), true));
  it('accepts "openConfig"', () => assert.equal(isHostBoundMsg({ type: 'openConfig' }), true));
  it('accepts "restrictNow"', () => assert.equal(isHostBoundMsg({ type: 'restrictNow' }), true));
  it('accepts "restrictPermanent"', () => assert.equal(isHostBoundMsg({ type: 'restrictPermanent' }), true));

  it('accepts "setFilter" with object value', () => {
    assert.equal(isHostBoundMsg({ type: 'setFilter', value: {} }), true);
  });
  it('rejects "setFilter" without value', () => {
    assert.equal(isHostBoundMsg({ type: 'setFilter' }), false);
  });
  it('rejects "setFilter" with non-object value', () => {
    assert.equal(isHostBoundMsg({ type: 'setFilter', value: 'bad' }), false);
  });

  it('accepts "setConfig" with object value', () => {
    assert.equal(isHostBoundMsg({ type: 'setConfig', value: {} }), true);
  });
  it('rejects "setConfig" without value', () => {
    assert.equal(isHostBoundMsg({ type: 'setConfig' }), false);
  });

  it('accepts "setLayout" with array value', () => {
    assert.equal(isHostBoundMsg({ type: 'setLayout', value: [] }), true);
  });
  it('rejects "setLayout" with non-array value', () => {
    assert.equal(isHostBoundMsg({ type: 'setLayout', value: {} }), false);
  });

  it('accepts "restrictSnooze" with valid minutes', () => {
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 60 }), true);
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 1 }), true);
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 10080 }), true);
  });
  it('rejects "restrictSnooze" with zero minutes', () => {
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 0 }), false);
  });
  it('rejects "restrictSnooze" with negative minutes', () => {
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: -1 }), false);
  });
  it('rejects "restrictSnooze" with too many minutes', () => {
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 10081 }), false);
  });
  it('rejects "restrictSnooze" with non-number minutes', () => {
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: '60' }), false);
  });

  it('accepts "command" with openDashboard', () => {
    assert.equal(isHostBoundMsg({ type: 'command', id: 'openDashboard' }), true);
  });
  it('accepts "command" with signIn', () => {
    assert.equal(isHostBoundMsg({ type: 'command', id: 'signIn' }), true);
  });
  it('rejects "command" with unknown id', () => {
    assert.equal(isHostBoundMsg({ type: 'command', id: 'doSomethingElse' }), false);
  });

  it('rejects null', () => assert.equal(isHostBoundMsg(null), false));
  it('rejects a number', () => assert.equal(isHostBoundMsg(42), false));
  it('rejects a string', () => assert.equal(isHostBoundMsg('ready'), false));
  it('rejects an array', () => assert.equal(isHostBoundMsg([]), false));
  it('rejects an object with missing type', () => assert.equal(isHostBoundMsg({}), false));
  it('rejects an object with numeric type', () => assert.equal(isHostBoundMsg({ type: 42 }), false));
  it('rejects an unknown type string', () => {
    assert.equal(isHostBoundMsg({ type: 'doSomethingDangerous' }), false);
  });
});

describe('isWebviewBoundMsg', () => {
  it('accepts "theme"', () => {
    assert.equal(isWebviewBoundMsg({ type: 'theme', kind: 'dark', palette: 'swiss' }), true);
  });

  it('accepts "snapshot" with object payload', () => {
    assert.equal(isWebviewBoundMsg({ type: 'snapshot', payload: {} }), true);
  });
  it('rejects "snapshot" without payload', () => {
    assert.equal(isWebviewBoundMsg({ type: 'snapshot' }), false);
  });
  it('rejects "snapshot" with non-object payload', () => {
    assert.equal(isWebviewBoundMsg({ type: 'snapshot', payload: 'bad' }), false);
  });

  it('accepts "config" with object value', () => {
    assert.equal(isWebviewBoundMsg({ type: 'config', value: {} }), true);
  });
  it('rejects "config" without value', () => {
    assert.equal(isWebviewBoundMsg({ type: 'config' }), false);
  });

  it('accepts "layout" with array value', () => {
    assert.equal(isWebviewBoundMsg({ type: 'layout', value: [] }), true);
  });
  it('rejects "layout" with non-array value', () => {
    assert.equal(isWebviewBoundMsg({ type: 'layout', value: {} }), false);
  });

  it('accepts "restriction" with object value', () => {
    assert.equal(isWebviewBoundMsg({ type: 'restriction', value: {} }), true);
  });
  it('rejects "restriction" with non-object value', () => {
    assert.equal(isWebviewBoundMsg({ type: 'restriction', value: 123 }), false);
  });

  it('rejects an unknown type', () => {
    assert.equal(isWebviewBoundMsg({ type: 'unknown' }), false);
  });

  it('rejects null', () => assert.equal(isWebviewBoundMsg(null), false));
  it('rejects an object with no type', () => assert.equal(isWebviewBoundMsg({}), false));
});
