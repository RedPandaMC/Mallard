import type { LogConnector } from './LogConnector';

export class ConnectorRegistry {
  private readonly connectors: LogConnector[] = [];

  register(connector: LogConnector): this {
    this.connectors.push(connector);
    return this;
  }

  build(): readonly LogConnector[] {
    return [...this.connectors];
  }
}
