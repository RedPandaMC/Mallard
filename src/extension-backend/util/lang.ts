/**
 * Returns `{ [key]: value }` when value is defined, else `{}`.
 * Eliminates the `...(x !== undefined ? { k: x } : {})` pattern.
 */
export function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value !== undefined ? ({ [key]: value } as Record<K, V>) : {};
}
