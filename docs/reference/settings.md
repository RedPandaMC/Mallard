# Settings Reference

Mallard reads only a few VS Code settings. Budget, included credits, and alert
thresholds are not settings; you edit them in the dashboard (see
[Configuration](/guide/configuration)) and they are stored per user.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mallard.copilotLogPath` | `string` | `""` | Override the log directory. Blank means auto-detect via `vscode.env.logUri`. |
| `mallard.pricingManifestUrl` | `string` | `""` | Override the pricing manifest URL. Blank means use the built-in URL. |
| `mallard.palette` | `"swiss" \| "theme"` | `"swiss"` | Dashboard chart palette. `swiss` is the fixed duotone; `theme` derives the accent from your VS Code theme. Both keep the duotone structure and are checked for accessibility. |

See [Configuration](/guide/configuration) for full descriptions and examples.
