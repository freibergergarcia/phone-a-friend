/**
 * Shared display utilities for doctor, setup, and other user-facing output.
 */

import chalk from 'chalk';
import type { BackendStatus } from './detection.js';

export function mark(available: boolean, planned?: boolean): string {
  if (planned) return chalk.dim('[planned]');
  return available ? chalk.green('\u2713') : chalk.red('\u2717');
}

export function formatBackendLine(b: BackendStatus): string {
  const m = mark(b.available, b.planned);
  const line = `    ${m} ${b.name.padEnd(12)} ${b.detail}`;
  if (!b.available && !b.planned && b.installHint) {
    return `${line}\n${' '.repeat(19)}${chalk.dim(b.installHint)}`;
  }
  return line;
}

export function formatBackendModels(b: BackendStatus): string | null {
  if (b.models && b.models.length > 0) {
    return `${' '.repeat(21)}Models: ${b.models.join(', ')}`;
  }
  return null;
}
