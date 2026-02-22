/**
 * Shared semantic theme for consistent CLI styling.
 *
 * All user-facing output should use these helpers instead of raw chalk calls.
 */

import chalk from 'chalk';
import { getVersion } from './version.js';

export const theme = {
  // Status
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
  hint: chalk.dim,

  // Typography
  bold: chalk.bold,
  heading: chalk.bold,
  label: chalk.bold.dim,

  // Branding
  brand: chalk.cyan.bold,
  version: chalk.dim,

  // Marks
  checkmark: chalk.green('\u2713'),
  crossmark: chalk.red('\u2717'),
  planned: chalk.dim('[planned]'),
} as const;

export function banner(title: string): string {
  const v = getVersion();
  return `  ${theme.brand('phone-a-friend')} ${theme.version(`v${v}`)} \u2014 ${theme.heading(title)}`;
}
