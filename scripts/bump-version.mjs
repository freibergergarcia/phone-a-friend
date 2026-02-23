#!/usr/bin/env node

/**
 * Bump version in package.json and .claude-plugin/plugin.json.
 *
 * Usage: node scripts/bump-version.mjs <patch|minor|major>
 * Prints the new version to stdout.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const LEVEL = process.argv[2];
if (!["patch", "minor", "major"].includes(LEVEL)) {
  console.error(`Usage: bump-version.mjs <patch|minor|major>`);
  process.exit(1);
}

function bumpSemver(version, level) {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function updateJsonFile(filePath, newVersion) {
  const raw = readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  json.version = newVersion;
  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
}

const pkgPath = resolve(root, "package.json");
const pluginPath = resolve(root, ".claude-plugin/plugin.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const newVersion = bumpSemver(pkg.version, LEVEL);

updateJsonFile(pkgPath, newVersion);
updateJsonFile(pluginPath, newVersion);

console.log(newVersion);
