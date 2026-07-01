/**
 * Durable backlog for metric exports that failed to send. Persisted as a
 * JSON file in the extension's storage directory, following the same
 * pattern as UserConfigStore/RestrictionEngine: best-effort read/write, a
 * malformed file degrades to an empty queue rather than throwing.
 *
 * No `vscode` or `mqtt` imports on purpose — this stays a plain class so it
 * can be exercised directly in the unit-test runner (see
 * test/unit/exportQueue.test.ts and the stub in test/unit/metricExporter.test.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

const QUEUE_FILE = 'export-queue.json';

/**
 * Oldest-evicted-first cap once exceeded. This is a count, not a duration,
 * but since `mallard.refreshIntervalMinutes` is user-configurable (1-60 min)
 * the time window it represents varies: ~83 hours of buffered history at the
 * 10-minute default, ~500 hours at the 60-minute max.
 */
const MAX_QUEUE_SIZE = 500;

export interface QueuedExport {
  readonly id: string;
  readonly topic: string;
  readonly payload: Record<string, unknown>;
  readonly enqueuedAt: number;
}

export class ExportQueue {
  private entries: QueuedExport[];
  private readonly file: string;

  constructor(storageDir: string) {
    mkdirSync(storageDir, { recursive: true });
    this.file = path.join(storageDir, QUEUE_FILE);
    this.entries = this.readFromDisk();
  }

  /** A snapshot of the current queue, oldest first. Safe to iterate while calling dequeue(). */
  peekAll(): QueuedExport[] {
    return [...this.entries];
  }

  enqueue(topic: string, payload: Record<string, unknown>): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.entries.push({ id, topic, payload, enqueuedAt: Date.now() });
    if (this.entries.length > MAX_QUEUE_SIZE) {
      this.entries.splice(0, this.entries.length - MAX_QUEUE_SIZE);
    }
    this.writeToDisk();
  }

  dequeue(id: string): void {
    const next = this.entries.filter((e) => e.id !== id);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.writeToDisk();
  }

  private readFromDisk(): QueuedExport[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return Array.isArray(parsed) ? (parsed as QueuedExport[]) : [];
    } catch {
      return [];
    }
  }

  private writeToDisk(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.entries, null, 2) + '\n', 'utf8');
    } catch {
      /* best-effort */
    }
  }
}
