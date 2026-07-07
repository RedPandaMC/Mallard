/**
 * Builds and wires every Mallard service in one place, so activation reads as a
 * flat list of registrations. All disposables are pushed onto the extension
 * context's subscriptions.
 */
import * as vscode from 'vscode';
import { readConfig, readCopilotOtel } from './config';
import { UsageService } from './app/UsageService';
import { UserConfigStore } from './app/UserConfigStore';
import { LayoutStore } from './app/LayoutStore';
import { GitHubSession } from './billing/GitHubSession';
import { GitHubUsageService } from './billing/GitHubUsageService';
import { RestrictionEngine } from './app/RestrictionEngine';
import { PricingManifest } from './domain/pricing';
import { initRepoAttribution } from './ingest/repoResolver';
import { CopilotConnector } from './ingest/CopilotConnector';
import { CopilotOtelRequirement } from './ingest/CopilotOtelRequirement';
import { ClaudeCodeConnector } from './ingest/ClaudeCodeConnector';
import { ConnectorRegistry } from './ingest/ConnectorRegistry';
import { ConnectorSetupGate } from './ingest/ConnectorSetupGate';
import { WorkspaceFolderMatcher } from './ingest/WorkspaceFolderMatcher';
import { IngestService } from './ingest/IngestService';
import { PricingService } from './pricing/PricingService';
import { CurrencyService } from './pricing/CurrencyService';
import { EventStore } from './store/EventStore';
import { AuthProvider } from './export/AuthProvider';
import { opt } from './util/lang';
import { DashboardLayout } from './domain/types';
import { layoutToConfigPanels, normalizeLayout } from './domain/layout';

export interface Container {
  usage: UsageService;
  store: EventStore;
  userConfig: UserConfigStore;
  layout: LayoutStore;
  pricing: PricingService;
  restriction: RestrictionEngine;
  ingest: IngestService;
  setupGate: ConnectorSetupGate;
}

