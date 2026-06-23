import type { Kysely } from 'kysely';
import type { Database } from './db-types';

export interface MetaStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class KyselyMetaStore implements MetaStore {
  constructor(private readonly db: Kysely<Database>) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('meta')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insertInto('meta')
      .values({ key, value })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
      .execute();
  }
}
