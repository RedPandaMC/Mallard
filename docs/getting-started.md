# Getting Started

This guide walks you through installing Weevil and getting your first budget set up.

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Weevil"
4. Click **Install**

### From Command Line

```bash
code --install-extension jurreandenys.weevil
```

### From VSIX

Download the `.vsix` file from GitHub releases and run:

```bash
code --install-extension weevil-<version>.vsix
```

## Opening the Dashboard

After installation, Weevil appears in your **Activity Bar** (the strip of icons on
the left side of VS Code). Click the Weevil icon to open the sidebar.

To open the full dashboard:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Weevil: Open Dashboard**

The dashboard shows usage charts, KPI cards, and forecast projections.

## Setting Your Budget

Setting a monthly budget enables visual warnings as you approach your limit.

1. Open the Command Palette
2. Run **Weevil: Set Monthly Budget**
3. Enter your budget amount in your selected currency

Alternatively, set it directly in Settings:

```json
"weevil.monthlyBudget": 20
```

## Configuring the Status Bar

The status bar chip can show different metrics and scopes:

| Metric    | Description             |
| --------- | ----------------------- |
| `cost`    | Dollar amount (default) |
| `credits` | Premium request credits |
| `tokens`  | Total token count       |

| Scope       | Description             |
| ----------- | ----------------------- |
| `session`   | Current VS Code session |
| `today`     | Today (default)         |
| `workspace` | Current workspace       |
| `repo`      | Current Git repository  |

Run **Weevil: Set Status Bar Scope** to change these.

## Connecting GitHub (Optional)

While Weevil works without signing in, connecting GitHub enables:

- More accurate token counting via the `@weevil` chat participant
- Future calibration features

Run **Weevil: Connect GitHub** to sign in.

## Next Steps

- [Configure notifications](./notifications.md) to get alerts when spending exceeds thresholds
- [Understand the data sources](./data-sources.md) to learn how usage is tracked
- [Review all settings](./configuration.md) for customization options
