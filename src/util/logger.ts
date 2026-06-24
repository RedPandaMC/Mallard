export interface Logger {
  info(tag: string, msg: string, ...args: unknown[]): void;
  warn(tag: string, msg: string, ...args: unknown[]): void;
  error(tag: string, msg: string, ...args: unknown[]): void;
}

export class ConsoleLogger implements Logger {
  info(tag: string, msg: string, ...args: unknown[]): void {
    console.log(`[mallard:${tag}]`, msg, ...args);
  }
  warn(tag: string, msg: string, ...args: unknown[]): void {
    console.warn(`[mallard:${tag}]`, msg, ...args);
  }
  error(tag: string, msg: string, ...args: unknown[]): void {
    console.error(`[mallard:${tag}]`, msg, ...args);
  }
}

export const defaultLogger: Logger = new ConsoleLogger();
