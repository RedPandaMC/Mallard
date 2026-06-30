export class IntervalManager {
  private handle?: ReturnType<typeof setInterval>;

  schedule(fn: () => void, ms: number): void {
    if (this.handle !== undefined) clearInterval(this.handle);
    this.handle = setInterval(fn, Math.max(ms, 60_000));
  }

  [Symbol.dispose](): void {
    if (this.handle !== undefined) clearInterval(this.handle);
  }
}
