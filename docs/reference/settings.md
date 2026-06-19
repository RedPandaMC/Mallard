# Settings Reference

Mallard reads only two VS Code settings. Budget, included credits, and alert
thresholds are not settings; you edit them in the dashboard (see
[Configuration](/guide/configuration)) and they are stored per user.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `weevil.copilotLogPath` | `string` | `""` | Override the log directory. Blank means auto-detect via `vscode.env.logUri`. |
| `weevil.pricingManifestUrl` | `string` | `""` | Override the pricing manifest URL. Blank means use the built-in URL. |

See [Configuration](/guide/configuration) for full descriptions and examples.
