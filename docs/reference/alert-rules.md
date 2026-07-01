# Alert Rules Reference

Every field, operator, and context path available in a `config.json` rule.

## Rule fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique identifier; used for cooldown bookkeeping. |
| `severity` | yes | `"info"`, `"warning"`, or `"critical"`. |
| `message` | yes | Notification text. Supports <code v-pre>{{ field.path }}</code> placeholders. |
| `when` | yes | Condition that must be true for the rule to fire. |
| `active` | no | Gate: rule is skipped unless this condition is true. |
| `cooldown` | no | Min time between firings: `"30m"`, `"4h"`, `"1d"`, `"1w"`. Default `1h`. |
| `notify` | no | Whether a fired rule shows a notification toast. Default `true`. Set to `false` to run a rule silently, for example one that only sets a `restrict` state. Ignored for rules with a `restrict` block, since those already show their own popup. |
| `restrict` | no | Copilot restriction block. See [Restriction fields](#restriction-fields). |

## Condition operators

| Operator | Form |
| --- | --- |
| `>` `>=` `<` `<=` `==` `!=` | `{ ">": [{ "var": "today.credits" }, 100] }` |
| `and` / `or` / `not` | `{ "and": [cond, cond] }` · `{ "not": cond }` |
| `var` | `{ "var": "today.credits" }`: dot-path into the live context |
| literal | `true` (always fire) · `false` (never fire) |

## Context fields

| Path | Type | Description |
| --- | --- | --- |
| `today.credits` / `today.cost` / `today.tokens` | number | Usage today. |
| `month.credits` / `month.cost` | number | Month-to-date totals. |
| `window7d.credits` / `window7d.cost` | number | Last 7 days. |
| `budget.monthly` | number \| null | Monthly budget in USD. |
| `budget.usedCredits` / `budget.usedCost` | number | Credits / cost used this month. |
| `budget.percentOfBudget` | number | MTD cost as fraction of budget (0–1+). |
| `budget.percentOfIncluded` | number | Credits as fraction of included allowance. |
| `budget.projectedOverage` | number \| null | Projected overage in USD. |
| `budget.pace` | string | `"no-budget"`, `"under"`, `"on-track"`, `"warning"`, or `"over"`. |
| `forecast.projectedCredits` / `forecast.projectedCost` | number | Month-end projection. |
| `forecast.low` / `forecast.high` | number | Projection confidence bounds. |
| `forecast.basis` | string | Method used: `"linear"`, `"seasonal"`, or `"insufficient-data"`. |
| `velocity.creditsPerHour` | number | Recent spending rate. |
| `velocity.windowMinutes` | number | Window size used to compute the rate. |
| `topModel.id` / `topModel.credits` | string \| null, number | Top model today. |
| `topSurface.id` / `topSurface.credits` | string \| null, number | Top surface today. |
| `topRepo.id` / `topRepo.credits` | string \| null, number | Top repo today. |
| `model.<key>.credits` | number | Credits for a specific model, e.g. `model.gpt-4o.credits`. |
| `surface.<key>.credits` | number | Credits for a specific surface, e.g. `surface.chat.credits`. |
| `repo.<key>.credits` | number | Credits for a specific repo, e.g. `repo.my-app.credits`. |
| `billing.netAmount` / `billing.grossAmount` | number | GitHub billing net and gross charge (requires sign-in). |
| `billing.quotaPercentRemaining` | number | Remaining plan quota as a percentage (requires sign-in). |
| `billing.unlimited` | boolean | Whether the account has an unlimited Copilot plan (requires sign-in). |
| `now.weekday` / `now.hour` / `now.minute` / `now.ts` | number | Current time values (`weekday` is 0=Sun–6=Sat). |
| `now.iso` | string | Current time as an ISO 8601 string. |
| `signedIn` | boolean | Whether signed in to GitHub. |
| `currentBranch` / `currentBranchCredits` | string \| null, number | Active branch name and credits consumed on it. |
| `branchBudgets.<branch>` | number | Credit cap for the named branch, as set in the `branchBudgets` config key. Compare against `currentBranchCredits`. |
| `vars.<name>` | any | User-defined variable (see `vars` block). |
| `group.<id>` | boolean | Whether the named group is active. |

## Restriction fields {#restriction-fields}

A rule's `restrict` block shows a popup with **Dismiss**, **Snooze 15m**, **Snooze 1h**, and **Disable Mallard...** when the rule fires. Mallard never disables any extension automatically; **Disable Mallard...** opens the Extensions view so you can do it yourself in one click.

| Field | Values | Description |
| --- | --- | --- |
| `reEnableWhen` | condition | Optional. When this condition becomes true, the restriction clears itself automatically instead of waiting for a snooze to expire. |
