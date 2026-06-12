# Data Sources

Weevil estimates your Copilot usage by combining multiple data sources. This
document explains how each source works and when it's used.

## Data Flow

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  @weevil chat   │     │ Copilot OTel │     │  Sample data    │
│  (exact count)  │     │    logs      │     │  (synthetic)   │
└────────┬────────┘     └──────┬───────┘     └────────┬────────┘
         │                     │                      │
         ▼                     ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                        EventStore                            │
│                   (JSONL on disk)                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     UsageService                             │
│              (snapshot building, forecasting)                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│         (status bar, dashboard, chat participant)           │
└─────────────────────────────────────────────────────────────┘
```

## Source Comparison

| Source                  | Accuracy  | Availability      | Use Case                  |
| ----------------------- | --------- | ----------------- | ------------------------- |
| `@weevil` conversations | **Exact** | When using chat   | Per-conversation tracking |
| Local OTel logs         | Estimated | When logs present | Historical usage          |
| Sample data             | Synthetic | Always            | Demo, no-data fallback    |

## @weevil Conversations

When you ask `@weevil` a question, Weevil captures the exact token count from
the model's own tokenizer. This is the most accurate data source.

**What gets captured:**

- Model used
- Input tokens
- Output tokens
- Request timestamp
- Repository (via Git)

**Privacy:** Conversation data is stored locally in Weevil's global storage,
never transmitted anywhere.

## Local Copilot OTel Logs

When Copilot is running in debug mode or with OTel tracing enabled, it writes
log files that Weevil parses.

### Log Location

Weevil auto-detects the log location based on your OS and VS Code installation:

| OS      | Path                                                     |
| ------- | -------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Code/User/globalStorage/` |
| Windows | `%APPDATA%\Code\User\globalStorage\`                     |
| Linux   | `~/.config/Code/User/globalStorage\`                     |

You can override this with `weevil.copilotLogPath`.

### What Gets Parsed

Weevil extracts from OTel spans:

- Operation name (inference, completion, etc.)
- Model ID
- Token counts (when available)
- Latency
- Status codes

### Accuracy Notes

OTel log parsing is **estimated** because:

1. Not all token counts are present in every log entry
2. Weevil estimates missing counts using the operation type and model
3. Log rotation can cause partial data

## Sample Data

When no other data is available, Weevil generates synthetic sample data so
the dashboard always renders something useful.

**Sample data characteristics:**

- 90 days of history
- Realistic usage patterns (higher during "business hours")
- Mix of models (o1, o3, o4-mini)
- Multiple "repositories" for multi-repo filtering

**To force sample data:**

```json
"weevil.dataSource": "sample"
```

## GitHub Billing

The GitHub billing provider is **stubbed**. There's no stable public API for
per-user Copilot usage data via OAuth.

Future integration is planned once GitHub exposes an appropriate endpoint.

## Data Storage

All usage data is stored locally in JSONL (JSON Lines) format:

```
<globalStorageUri>/
└── weevil-events/
    ├── events-2025-01.jsonl
    ├── events-2025-02.jsonl
    └── ...
```

### Event Schema

```typescript
interface UsageEvent {
  id: string; // Unique ID (SHA of content + timestamp)
  timestamp: number; // Unix ms
  source: 'chat' | 'otel' | 'sample';
  model: string; // e.g., "o3"
  surface: string; // e.g., "sidebar", "chat"
  repo: string; // Git repository name
  inputTokens?: number;
  outputTokens?: number;
  credits?: number;
  cost?: number; // Calculated from pricing config
  estimated?: boolean; // True if token counts were estimated
}
```

### Data Retention

Events older than **90 days** are rolled up into daily aggregate buckets to
bound storage size. Aggregated events are marked with `estimated: true`.

## Privacy

- **Local only:** All data stays in your global storage directory
- **No telemetry:** Weevil does not send any usage data anywhere
- **No sign-in required:** Works fully offline
- **Your control:** `Weevil: Export Data` and `Weevil: Clear Data` give you
  full control over your data
