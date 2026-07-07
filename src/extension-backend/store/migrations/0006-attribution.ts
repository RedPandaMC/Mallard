import type { Migration } from './types';

/**
 * Adds the `attribution` column (see ddl.ts) and labels pre-existing rows.
 *
 * Every attributed row written before this version came from the
 * active-editor heuristic — except Claude Code rows whose repo was resolved
 * from the log's own cwd, which can't be told apart retroactively. All of
 * them are conservatively marked 'heuristic' rather than over-claiming
 * authority for some.
 */
export const attribution: Migration = {
  version: 6,
  description: 'Add events.attribution and mark pre-existing attributed rows heuristic.',
  async up(conn) {
    // The columns themselves are added by CREATE_SQL's idempotent ALTERs,
    // which run before migrations — only the one-time backfill lives here.
    await conn.run(
      `UPDATE events SET attribution = 'heuristic' WHERE repo IS NOT NULL AND attribution IS NULL`,
    );
  },
  /* c8 ignore next */
};
