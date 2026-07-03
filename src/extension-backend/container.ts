/**
 * Builds and wires every Mallard service in one place, so activation reads as a
 * flat list of registrations. All disposables are pushed onto the extension
 * context's subscriptions.
 */
import * as vscode from 'vscode';
import { readConfig } from './config';
import { migrateSecretsFromSettings } from './app/credentials';
import { UsageService } from './app/UsageService';
import { UserConfigStore } from './app/UserConfigStore';
import { LayoutStore } from './app/LayoutStore';
import { GitHubSession } from './billing/GitHubSession';
import { GitHubUsageService } from './billing/GitHubUsageService';
import { RestrictionEngine } from './domain/restriction/engine';
import { PricingManifest } from './domain/pricing';
import { initRepoAttribution } from './ingest/repoResolver';
import { CopilotConnector } from './ingest/CopilotConnector';
import { ClaudeCodeConnector } from './ingest/ClaudeCodeConnector';
import { ConnectorRegistry } from './ingest/ConnectorRegistry';
import { WorkspaceFolderMatcher } from './ingest/WorkspaceFolderMatcher';
import { IngestService } from './ingest/IngestService';
import { PricingService } from './pricing/PricingService';
import { CurrencyService } from './pricing/CurrencyService';
import { EventStore } from './store/EventStore';
import { AuthProvider } from './export/AuthProvider';
import { opt } from './util/lang';

export interface Container {
  usage: UsageService;
  store: EventStore;
  userConfig: UserConfigStore;
  layout: LayoutStore;
  pricing: PricingService;
  restriction: RestrictionEngine;
  ingest: IngestService;
}

export async function buildContainer(context: vscode.ExtensionContext): Promise<Container> {
  void initRepoAttribution();
  const bundledManifest = await loadBundledManifest(context);

  // Move any credentials from the deprecated plaintext settings into
  // SecretStorage BEFORE reading config, so this run already sees them blanked.
  await migrateSecretsFromSettings(context);

  const cfg = readConfig();
  const storageDir = context.globalStorageUri.fsPath;

  const pricing = new PricingService(storageDir, bundledManifest, cfg.pricingManifestUrl || '');
  await pricing.load();
  pricing.startDailyRefresh();

  const currency = new CurrencyService(storageDir);
  await currency.load();
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
    context.logUri?.fsPath,
    cfg.copilotLogPath || undefined,
  );
  const claudeCode = new ClaudeCodeConnector(
    pricing,
    store.meta,
    store.fileReader,
    new WorkspaceFolderMatcher(() => vscode.workspace.workspaceFolders),
  );

  const ingest = new IngestService(
    new ConnectorRegistry()
      .register(copilot)
      .register(claudeCode)
      .build(),
  );

  const githubSession = new GitHubSession(context.secrets);
  const github = new GitHubUsageService(githubSession);
  const userConfig = new UserConfigStore(storageDir);
  const layout = new LayoutStore(context.globalState);

  // Deliver the config.json githubBilling block (mode/pat/org) and keep it
  // live on config changes — previously configure() was never called, so the
  // whole user-level PAT path was dead.
  githubSession.configure(userConfig.get().githubBilling);
  context.subscriptions.push(
    userConfig.onDidChange((c) => githubSession.configure(c.githubBilling)),
  );

  // Extra webhook targets from config.json fan the export out to multiple
  // servers. Like the rest of the exporter config, changes require a reload.
  const exporter = await new AuthProvider(
    cfg,
    context,
    userConfig.get().export?.webhookTargets ?? [],
  ).createExporter();

  const usage = new UsageService(store.reader, pricing, ingest, userConfig, currency, github, exporter);
  const restriction = new RestrictionEngine(storageDir);

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
  );

  return { usage, store, userConfig, layout, pricing, restriction, ingest };
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
