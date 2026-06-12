/**
 * The @weevil chat participant. Answers usage questions from the snapshot and
 * (best-effort) records its own turn as an accurate event via ChatCapture.
 */
import * as vscode from 'vscode';
import { ChatCapture } from '../capture/ChatCapture';
import { UsageService } from '../data/UsageService';
import { pickTip } from '../tips/tips';
import { parseIntent } from './intent';
import { respond } from './responder';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  usage: UsageService,
  capture: ChatCapture,
): vscode.Disposable {
  const handler: vscode.ChatRequestHandler = async (request, _chatContext, stream, _token) => {
    const intent = parseIntent(request.prompt, request.command);

    let snapshot = usage.current;
    if (!snapshot) {
      await usage.refresh();
      snapshot = usage.current;
    }

    let body: string;
    if (intent.kind === 'tips') {
      const tip = pickTip(snapshot);
      body = `**${tip.title}** — ${tip.body}`;
    } else if (snapshot) {
      body = respond(intent, snapshot);
    } else {
      body = 'Weevil is still gathering your usage — try again in a moment.';
    }

    stream.markdown(body);
    stream.button({ command: 'weevil.openDashboard', title: 'Open dashboard' });

    // Record this @weevil turn accurately (token counts from the model's own tokenizer).
    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (model) {
        await capture.record(model, `weevil:${request.command ?? 'chat'}`, request.prompt, body);
      }
    } catch {
      // capture is best-effort; never fail the chat turn
    }

    return { metadata: { command: intent.kind } };
  };

  const participant = vscode.chat.createChatParticipant('weevil.chat', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'weevil-chat.svg');
  return participant;
}
