/**
 * Records ACCURATE usage events for @weevil conversations. Because we control
 * the request, we can count input + output tokens via the model's own
 * tokenizer (`countTokens`) — the one place per-conversation numbers are exact
 * rather than estimated.
 */
import * as vscode from 'vscode';
import { readConfig } from '../config';
import { priceRequest } from '../model/pricing';
import { UsageEvent } from '../model/types';
import { activeAttribution } from '../util/repo';
import { UsageService } from '../data/UsageService';

export class ChatCapture {
  constructor(private readonly usage: UsageService) {}

  async record(
    model: vscode.LanguageModelChat,
    chatId: string,
    promptText: string,
    responseText: string,
  ): Promise<void> {
    const cfg = readConfig();
    const modelId = model.id || model.family || 'unknown';

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    try {
      promptTokens = await model.countTokens(promptText);
    } catch {
      // tokenizer unavailable — leave undefined
    }
    try {
      completionTokens = await model.countTokens(responseText);
    } catch {
      // ignore
    }

    const { credits, cost } = priceRequest(modelId, {
      pricePerCredit: cfg.pricePerCredit,
      currency: cfg.currency,
      modelMultipliers: cfg.modelMultipliers,
    });
    const attribution = activeAttribution();

    const event: UsageEvent = {
      id: `lm:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      modelId,
      surface: 'chat',
      source: 'lm',
      promptTokens,
      completionTokens,
      credits,
      cost,
      estimated: false,
      repo: attribution.repo,
      workspaceFolder: attribution.workspaceFolder,
      chatId,
    };

    await this.usage.record([event]);
  }
}
