import { strict as assert } from 'assert';
import {
  formatMoney,
  formatNumber,
  formatTokens,
  formatCredits,
  formatMetric,
} from '../../src/domain/format';
import type { Metric } from '../../src/domain/types';

describe('formatMoney', () => {
  it('formats zero', () => {
    const r = formatMoney(0);
    assert.ok(r.includes('0'), `expected "0" in "${r}"`);
  });

  it('formats a positive amount in USD', () => {
    const r = formatMoney(1234.56);
    assert.ok(r.includes('1') && r.includes('234'), `unexpected: ${r}`);
  });

  it('uses a different currency when specified', () => {
    const r = formatMoney(10, 'EUR');
    // Either the Intl formatter worked (€) or the fallback string (EUR 10.00)
    assert.ok(r.includes('EUR') || r.includes('€'), `unexpected: ${r}`);
  });

  it('returns a string for a negative amount', () => {
    assert.equal(typeof formatMoney(-5), 'string');
  });
});

describe('formatNumber', () => {
  it('rounds to integer and formats with separators', () => {
    const r = formatNumber(1_234_567);
    // Locale-independent check: remove non-digits and check for the digits
    assert.ok(r.replace(/[^0-9]/g, '').includes('1234567'), `unexpected: ${r}`);
  });

  it('rounds fractional values', () => {
    const r = formatNumber(1.7);
    assert.ok(r.includes('2'), `expected "2" in "${r}"`);
  });

  it('handles zero', () => {
    assert.ok(formatNumber(0).includes('0'));
  });
});

describe('formatTokens', () => {
  it('formats values below 1k as plain numbers', () => {
    assert.equal(formatTokens(500), '500');
  });

  it('formats values >= 1k with k suffix', () => {
    assert.equal(formatTokens(1500), '1.5k');
    assert.equal(formatTokens(1000), '1.0k');
  });

  it('formats values >= 1M with M suffix', () => {
    assert.equal(formatTokens(1_500_000), '1.5M');
    assert.equal(formatTokens(1_000_000), '1.0M');
  });

  it('rounds sub-unit values', () => {
    const r = formatTokens(999);
    assert.equal(r, '999');
  });
});

describe('formatCredits', () => {
  it('formats whole credits without decimals', () => {
    const r = formatCredits(100);
    assert.ok(r.includes('100'), `unexpected: ${r}`);
  });

  it('rounds to 1 decimal place', () => {
    const r = formatCredits(1234.55);
    // 1234.55 * 10 = 12345.5 → round → 12346 → 12346/10 = 1234.6
    assert.ok(r.includes('1234.6') || r.includes('1,234.6'), `unexpected: ${r}`);
  });

  it('returns a string', () => {
    assert.equal(typeof formatCredits(0), 'string');
  });
});

describe('formatMetric', () => {
  it('cost delegates to formatMoney', () => {
    const r = formatMetric(10, 'cost' as Metric);
    assert.equal(r, formatMoney(10));
  });

  it('credits includes "cr" suffix', () => {
    const r = formatMetric(50, 'credits' as Metric);
    assert.ok(r.includes('cr'), `expected "cr" in "${r}"`);
  });

  it('tokens includes "tok" suffix', () => {
    const r = formatMetric(5000, 'tokens' as Metric);
    assert.ok(r.includes('tok'), `expected "tok" in "${r}"`);
  });

  it('throws for an unknown metric', () => {
    assert.throws(() => formatMetric(1, 'unknown' as Metric));
  });
});
