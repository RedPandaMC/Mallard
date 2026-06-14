# Configuration

Weevil works out of the box. Most of what you might want to change lives in the
dashboard, not in `settings.json`.

## Budget and alerts

Budget and alert thresholds live in a small JSON config file, editable two ways:
through the dashboard, or by hand.

### In the dashboard

Expand the "Budget and alerts" panel. Each field writes the config file
immediately:

- **Monthly budget (USD).** When month-to-date cost crosses 80 percent of this
  value Weevil shows a notification, and again at 100 percent. Each fires at
  most once every four hours. Set to 0 to turn budget alerts off.
- **Included credits per month.** Your plan's premium request allowance. This
  colours the spend gauge. The free tier includes 300.
- **Daily credit alert.** Notify once a day when the day's credits cross this
  number. Set to 0 to turn it off.
- **Spending velocity alert.** Notify when the recent spending rate crosses a
  credits-per-hour threshold. Useful for catching runaway agent loops.

### As a JSON file

Click "Edit as JSON" in that panel to open the file directly. It is a
`config.json` in Weevil's storage directory and is the source of truth: edit it
by hand and the dashboard updates as soon as you save. The full shape is:

```json
{
  "monthlyBudget": 20,
  "includedCredits": 300,
  "dailyCreditAlert": 50,
  "alerts": {
    "velocityEnabled": true,
    "velocityCreditsPerHour": 40
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `monthlyBudget` | number | USD budget; 0 turns budget alerts off. |
| `includedCredits` | number | Plan's monthly premium requests; colours the gauge. |
| `dailyCreditAlert` | number | Daily credit threshold; 0 turns it off. |
| `alerts.velocityEnabled` | boolean | Whether the spending-velocity alert is active. |
| `alerts.velocityCreditsPerHour` | number | Credits-per-hour rate that triggers it. |

Values are validated and clamped, so a missing or malformed field falls back to
its default rather than breaking. The file lives on the machine it was created
on; it is not synced across machines.

## Arranging the dashboard

Click "Edit layout" above the charts to rearrange the analysis view. While
editing you can:

- Drag a panel by its handle to reorder it.
- Toggle a panel between half and full width to scale it.
- Hide a panel you do not use, or show it again.

Charts always scale to fit their panel. Your arrangement is saved automatically
and restored on the next launch, on every machine signed in to the same VS Code
profile. "Reset layout" restores the defaults.

## Removing your data

All of Weevil's data stays on your machine: usage events in the extension's
global storage, your budget, alert, and layout choices in VS Code's per-user
state, and a cached pricing manifest. VS Code does not delete this when you
uninstall an extension, so to remove everything run "Weevil: Clear All Data"
first, then uninstall.

## VS Code settings

There are two, for cases where auto-detection does not fit.

### `weevil.copilotLogPath`

Type `string`, default `""` (auto-detect).

Override the directory Weevil scans for Copilot log files. Leave it blank to use
the path VS Code reports through `vscode.env.logUri`, which is correct in almost
every case. Set it only if your logs live in a non-standard location, such as a
portable VS Code install.

```json
"weevil.copilotLogPath": "/custom/path/to/vscode/logs"
```

### `weevil.pricingManifestUrl`

Type `string`, default `""` (built-in URL).

Override the URL for the pricing manifest JSON. Leave it blank to use the
default. The manifest is fetched once per day, validated, and cached locally;
the copy bundled with the extension is the fallback when the network is
unavailable. Set this only if you host a custom manifest for a non-standard
plan.

```json
"weevil.pricingManifestUrl": "https://example.com/my-pricing.json"
```

## Notes

- The price per credit comes from the pricing manifest (0.04 USD by default) and
  updates automatically when GitHub changes pricing. It is not a setting.
- The only data source is local OTel logs. There is no sample or synthetic mode;
  when there is nothing to show, the dashboard says so.
