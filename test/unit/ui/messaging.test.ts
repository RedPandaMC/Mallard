import { strict as assert } from 'assert';
import { isHostBoundMsg, isWebviewBoundMsg } from '../../../src/extension-backend/ui/messaging';

describe('messaging — isHostBoundMsg', () => {
  it('accepts the parameterless message types', () => {
    for (const type of ['ready', 'refresh', 'openConfig']) {
      assert.equal(isHostBoundMsg({ type }), true, type);
    }
  });

  it('requires an object value for setFilter/setConfig', () => {
    assert.equal(isHostBoundMsg({ type: 'setFilter', value: { models: [] } }), true);
    assert.equal(isHostBoundMsg({ type: 'setFilter', value: 'nope' }), false);
    assert.equal(isHostBoundMsg({ type: 'setConfig', value: { monthlyBudget: 1 } }), true);
    assert.equal(isHostBoundMsg({ type: 'setConfig' }), false);
  });

  it('requires an array for setLayout', () => {
    assert.equal(isHostBoundMsg({ type: 'setLayout', value: [] }), true);
    assert.equal(isHostBoundMsg({ type: 'setLayout', value: {} }), false);
  });

  it('bounds restrictSnooze minutes to (0, one week]', () => {
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 15 }), true);
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 0 }), false);
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: 60 * 24 * 7 + 1 }), false);
    assert.equal(isHostBoundMsg({ type: 'restrictSnooze', minutes: '15' }), false);
  });

  it('only accepts known command ids', () => {
    assert.equal(isHostBoundMsg({ type: 'command', id: 'openDashboard' }), true);
    assert.equal(isHostBoundMsg({ type: 'command', id: 'signIn' }), true);
    assert.equal(isHostBoundMsg({ type: 'command', id: 'disableExtension' }), true);
    assert.equal(isHostBoundMsg({ type: 'command', id: 'formatHardDrive' }), false);
  });

  it('requires a 3-letter currency code for setCurrency', () => {
    assert.equal(isHostBoundMsg({ type: 'setCurrency', value: 'EUR' }), true);
    assert.equal(isHostBoundMsg({ type: 'setCurrency', value: 'eur' }), true);
    assert.equal(isHostBoundMsg({ type: 'setCurrency', value: 'EU' }), false);
    assert.equal(isHostBoundMsg({ type: 'setCurrency', value: 'EURO' }), false);
    assert.equal(isHostBoundMsg({ type: 'setCurrency', value: '1,2,3' }), false);
    assert.equal(isHostBoundMsg({ type: 'setCurrency' }), false);
  });

  it('requires a non-empty model for toggleModelFilter', () => {
    assert.equal(isHostBoundMsg({ type: 'toggleModelFilter', model: 'gpt-4o' }), true);
    assert.equal(isHostBoundMsg({ type: 'toggleModelFilter', model: '' }), false);
    assert.equal(isHostBoundMsg({ type: 'toggleModelFilter' }), false);
  });

  it('rejects non-objects, missing types, and unknown types', () => {
    assert.equal(isHostBoundMsg(null), false);
    assert.equal(isHostBoundMsg('ready'), false);
    assert.equal(isHostBoundMsg({}), false);
    assert.equal(isHostBoundMsg({ type: 42 }), false); // non-string type
    assert.equal(isHostBoundMsg({ type: 'sudo' }), false);
  });
});

describe('messaging — isWebviewBoundMsg', () => {
  it('validates each message variant', () => {
    assert.equal(isWebviewBoundMsg({ type: 'theme', kind: 'dark', palette: 'swiss' }), true);
    assert.equal(isWebviewBoundMsg({ type: 'snapshot', payload: {} }), true);
    assert.equal(isWebviewBoundMsg({ type: 'snapshot', payload: 7 }), false);
    assert.equal(isWebviewBoundMsg({ type: 'config', value: {} }), true);
    assert.equal(isWebviewBoundMsg({ type: 'layout', value: [] }), true);
    assert.equal(isWebviewBoundMsg({ type: 'layout', value: {} }), false);
    assert.equal(isWebviewBoundMsg({ type: 'restriction', value: {} }), true);
    assert.equal(isWebviewBoundMsg({ type: 'alertFired', message: 'over budget' }), true);
    assert.equal(isWebviewBoundMsg({ type: 'alertFired' }), false);
    assert.equal(isWebviewBoundMsg({ type: 'telemetry' }), false);
    assert.equal(isWebviewBoundMsg({ type: 42 }), false); // non-string type
    assert.equal(isWebviewBoundMsg(undefined), false);
  });
});
