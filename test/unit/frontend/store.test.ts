import { strict as assert } from 'assert';
import { store, state, setState, subscribe } from '../../../src/extension-frontend/store';
import { DEFAULT_USER_CONFIG } from '../../../src/extension-backend/domain/types';

describe('frontend/store — state mutations + subscriptions', () => {
  beforeEach(() => {
    // Reset to defaults since the store is a singleton shared across all tests
    setState({ metric: 'cost', filter: {}, focusedModels: new Set() });
  });

  it('starts with default state', () => {
    const s = state();
    assert.equal(s.metric, 'cost');
    assert.equal(s.snapshot, null);
    assert.deepEqual(s.config, DEFAULT_USER_CONFIG);
  });

  it('setState merges a patch and notifies subscribers', () => {
    let changes = 0;
    const unsub = subscribe(() => changes++);
    setState({ metric: 'credits' });
    assert.equal(state().metric, 'credits');
    assert.ok(changes >= 1);
    unsub();
  });

  it('setState with focusedModels accepts a Set', () => {
    setState({ focusedModels: new Set(['gpt-4o']) });
    assert.ok(state().focusedModels.has('gpt-4o'));
    setState({ focusedModels: new Set() });
  });

  it('store.getState() returns the live state', () => {
    assert.equal(store.getState(), state());
  });
});
