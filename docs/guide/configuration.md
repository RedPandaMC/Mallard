# Configuration

Weevil works out of the box. These five settings exist for cases where the defaults don't fit.

## Settings

### `weevil.copilotLogPath`

**Type:** `string` · **Default:** `""` (auto-detect)

Override the directory Weevil scans for Copilot log files. Leave blank to use the path VS Code reports via `vscode.env.logUri`, which is correct in almost every case.

Use this only if your Copilot logs end up in a non-standard location (e.g. a custom VS Code portable installation).

```json
"weevil.copilotLogPath": "/custom/path/to/vscode/logs"
```

### `weevil.includedCredits`

**Type:** `number` · **Default:** `300`

Your monthly included premium request allowance. Weevil uses this to:
- Colour the spend gauge (green < 70%, amber 70–100%, red > 100%)
- Colour the status bar chip
- Compute "% of budget" in KPI cards

Set this to match your GitHub Copilot plan. The free tier includes 300 premium requests per month; higher plans include more.

```json
"weevil.includedCredits": 500
```

### `weevil.monthlyBudget`

**Type:** `number` · **Default:** `0` (off)

USD monthly spend threshold. When your month-to-date cost exceeds **80%** of this value, Weevil shows a VS Code notification. A second notification fires at **100%**. Each threshold fires at most once every 4 hours.

Set to `0` to disable budget alerts.

```json
"weevil.monthlyBudget": 20
```

### `weevil.alert.dailyCredits`

**Type:** `number` · **Default:** `0` (off)

Daily credit threshold. When your credit usage for the current calendar day exceeds this value, Weevil fires a VS Code notification. Fires at most once per day.

Set to `0` to disable daily credit alerts.

```json
"weevil.alert.dailyCredits": 50
```

### `weevil.pricingManifestUrl`

**Type:** `string` · **Default:** `""` (built-in URL)

Override URL for the pricing manifest JSON. Leave blank to use the default GitHub raw URL. The manifest is fetched once per day and cached locally; the bundled copy is used as a fallback when the network is unavailable.

You would only set this if you are hosting a custom manifest for a non-standard Copilot plan.

```json
"weevil.pricingManifestUrl": "https://example.com/my-pricing.json"
```

## Notes

- `pricePerCredit` is **not** a user setting — it comes from the pricing manifest ($0.04 by default) and updates automatically when GitHub changes pricing.
- There is no `dataSource` setting. The only source is local OTel logs.
- There are no notification rule schemas. Alerting is two numbers.
