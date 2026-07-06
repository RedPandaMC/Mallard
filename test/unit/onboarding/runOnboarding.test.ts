import { strict as assert } from 'assert';
import { runOnboarding } from '../../../src/extension-backend/onboarding/types';
import type { OnboardingContext, OnboardingStep } from '../../../src/extension-backend/onboarding/types';

const fakeCtx = {} as OnboardingContext;

function step(id: string, opts: { show?: boolean; proceed?: boolean } = {}): OnboardingStep & { runs: number } {
  const s = {
    id,
    runs: 0,
    shouldShow: () => opts.show ?? true,
    async run() { s.runs++; return opts.proceed ?? true; },
  };
  return s;
}

describe('runOnboarding', () => {
  it('runs every step in order when each proceeds', async () => {
    const order: string[] = [];
    const a: OnboardingStep = { id: 'a', shouldShow: () => true, run: async () => { order.push('a'); return true; } };
    const b: OnboardingStep = { id: 'b', shouldShow: () => true, run: async () => { order.push('b'); return true; } };
    await runOnboarding([a, b], fakeCtx);
    assert.deepEqual(order, ['a', 'b']);
  });

  it('skips a step whose shouldShow() is false, without calling run()', async () => {
    const skipped = step('skip', { show: false });
    const shown = step('shown', { show: true });
    await runOnboarding([skipped, shown], fakeCtx);
    assert.equal(skipped.runs, 0);
    assert.equal(shown.runs, 1);
  });

  it('stops the whole flow when a step returns false (dismissed)', async () => {
    const first = step('first', { proceed: false });
    const second = step('second');
    await runOnboarding([first, second], fakeCtx);
    assert.equal(first.runs, 1);
    assert.equal(second.runs, 0, 'later steps never run after a dismissal');
  });
});
