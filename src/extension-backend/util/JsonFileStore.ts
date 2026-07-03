/**
 * Shared best-effort JSON file persistence. Three stores (RestrictionEngine,
 * ExportQueue, UserConfigStore) used to hand-roll the same readFileSync/
 * writeFileSync + try/catch idiom; this centralises it with logging instead
 * of silence. Failure semantics stay the owners': read() returns undefined on
 * any failure (missing file, bad JSON) so each caller applies its own
 * fallback, and write() is best-effort.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { defaultLogger, Logger } from './logger';

export class JsonFileStore<T> {
  readonly file: string;

  constructor(
    dir: string,
    fileName: string,
    private readonly logger: Logger = defaultLogger,
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, fileName);
  }

  /** Parsed file contents, or undefined when missing/unreadable/malformed. */
  read(): unknown | undefined {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
    } catch (err) {
      // Missing file is the common first-run case — stay quiet about ENOENT.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.debug('store', `unreadable JSON at ${this.file}; using fallback`, err);
      }
      return undefined;
    }
  }

  /** Pretty-printed write; best-effort (in-memory state still applies on failure). */
  write(value: T): void {
    try {
      writeFileSync(this.file, JSON.stringify(value, null, 2) + '\n', 'utf8');
    } catch (err) {
      this.logger.warn('store', `failed to persist ${this.file}`, err);
    }
  }
}
