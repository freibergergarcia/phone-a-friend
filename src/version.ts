/**
 * Shared version helper.
 * Reads version from package.json relative to the current module.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getVersion(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(thisDir, '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
