import { LogParser } from './LogParser';

export class LogParserRegistry {
  private readonly parsers: LogParser[] = [];

  /** Register a parser. Earlier registrations take priority in forFile(). */
  register(parser: LogParser): void {
    this.parsers.push(parser);
  }

  /** Returns the first registered parser that can handle this file, or undefined. */
  forFile(filePath: string): LogParser | undefined {
    return this.parsers.find((p) => p.canParse(filePath));
  }

  /** All registered source kinds, in registration order (useful for diagnostics). */
  registeredSources(): string[] {
    return this.parsers.map((p) => p.sourceKind);
  }
}
