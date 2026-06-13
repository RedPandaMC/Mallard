import { strict as assert } from 'assert';
import { computeBudget, severityFor } from '../../src/domain/budget';
import { Forecast } from '../../src/domain/types';

function forecastWithCost(projectedCost: number): Forecast {
  return {
    granularity: 'month',
    projectedCredits: projectedCost / 0.04,
    projectedCost,
    low: projectedCost,
    high: projectedCost,
    basis: 'linear',
    asOf: Date.now(),
  };
}

describe('budget', () => {
  it('reports no-budget when none is set', () => {
    const b = computeBudget({
      monthlyBudget: 0,
      includedCredits: 300,
      mtdCredits: 50,
      mtdCost: 2,
      forecast: forecastWithCost(4),
    });
    assert.equal(b.pace, 'no-budget');
    assert.equal(b.projectedOverage, null);
    assert.ok(Math.abs(b.percentOfIncluded - 50 / 300) < 1e-9);
  });

  it('classifies pace by projected ratio', () => {
    const mk = (projCost: number) =>
      computeBudget({
        monthlyBudget: 30,
        includedCredits: 300,
        mtdCredits: 100,
        mtdCost: projCost / 2,
        forecast: forecastWithCost(projCost),
      }).pace;

    assert.equal(mk(12), 'under'); // 0.4
    assert.equal(mk(27), 'on-track'); // 0.9
    assert.equal(mk(36), 'warning'); // 1.2
    assert.equal(mk(45), 'over'); // 1.5
  });

  it('computes projected overage and severity', () => {
    const b = computeBudget({
      monthlyBudget: 30,
      includedCredits: 300,
      mtdCredits: 400,
      mtdCost: 16,
      forecast: forecastWithCost(45),
    });
    assert.ok(b.projectedOverage !== null && Math.abs(b.projectedOverage - 15) < 1e-9);
    assert.equal(severityFor(b), 'error');
  });

  it('warns when included credits are exhausted even without a budget', () => {
    const b = computeBudget({
      monthlyBudget: 0,
      includedCredits: 300,
      mtdCredits: 350,
      mtdCost: 14,
      forecast: forecastWithCost(20),
    });
    assert.equal(severityFor(b), 'warning');
  });
});
