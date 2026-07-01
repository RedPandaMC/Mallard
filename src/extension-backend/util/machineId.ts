/**
 * Stable, anonymous per-install identifier derived from VS Code's machineId.
 * Never the raw machineId itself — hashed so it can't be correlated with
 * telemetry from other extensions or tools that also read `vscode.env.machineId`.
 */
import * as crypto from 'crypto';
import * as vscode from 'vscode';

export function hashMachineId(): string {
  return crypto.createHash('sha256').update(vscode.env.machineId).digest('hex');
}
