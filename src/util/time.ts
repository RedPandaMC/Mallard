/**
 * Local-timezone bucketing helpers. Bucketing uses local Date component methods
 * so "today"/"this month" match the user's clock.
 */
import { Granularity } from '../domain/types';

export const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Epoch ms of the start of the bucket containing `ts`. */
export function startOf(ts: number, g: Granularity): number {
  const date = new Date(ts);
  switch (g) {
    case 'day':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    case 'week': {
      const monday = (date.getDay() + 6) % 7;
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() - monday).getTime();
    }
    case 'month':
      return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    default: {
      const _exhaustive: never = g;
      throw new Error(`Unknown granularity: ${_exhaustive}`);
    }
  }
}

/** Epoch ms of the start of the NEXT bucket after the one containing `ts`. */
export function nextBucketStart(ts: number, g: Granularity): number {
  const date = new Date(startOf(ts, g));
  switch (g) {
    case 'day':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    case 'week':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime();
    case 'month':
      return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
    default: {
      const _exhaustive: never = g;
      throw new Error(`Unknown granularity: ${_exhaustive}`);
    }
  }
}

/** ISO-8601 week number and its week-year. */
export function isoWeek(ts: number): { year: number; week: number } {
  const date = new Date(ts);
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (normalized.getDay() + 6) % 7;
  normalized.setDate(normalized.getDate() - dayNum + 3);
  const firstThursday = new Date(normalized.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week = 1 + Math.round((normalized.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year: normalized.getFullYear(), week };
}

/** Stable, sortable label for the bucket containing `ts`. */
export function bucketKey(ts: number, g: Granularity): string {
  const date = new Date(startOf(ts, g));
  switch (g) {
    case 'day':
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    case 'week': {
      const { year, week } = isoWeek(ts);
      return `${year}-W${pad2(week)}`;
    }
    case 'month':
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
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
