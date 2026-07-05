# Contributing to Mallard

Mallard is a VS Code extension (TypeScript) with an optional self-hosted server (Python/FastAPI). This guide covers the toolchain and per-area test commands.

## Prerequisites

- **Node.js LTS** (required for mocha/c8/tsx — `bun` alone cannot run the test hooks)
- **Bun** (package manager and script runner)
- **Python 3.12+** with `uv` (for the server)

## Setup

```bash
bun install
uv pip install -e ".[dev]"   # server dev deps
```

## Extension (TypeScript)

```bash
bun run check-types    # tsc --noEmit for both host and webview tsconfigs
bun run lint           # eslint
bun run test:unit      # mocha unit tests (pure logic)
bun run test:coverage  # c8 mocha — enforces 100% statements + lines (check-coverage: true)
bun run test           # real vscode-test integration tests (Electron)
bun run pretest        # compile-tests + compile + check-types + lint (runs before test)
```

### Coverage gate

`.c8rc.json` enforces 100% statement and line coverage with `check-coverage: true`. The gate runs in CI via `bun run test:coverage`. Files excluded from coverage: `extension.ts` and `container.ts` (covered by the real vscode-test integration suite) and `store/schema/**` (pure SQL/DDL).

If you add a new source file, it must have tests. If a branch is genuinely untestable (defensive catch, TypeScript exhaustiveness check, 24h timer callback), use a targeted `/* c8 ignore next N */` pragma with a comment explaining why.

### Frontend tests

Frontend tests use jsdom + an echarts stub (`test/unit/setup/jsdom.cjs`). The stub intercepts echarts module resolution so chart `setOption` calls capture options instead of rendering pixels. Tooltip/label formatters are auto-invoked with mock params for coverage.

### Settings/commands docs sync

The integration test (`test/integration/extension.test.ts`) enforces that `docs/reference/settings.md` and `docs/reference/commands.md` stay in sync with `package.json` contributes. If you add or change a setting/command, update both the docs and the integration test expectations.

## Server (Python)

```bash
pytest -v                                      # all server tests
pytest --cov=server --cov-report=term-missing  # with coverage
pytest src/server/tests/fuzz/ -v               # property-based fuzz tests
```

## Docs

```bash
bun run docs:build     # build the VitePress site
bun run docs:dev       # preview locally
```

Docs live in `docs/`. The footer reads `v1 · © 2026 RedPandaMC`.
