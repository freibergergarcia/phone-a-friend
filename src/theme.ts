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

  // Art elements
  const dot = chalk.cyan('\u00b7');
  const ln = chalk.dim;
  const hub = chalk.cyan.bold('\u2590\u2588\u258c');

  // Info
  const name = theme.brand('phone-a-friend');
  const ver = theme.version(`v${v}`);
  const sub = theme.heading(title);

  return [
    `   ${dot}  ${dot}  ${dot}`,
    `    ${ln('\u2572')} ${ln('\u2502')} ${ln('\u2571')}    ${name} ${ver}`,
    `     ${hub}     ${sub}`,
    `    ${ln('\u2571')} ${ln('\u2502')} ${ln('\u2572')}`,
    `   ${dot}  ${dot}  ${dot}`,
  ].join('\n');
}
