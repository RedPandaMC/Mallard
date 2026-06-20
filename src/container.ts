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
import { LogWatcher } from './ingest/LogWatcher';
import { PricingService } from './pricing/PricingService';
import { EventStore } from './store/EventStore';
import { createExporter } from './export/ExporterFactory';

export interface Container {
  usage: UsageService;
  store: EventStore;
  userConfig: UserConfigStore;
  layout: LayoutStore;
  pricing: PricingService;
  restriction: RestrictionEngine;
}

export async function buildContainer(context: vscode.ExtensionContext): Promise<Container> {
  // Best-effort and non-essential to first paint; don't block activation on the
  // Git extension. Until it resolves, attribution falls back to folder names.
  void initRepoAttribution();
  const bundledManifest = await loadBundledManifest(context);

  const cfg = readConfig();
  const storageDir = context.globalStorageUri.fsPath;

  const pricing = new PricingService(storageDir, bundledManifest, cfg.pricingManifestUrl || '');
  await pricing.load();
  pricing.startDailyRefresh();

  const store = await EventStore.open(storageDir);
  const watcher = new LogWatcher(
    store,
    pricing,
    context.logUri?.fsPath,
    cfg.copilotLogPath || undefined,
  );

  const githubSession = new GitHubSession();
  const github = new GitHubUsageService(githubSession);
  const userConfig = new UserConfigStore(storageDir);
  const layout = new LayoutStore(context.globalState);
  const ve = cfg.vectorExport;
  const exporter = createExporter({
    ...(ve.brokerUrl ? { brokerUrl: ve.brokerUrl } : {}),
    ...(ve.topic ? { topic: ve.topic } : {}),
    ...(ve.username ? { username: ve.username } : {}),
    ...(ve.password ? { password: ve.password } : {}),
    ...(ve.certPath ? { certPath: ve.certPath } : {}),
    ...(ve.keyPath ? { keyPath: ve.keyPath } : {}),
    ...(ve.caPath ? { caPath: ve.caPath } : {}),
  }) ?? undefined;
  const usage = new UsageService(store, pricing, watcher, userConfig, github, exporter);
  const restriction = new RestrictionEngine(storageDir);

  // Re-evaluate the restriction on every snapshot fire.
  context.subscriptions.push(
    usage.onDidChangeSnapshot(async (snapshot) => {
      const cfg = userConfig.get();
      await restriction.reconcile({
        snapshot,
        rules: cfg.rules ?? [],
        ...(cfg.vars !== undefined
          ? { vars: cfg.vars as Record<string, import('./domain/expr/ast').Value> }
          : {}),
        ...(cfg.groups !== undefined ? { groups: cfg.groups } : {}),
        signedIn: snapshot.authStatus === 'signed-in',
        ...(cfg.branchBudgets !== undefined ? { branchBudgets: cfg.branchBudgets } : {}),
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
    ...(exporter ? [{ dispose: () => exporter.dispose() }] : []),
  );

  return { usage, store, userConfig, layout, pricing, restriction };
}

async function loadBundledManifest(context: vscode.ExtensionContext): Promise<PricingManifest> {
  const fallback: PricingManifest = { version: 1, pricePerCredit: 0.04, updatedAt: '', models: {} };
  const path = vscode.Uri.joinPath(context.extensionUri, 'media', 'pricing-manifest.json');
  try {
    const raw = await vscode.workspace.fs.readFile(path);
    return JSON.parse(Buffer.from(raw).toString('utf8')) as PricingManifest;
  } catch {
    return fallback;
  }
}
