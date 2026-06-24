/**
 * Builds and wires every Mallard service in one place, so activation reads as a
 * flat list of registrations. All disposables are pushed onto the extension
 * context's subscriptions.
 */
import * as vscode from 'vscode';
import { readConfig } from './config';
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
import { EventStore } from './store/EventStore';
import { createMetricExporter } from './export/ExporterFactory';
import { NullMetricExporter } from './export/MetricExporter';
import { opt } from './util/lang';

export interface Container {
  usage: UsageService;
  store: EventStore;
  userConfig: UserConfigStore;
  layout: LayoutStore;
  pricing: PricingService;
  restriction: RestrictionEngine;
}

export async function buildContainer(context: vscode.ExtensionContext): Promise<Container> {
  void initRepoAttribution();
  const bundledManifest = await loadBundledManifest(context);

  const cfg = readConfig();
  const storageDir = context.globalStorageUri.fsPath;

  const pricing = new PricingService(storageDir, bundledManifest, cfg.pricingManifestUrl || '');
  await pricing.load();
  pricing.startDailyRefresh();

  const store = await EventStore.open(storageDir);
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

  const githubSession = new GitHubSession();
  const github = new GitHubUsageService(githubSession);
  const userConfig = new UserConfigStore(storageDir);
  const layout = new LayoutStore(context.globalState);

  const ve = cfg.metricExport;
  const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath);
  const exporter = createMetricExporter({
    ...opt('brokerUrl',       ve.brokerUrl   || undefined),
    ...opt('topic',           ve.topic       || undefined),
    ...opt('username',        ve.username    || undefined),
    ...opt('password',        ve.password    || undefined),
    ...opt('certPath',        ve.certPath    || undefined),
    ...opt('keyPath',         ve.keyPath     || undefined),
    ...opt('caPath',          ve.caPath      || undefined),
    ...(workspaceFolders?.length ? { workspaceFolders } : {}),
  }) ?? new NullMetricExporter();

  const usage = new UsageService(store.reader, pricing, ingest, userConfig, github, exporter);
  const restriction = new RestrictionEngine(storageDir);

  context.subscriptions.push(
    usage.onDidChangeSnapshot(async (snapshot) => {
      const cfg = userConfig.get();
      await restriction.reconcile({
        snapshot,
        rules: cfg.rules ?? [],
        ...opt('vars',           cfg.vars),
        ...opt('groups',         cfg.groups),
        signedIn: snapshot.authStatus === 'signed-in',
        ...opt('branchBudgets', cfg.branchBudgets),
      });
    }),
  );

  context.subscriptions.push(
    { dispose: () => pricing.dispose() },
    { dispose: () => githubSession.dispose() },
    { dispose: () => store.dispose() },
    userConfig,
    layout,
    usage,
    restriction,
    { dispose: () => exporter.dispose() },
  );

  return { usage, store, userConfig, layout, pricing, restriction };
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
