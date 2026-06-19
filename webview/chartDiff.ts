/** Returns true when two chart payload values differ (by value, not reference). */
export function changed<T>(prev: T | undefined, next: T): boolean {
  return JSON.stringify(prev) !== JSON.stringify(next);
}
