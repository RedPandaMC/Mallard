/**
 * Local-timezone bucketing helpers. Bucketing uses local Date component methods
 * so "today"/"this hour" match the user's clock; unit tests stay deterministic
 * because both event construction and bucketing use the same local zone.
 */
import { Granularity } from '../model/types';

export const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Epoch ms of the start of the bucket containing `ts`. */
export function startOf(ts: number, g: Granularity): number {
  const d = new Date(ts);
  switch (g) {
    case 'hour':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case 'week': {
      const monday = (d.getDay() + 6) % 7; // Monday = 0
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - monday).getTime();
    }
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case 'quarter':
      return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime();
    case 'year':
      return new Date(d.getFullYear(), 0, 1).getTime();
    default: {
      const _exhaustive: never = g;
      throw new Error(`Unknown granularity: ${_exhaustive}`);
    }
  }
}

/** Epoch ms of the start of the NEXT bucket after the one containing `ts`. */
export function nextBucketStart(ts: number, g: Granularity): number {
  const d = new Date(startOf(ts, g));
  switch (g) {
    case 'hour':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    case 'week':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    case 'month':
      return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    case 'quarter':
      return new Date(d.getFullYear(), d.getMonth() + 3, 1).getTime();
    case 'year':
      return new Date(d.getFullYear() + 1, 0, 1).getTime();
    default: {
      const _exhaustive: never = g;
      throw new Error(`Unknown granularity: ${_exhaustive}`);
    }
  }
}

/** ISO-8601 week number and its week-year. */
export function isoWeek(ts: number): { year: number; week: number } {
  const date = new Date(ts);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3); // shift to the Thursday of this week
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year: d.getFullYear(), week };
}

/** Stable, sortable label for the bucket containing `ts`. */
export function bucketKey(ts: number, g: Granularity): string {
  const d = new Date(startOf(ts, g));
  switch (g) {
    case 'hour':
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
        d.getHours(),
      )}`;
    case 'day':
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    case 'week': {
      const { year, week } = isoWeek(ts);
      return `${year}-W${pad2(week)}`;
    }
    case 'month':
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    case 'quarter':
      return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    case 'year':
      return `${d.getFullYear()}`;
    default: {
      const _exhaustive: never = g;
      throw new Error(`Unknown granularity: ${_exhaustive}`);
    }
  }
}

/** Number of whole days in the month containing `ts`. */
export function daysInMonth(ts: number): number {
  const start = startOf(ts, 'month');
  const end = nextBucketStart(ts, 'month');
  return Math.round((end - start) / DAY_MS);
}
