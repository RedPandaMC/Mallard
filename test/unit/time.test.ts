import { strict as assert } from 'assert';
import { bucketKey, DAY_MS, daysInMonth, nextBucketStart, startOf } from '../../src/util/time';

describe('time bucketing', () => {
  const ts = new Date(2026, 5, 12, 14, 30).getTime(); // June 12 2026, 14:30 local

  it('produces stable day/month keys', () => {
    assert.equal(bucketKey(ts, 'day'), '2026-06-12');
    assert.equal(bucketKey(ts, 'month'), '2026-06');
  });

  it('week key has the ISO shape and starts on Monday', () => {
    assert.match(bucketKey(ts, 'week'), /^\d{4}-W\d{2}$/);
    const weekStart = startOf(ts, 'week');
    assert.equal(new Date(weekStart).getDay(), 1, 'week starts Monday');
    assert.ok(ts >= weekStart && ts - weekStart < 7 * DAY_MS);
  });

  it('nextBucketStart advances exactly one bucket', () => {
    assert.equal(nextBucketStart(ts, 'day'), new Date(2026, 5, 13).getTime());
    assert.equal(nextBucketStart(ts, 'month'), new Date(2026, 6, 1).getTime());
  });

  it('knows month length', () => {
    assert.equal(daysInMonth(ts), 30); // June
    assert.equal(daysInMonth(new Date(2026, 1, 5).getTime()), 28); // Feb 2026
  });
});
