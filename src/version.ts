/**
 * Shared version and path helpers.
 * Resolves paths relative to the package root (one level above dist/).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root directory (parent of dist/). Works for both repo and global npm installs. */
export function getPackageRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, '..');
}

export function getVersion(): string {
  const pkgPath = resolve(getPackageRoot(), 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
