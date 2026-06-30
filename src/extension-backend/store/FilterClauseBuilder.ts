import { UNATTRIBUTED_REPO } from '../domain/aggregate';

export class FilterClauseBuilder {
  private readonly conditions: string[] = [];
  readonly params: unknown[] = [];

  addRange(
    range: { start: number; end: number } | undefined,
    col = 'ts',
    transform?: (v: number) => unknown,
  ): this {
    if (!range) return this;
    const lo = transform ? transform(range.start) : range.start;
    const hi = transform ? transform(range.end)   : range.end;
    this.conditions.push(`${col} >= ? AND ${col} < ?`);
    this.params.push(lo, hi);
    return this;
  }

  addIn(values: string[] | undefined, col: string): this {
    if (!values?.length) return this;
    this.conditions.push(`${col} IN (${values.map(() => '?').join(',')})`);
    this.params.push(...values);
    return this;
  }

  /**
   * Handles repo filtering where one special sentinel value maps to IS NULL
   * (raw events table) or an alias column (facts table).
   */
  addRepos(repos: string[] | undefined, col: string, unattributedSql: string): this {
    if (!repos?.length) return this;
    const named    = repos.filter((r) => r !== UNATTRIBUTED_REPO);
    const hasUnattr = repos.includes(UNATTRIBUTED_REPO);
    const parts: string[] = [];
    if (named.length) {
      parts.push(`${col} IN (${named.map(() => '?').join(',')})`);
      this.params.push(...named);
    }
    if (hasUnattr) parts.push(unattributedSql);
    if (parts.length) this.conditions.push(`(${parts.join(' OR ')})`);
    return this;
  }

  build(): string {
    return this.conditions.length ? `WHERE ${this.conditions.join(' AND ')}` : '';
  }
}
