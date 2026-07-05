import * as path from 'path';
import { promises as fs } from 'fs';
import type * as vscode from 'vscode';
import { readCopilotOtel } from '../config';
import { writeSetting } from '../util/vscodeSettings';
import type { ApplyResult, SetupRequirement } from './SetupRequirement';

const COPILOT_SECTION = 'github.copilot.chat';
const OUTFILE_NAME = 'copilot-otel.jsonl';

/**
 * Concrete [[SetupRequirement]] for GitHub Copilot: enable its OpenTelemetry
 * file exporter so it writes local usage Mallard can ingest. `apply` points the
 * exporter at a file under Mallard's global storage; `readCopilotOtel` then
 * discovers it.
 */
export class CopilotOtelRequirement implements SetupRequirement {
  readonly id = 'copilot-otel';
  readonly title = 'Enable Copilot usage tracking';
  readonly detail =
    "GitHub Copilot doesn't write local usage by default. Enable its OpenTelemetry file exporter so Mallard can track Copilot usage locally.";
  readonly watchKeys = [
    'github.copilot.chat.otel.exporterType',
    'github.copilot.chat.otel.outfile',
    'mallard.copilotOtelPath',
  ];
  readonly docs = 'https://code.visualstudio.com/docs/copilot/reference/copilot-settings';

  isSatisfied(): boolean {
    return readCopilotOtel().kind !== 'none';
  }

  async apply(context: vscode.ExtensionContext): Promise<ApplyResult> {
    const outfile = path.join(context.globalStorageUri.fsPath, OUTFILE_NAME);
    try {
      await fs.mkdir(path.dirname(outfile), { recursive: true });
      await writeSetting(COPILOT_SECTION, 'otel.exporterType', 'file');
      await writeSetting(COPILOT_SECTION, 'otel.outfile', outfile);
    } catch (err) {
      return { ok: false, message: `Mallard could not enable Copilot telemetry: ${String(err)}` };
    }
    return {
      ok: true,
      message: 'Copilot telemetry enabled. Use Copilot for a moment, then Mallard will start tracking it.',
      reloadHint: true,
    };
  }
}