export async function buildContainer(context: vscode.ExtensionContext): Promise<Container> {
  void initRepoAttribution();
  const bundledManifest = await loadBundledManifest(context);

  const cfg = readConfig();
  const storageDir = context.globalStorageUri.fsPath;

  const pricing = new PricingService(storageDir, bundledManifest, cfg.pricingManifestUrl || '');
  const currency = new CurrencyService(storageDir);
  // Independent (pricing feed vs FX feed) — load their local caches in parallel
  // rather than awaiting one after the other. Neither blocks on the network now.
  await Promise.all([pricing.load(), currency.load()]);
  pricing.startDailyRefresh();
  currency.startDailyRefresh();

  const store = await EventStore.open(storageDir, cfg.dataRetentionDays);
  await store.writer.setPrices(pricing.allPrices());

  const COMPACT_INTERVAL_MS = 60 * 60 * 1000;
  const compactHandle = setInterval(() => { void store.compact(); }, COMPACT_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(compactHandle) });

  const copilot = new CopilotConnector(
    pricing,
    store.meta,
    store.fileReader,
    () => readCopilotOtel(),
    [new CopilotOtelRequirement()],
  );
  const claudeCode = new ClaudeCodeConnector(
    pricing,
    store.meta,
    store.fileReader,
    new WorkspaceFolderMatcher(() => vscode.workspace.workspaceFolders),
  );

  const enabledConnectors = new Set(
    vscode.workspace.getConfiguration('mallard').get<string[]>('enabledConnectors')
      ?? ['copilot', 'claude-code'],
  );
  // Every connector exposes a canonical `.id`; enable/label off that so adding a
  // new usage source is one entry in this list, not four hardcoded id checks.
  const allConnectors = [copilot, claudeCode];
  const registry = new ConnectorRegistry();
  for (const c of allConnectors) {
    if (enabledConnectors.has(c.id)) registry.register(c);
  }
  const ingest = new IngestService(registry.build());

  const githubSession = new GitHubSession(context.secrets);
  const github = new GitHubUsageService(githubSession);
  const userConfig = new UserConfigStore(storageDir);
  await migrateLegacyStores(context, userConfig);
  const layout = new LayoutStore(userConfig);

  // Deliver the config.json githubBilling block (mode/pat/org) and keep it
  // live on config changes — previously configure() was never called, so the
  // whole user-level PAT path was dead.
  githubSession.configure(userConfig.get().githubBilling);
  context.subscriptions.push(
    userConfig.onDidChange((c) => githubSession.configure(c.githubBilling)),
  );

  // Extra webhook/MQTT targets from config.json fan the export out to
  // multiple destinations. Like the rest of the exporter config, changes
  // require a reload.
  const exporter = await new AuthProvider(
    cfg,
    context,
    userConfig.get().export ?? {},
  ).createExporter();

  const usage = new UsageService(store.reader, pricing, ingest, userConfig, currency, github, exporter);
  // When the background FX refresh lands real rates, recompute so the dashboard
  // updates from the USD-only default it started with.
  currency.onRatesUpdated = () => void usage.refresh();
  const restriction = new RestrictionEngine(storageDir);

  // Generic gate that nudges the user to enable any connector prerequisite
  // (e.g. Copilot's OTel exporter) and re-refreshes once applied. Scoped to
  // only the enabled connectors — no point nudging Copilot OTel setup for a
  // connector the user opted out of via mallard.enabledConnectors.
  const activeConnectors = allConnectors.filter((c) => enabledConnectors.has(c.id));
  const setupGate = new ConnectorSetupGate(context, activeConnectors, () => void usage.refresh());

  context.subscriptions.push(
    usage.onDidChangeSnapshot((snapshot) => {
      const userCfg = userConfig.get();
      void restriction.reconcile({
        snapshot,
        rules: userCfg.rules ?? [],
        ...opt('vars',           userCfg.vars),
        ...opt('groups',         userCfg.groups),
        signedIn: snapshot.authStatus === 'signed-in',
        ...opt('branchBudgets', userCfg.branchBudgets),
      }).catch((err: unknown) =>
        console.error('[mallard] restriction reconcile failed:', err),
      );
    }),
  );

  context.subscriptions.push(
    { dispose: () => pricing.dispose() },
    { dispose: () => currency.dispose() },
    { dispose: () => githubSession.dispose() },
    { dispose: () => store.dispose() },
    userConfig,
    layout,
    usage,
    restriction,
    { dispose: () => exporter.dispose() },
    setupGate,
  );

  return { usage, store, userConfig, layout, pricing, restriction, ingest, setupGate };
}

/**
 * One-time moves into config.json, the single user-config store:
 * - the dashboard layout previously kept in globalState
 * - the display currency previously kept in the (now removed) mallard.currency
 *   VS Code setting
 * Both run only when config.json doesn't already carry a value, then the
 * legacy copy is cleared so this never runs again.
 */
async function migrateLegacyStores(
  context: vscode.ExtensionContext,
  userConfig: UserConfigStore,
): Promise<void> {
  const LEGACY_LAYOUT_KEY = 'mallard.dashboardLayout';
  const legacyLayout = context.globalState.get<DashboardLayout>(LEGACY_LAYOUT_KEY);
  if (legacyLayout) {
    if (!userConfig.get().dashboard?.panels?.length) {
      await userConfig.set({
        dashboard: {
          ...userConfig.get().dashboard,
          panels: layoutToConfigPanels(normalizeLayout(legacyLayout)),
        },
      });
    }
    await context.globalState.update(LEGACY_LAYOUT_KEY, undefined);
  }

  if (!userConfig.get().currency) {
    const legacyCurrency = vscode.workspace
      .getConfiguration('mallard')
      .get<string>('currency', '')
      .trim()
      .toUpperCase();
    if (legacyCurrency && legacyCurrency !== 'USD') {
      await userConfig.set({ currency: legacyCurrency });
    }
  }
}

async function loadBundledManifest(context: vscode.ExtensionContext): Promise<PricingManifest> {
  const fallback: PricingManifest = { version: 1, pricePerCredit: 0.04, updatedAt: '', models: {} };
  const manifestPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'pricing-manifest.json');
  try {
    const raw = await vscode.workspace.fs.readFile(manifestPath);
    return JSON.parse(Buffer.from(raw).toString('utf8')) as PricingManifest;
  } catch {
    return fallback;
  }
}
