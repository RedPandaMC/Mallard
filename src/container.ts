/**
 * Builds and wires every Weevil service in one place, so activation reads as a
 * flat list of registrations. All disposables are pushed onto the extension
 * context's subscriptions.
 */
import * as vscode from 'vscode';
import { readConfig } from './config';
import { UsageService } from './app/UsageService';
import { UserConfigStore } from './app/UserConfigStore';
import { GitHubSession } from './billing/GitHubSession';
import { GitHubUsageService } from './billing/GitHubUsageService';
import { PricingManifest } from './domain/pricing';
import { initRepoAttribution } from './ingest/repoResolver';
import { LogWatcher } from './ingest/LogWatcher';
import { PricingService } from './pricing/PricingService';
import { EventStore } from './store/EventStore';
import { StatusBarController } from './ui/StatusBarController';

export interface Container {
  usage: UsageService;
  store: EventStore;
  userConfig: UserConfigStore;
}

export async function buildContainer(context: vscode.ExtensionContext): Promise<Container> {
  await initRepoAttribution();
  const bundledManifest = await loadBundledManifest(context);

  const cfg = readConfig();
  const storageDir = context.globalStorageUri.fsPath;

  const pricing = new PricingService(storageDir, bundledManifest, cfg.pricingManifestUrl || '');
  await pricing.load();
  pricing.startDailyRefresh();

  const store = new EventStore(storageDir);
  const watcher = new LogWatcher(
    store,
    pricing,
    context.logUri?.fsPath,
    cfg.copilotLogPath || undefined,
  );

  const githubSession = new GitHubSession();
  const github = new GitHubUsageService(githubSession);
  const userConfig = new UserConfigStore(context.globalState);
  const usage = new UsageService(store, pricing, watcher, userConfig, github);
  const statusBar = new StatusBarController();

  context.subscriptions.push(
    { dispose: () => pricing.dispose() },
    { dispose: () => githubSession.dispose() },
    userConfig,
    usage,
    statusBar,
    usage.onDidChangeSnapshot((s) => statusBar.update(s)),
  );

  return { usage, store, userConfig };
}

async function loadBundledManifest(
  context: vscode.ExtensionContext,
): Promise<PricingManifest> {
  const fallback: PricingManifest = { version: 1, pricePerCredit: 0.04, updatedAt: '', models: {} };
  const path = vscode.Uri.joinPath(context.extensionUri, 'media', 'pricing-manifest.json');
  try {
    const raw = await vscode.workspace.fs.readFile(path);
    return JSON.parse(Buffer.from(raw).toString('utf8')) as PricingManifest;
  } catch {
    return fallback;
  }
}
