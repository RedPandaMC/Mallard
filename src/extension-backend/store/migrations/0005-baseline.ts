import type { Migration } from './types';

export const baseline: Migration = {
  version: 5,
  description: 'Baseline schema anchor — no schema changes.',
  async up() {
    // no-op: anchors schema_version at 5 for all fresh and existing installs
  },
  /* c8 ignore next */
};
