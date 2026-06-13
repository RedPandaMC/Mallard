# Configuration

Weevil works out of the box. Most of what you might want to change lives in the
dashboard, not in `settings.json`.

## In the dashboard

Open the dashboard and expand the "Budget and alerts" panel. These values are
saved per user and take effect immediately:

- **Monthly budget (USD).** When month-to-date cost crosses 80 percent of this
  value Weevil shows a notification, and again at 100 percent. Each fires at
  most once every four hours. Set to 0 to turn budget alerts off.
- **Included credits per month.** Your plan's premium request allowance. This
  colours the spend gauge and the status bar chip. The free tier includes 300.
- **Daily credit alert.** Notify once a day when the day's credits cross this
  number. Set to 0 to turn it off.
- **Spending velocity alert.** Notify when the recent spending rate crosses a
  credits-per-hour threshold. Useful for catching runaway agent loops.

These were previously settings; they moved into the UI so you can adjust them
without opening `settings.json`, and they follow you across machines through VS
Code's user storage.

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
