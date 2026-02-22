#!/usr/bin/env node

// src/backends/codex.ts
import { execFileSync as execFileSync2 } from "child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// src/backends/index.ts
import { execFileSync } from "child_process";
var BackendError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "BackendError";
  }
};
var INSTALL_HINTS = {
  codex: "npm install -g @openai/codex",
  gemini: "npm install -g @google/gemini-cli"
};
var registry = /* @__PURE__ */ new Map();
function registerBackend(backend) {
  registry.set(backend.name, backend);
}
function getBackend(name) {
  const backend = registry.get(name);
  if (!backend) {
    const supported = [...registry.keys()].sort().join(", ");
    throw new BackendError(
      `Unsupported relay backend: ${name}. Supported: ${supported}`
    );
  }
  return backend;
}
function isInPath(name) {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function checkBackends(whichFn = isInPath) {
  const result = {};
  for (const name of Object.keys(INSTALL_HINTS).sort()) {
    result[name] = whichFn(name);
  }
  return result;
}

// src/backends/codex.ts
var CodexBackendError = class extends BackendError {
  constructor(message) {
    super(message);
    this.name = "CodexBackendError";
  }
};
var CodexBackend = class {
  name = "codex";
  allowedSandboxes = /* @__PURE__ */ new Set([
    "read-only",
    "workspace-write",
    "danger-full-access"
  ]);
  run(opts) {
    if (!isInPath("codex")) {
      throw new CodexBackendError(
        `codex CLI not found in PATH. Install it: ${INSTALL_HINTS.codex}`
      );
    }
    const tmpDir = mkdtempSync(join(tmpdir(), "phone-a-friend-"));
    const outputPath = join(tmpDir, "codex-last-message.txt");
    try {
      const args = [
        "exec",
        "-C",
        opts.repoPath,
        "--skip-git-repo-check",
        "--sandbox",
        opts.sandbox,
        "--output-last-message",
        outputPath
      ];
      if (opts.model) {
        args.push("-m", opts.model);
      }
      args.push(opts.prompt);
      let stdout = "";
      try {
        const result = execFileSync2("codex", args, {
          timeout: opts.timeoutSeconds * 1e3,
          env: opts.env,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"]
        });
        stdout = result.trim();
      } catch (err) {
        const execErr = err;
        if (execErr.killed || execErr.signal === "SIGTERM" || execErr.code === "ETIMEDOUT") {
          throw new CodexBackendError(
            `codex exec timed out after ${opts.timeoutSeconds}s`
          );
        }
        const lastMessage2 = readOutputFile(outputPath);
        const stderr = execErr.stderr?.toString().trim() ?? "";
        const stdoutStr = execErr.stdout?.toString().trim() ?? "";
        const detail = stderr || stdoutStr || lastMessage2 || `codex exec exited with code ${execErr.status ?? 1}`;
        throw new CodexBackendError(detail);
      }
      const lastMessage = readOutputFile(outputPath);
      if (lastMessage) {
        return lastMessage;
      }
      if (stdout) {
        return stdout;
      }
      throw new CodexBackendError("codex exec completed without producing feedback");
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
      }
    }
  }
};
function readOutputFile(outputPath) {
  if (!existsSync(outputPath)) {
    return "";
  }
  try {
    return readFileSync(outputPath, "utf-8").trim();
  } catch (err) {
    throw new CodexBackendError(
      `Failed reading Codex output file: ${err}`
    );
  }
}
var CODEX_BACKEND = new CodexBackend();
registerBackend(CODEX_BACKEND);

// src/backends/gemini.ts
import { execFileSync as execFileSync3 } from "child_process";
var GeminiBackendError = class extends BackendError {
  constructor(message) {
    super(message);
    this.name = "GeminiBackendError";
  }
};
var GeminiBackend = class {
  name = "gemini";
  allowedSandboxes = /* @__PURE__ */ new Set([
    "read-only",
    "workspace-write",
    "danger-full-access"
  ]);
  run(opts) {
    if (!isInPath("gemini")) {
      throw new GeminiBackendError(
        `gemini CLI not found in PATH. Install it: ${INSTALL_HINTS.gemini}`
      );
    }
    const args = [];
    if (opts.sandbox !== "danger-full-access") {
      args.push("--sandbox");
    }
    args.push("--yolo");
    args.push("--include-directories", opts.repoPath);
    args.push("--output-format", "text");
    if (opts.model) {
      args.push("-m", opts.model);
    }
    args.push("--prompt", opts.prompt);
    try {
      const result = execFileSync3("gemini", args, {
        timeout: opts.timeoutSeconds * 1e3,
        env: opts.env,
        encoding: "utf-8",
        cwd: opts.repoPath,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const output = result.trim();
      if (output) {
        return output;
      }
      throw new GeminiBackendError("gemini completed without producing output");
    } catch (err) {
      if (err instanceof GeminiBackendError) throw err;
      const execErr = err;
      if (execErr.killed || execErr.signal === "SIGTERM" || execErr.code === "ETIMEDOUT") {
        throw new GeminiBackendError(
          `gemini timed out after ${opts.timeoutSeconds}s`
        );
      }
      const stderr = execErr.stderr?.toString().trim() ?? "";
      const stdout = execErr.stdout?.toString().trim() ?? "";
      const detail = stderr || stdout || `gemini exited with code ${execErr.status ?? 1}`;
      throw new GeminiBackendError(detail);
    }
  }
};
var GEMINI_BACKEND = new GeminiBackend();
registerBackend(GEMINI_BACKEND);

// src/cli.ts
import { resolve as resolve3, dirname as dirname2 } from "path";
import { readFileSync as readFileSync3 } from "fs";
import { fileURLToPath } from "url";

// src/relay.ts
import { execFileSync as execFileSync4 } from "child_process";
import { readFileSync as readFileSync2, existsSync as existsSync2, statSync } from "fs";
import { resolve } from "path";
var DEFAULT_TIMEOUT_SECONDS = 600;
var DEFAULT_BACKEND = "codex";
var DEFAULT_SANDBOX = "read-only";
var MAX_RELAY_DEPTH = 1;
var MAX_CONTEXT_FILE_BYTES = 2e5;
var MAX_DIFF_BYTES = 3e5;
var MAX_PROMPT_BYTES = 5e5;
var RelayError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RelayError";
  }
};
function sizeBytes(text) {
  return Buffer.byteLength(text, "utf-8");
}
function ensureSizeLimit(label, text, maxBytes) {
  const size = sizeBytes(text);
  if (size > maxBytes) {
    throw new RelayError(`${label} is too large (${size} bytes; max ${maxBytes} bytes)`);
  }
}
function readContextFile(contextFile) {
  if (contextFile === null) return "";
  const resolved = resolve(contextFile);
  if (!existsSync2(resolved)) {
    throw new RelayError(`Context file does not exist: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw new RelayError(`Context path is not a file: ${resolved}`);
  }
  try {
    const contents = readFileSync2(resolved, "utf-8").trim();
    ensureSizeLimit("Context file", contents, MAX_CONTEXT_FILE_BYTES);
    return contents;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    throw new RelayError(`Failed reading context file: ${err}`);
  }
}
function resolveContextText(contextFile, contextText) {
  const fileText = readContextFile(contextFile);
  const inlineText = (contextText ?? "").trim();
  if (contextFile !== null && inlineText) {
    throw new RelayError("Use either context_file or context_text, not both");
  }
  if (inlineText) {
    ensureSizeLimit("Context text", inlineText, MAX_CONTEXT_FILE_BYTES);
    return inlineText;
  }
  return fileText;
}
function gitDiff(repoPath) {
  try {
    const result = execFileSync4("git", ["-C", repoPath, "diff", "--"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const diffText = result.trim();
    ensureSizeLimit("Git diff", diffText, MAX_DIFF_BYTES);
    return diffText;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    const execErr = err;
    const detail = execErr.stderr?.toString().trim() || execErr.stdout?.toString().trim() || "git diff failed";
    throw new RelayError(`Failed to collect git diff: ${detail}`);
  }
}
function buildPrompt(opts) {
  const sections = [
    "You are helping another coding agent by reviewing or advising on work in a local repository.",
    `Repository path: ${opts.repoPath}`,
    "Use the repository files for context when needed.",
    "Respond with concise, actionable feedback.",
    "",
    "Request:",
    opts.prompt.trim()
  ];
  if (opts.contextText) {
    sections.push("", "Additional Context:", opts.contextText);
  }
  if (opts.diffText) {
    sections.push("", "Git Diff:", opts.diffText);
  }
  return sections.join("\n").trim();
}
function nextRelayEnv() {
  const depthRaw = process.env.PHONE_A_FRIEND_DEPTH ?? "0";
  const depth = /^\d+$/.test(depthRaw) ? Number(depthRaw) : 0;
  if (depth >= MAX_RELAY_DEPTH) {
    throw new RelayError("Relay depth limit reached; refusing nested relay invocation");
  }
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== void 0) env[key] = value;
  }
  env.PHONE_A_FRIEND_DEPTH = String(depth + 1);
  return env;
}
function relay(opts) {
  const {
    prompt,
    repoPath,
    backend = DEFAULT_BACKEND,
    contextFile = null,
    contextText = null,
    includeDiff = false,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    model = null,
    sandbox = DEFAULT_SANDBOX
  } = opts;
  if (!prompt.trim()) {
    throw new RelayError("Prompt is required");
  }
  if (timeoutSeconds <= 0) {
    throw new RelayError("Timeout must be greater than zero");
  }
  const resolvedRepo = resolve(repoPath);
  if (!existsSync2(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
    throw new RelayError(
      `Repository path does not exist or is not a directory: ${resolvedRepo}`
    );
  }
  let selectedBackend;
  try {
    selectedBackend = getBackend(backend);
  } catch (err) {
    throw new RelayError(String(err.message));
  }
  if (!selectedBackend.allowedSandboxes.has(sandbox)) {
    const allowed = [...selectedBackend.allowedSandboxes].sort().join(", ");
    throw new RelayError(`Invalid sandbox mode: ${sandbox}. Allowed values: ${allowed}`);
  }
  const resolvedContext = resolveContextText(contextFile, contextText);
  const diffText = includeDiff ? gitDiff(resolvedRepo) : "";
  const fullPrompt = buildPrompt({
    prompt,
    repoPath: resolvedRepo,
    contextText: resolvedContext,
    diffText
  });
  ensureSizeLimit("Relay prompt", fullPrompt, MAX_PROMPT_BYTES);
  const env = nextRelayEnv();
  try {
    return selectedBackend.run({
      prompt: fullPrompt,
      repoPath: resolvedRepo,
      timeoutSeconds,
      sandbox,
      model,
      env
    });
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof BackendError) {
      throw new RelayError(err.message);
    }
    throw err;
  }
}

// src/installer.ts
import { execFileSync as execFileSync5 } from "child_process";
import {
  existsSync as existsSync3,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync as rmSync2,
  symlinkSync,
  cpSync,
  unlinkSync
} from "fs";
import { resolve as resolve2, join as join2, dirname } from "path";
import { homedir } from "os";
var PLUGIN_NAME = "phone-a-friend";
var MARKETPLACE_NAME = "phone-a-friend-dev";
var INSTALL_TARGETS = /* @__PURE__ */ new Set(["claude", "all"]);
var INSTALL_MODES = /* @__PURE__ */ new Set(["symlink", "copy"]);
var InstallerError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InstallerError";
  }
};
function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}
function removePath(filePath) {
  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      unlinkSync(filePath);
    } else if (stat.isDirectory()) {
      rmSync2(filePath, { recursive: true, force: true });
    }
  } catch {
  }
}
function installPath(src, dst, mode, force) {
  const dstExists = existsSync3(dst) || isSymlink(dst);
  if (dstExists) {
    if (isSymlink(dst) && realpathSync(dst) === realpathSync(src)) {
      return "already-installed";
    }
    if (!force) {
      throw new InstallerError(`Destination already exists: ${dst}`);
    }
    removePath(dst);
  }
  ensureParent(dst);
  if (mode === "symlink") {
    symlinkSync(src, dst);
  } else {
    cpSync(src, dst, { recursive: true });
  }
  return "installed";
}
function isSymlink(filePath) {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
function runClaudeCommand(args) {
  try {
    const result = execFileSync5(args[0], args.slice(1), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { code: 0, output: result.trim() };
  } catch (err) {
    const execErr = err;
    const stdout = execErr.stdout?.toString() ?? "";
    const stderr = execErr.stderr?.toString() ?? "";
    return {
      code: execErr.status ?? 1,
      output: (stdout + stderr).trim()
    };
  }
}
function looksLikeOkIfAlready(output) {
  const text = output.toLowerCase();
  return [
    "already configured",
    "already added",
    "already installed",
    "already enabled",
    "already up to date"
  ].some((token) => text.includes(token));
}
function syncClaudePluginRegistration(repoRoot, marketplaceName = MARKETPLACE_NAME, pluginName = PLUGIN_NAME, scope = "user") {
  const lines = [];
  try {
    execFileSync5("which", ["claude"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    lines.push("- claude_cli: skipped (claude binary not found)");
    return lines;
  }
  const commands = [
    [["claude", "plugin", "marketplace", "add", repoRoot], "marketplace_add"],
    [["claude", "plugin", "marketplace", "update", marketplaceName], "marketplace_update"],
    [["claude", "plugin", "install", `${pluginName}@${marketplaceName}`, "-s", scope], "install"],
    [["claude", "plugin", "enable", `${pluginName}@${marketplaceName}`, "-s", scope], "enable"],
    [["claude", "plugin", "update", `${pluginName}@${marketplaceName}`], "update"]
  ];
  for (const [cmd, label] of commands) {
    const { code, output } = runClaudeCommand(cmd);
    if (code === 0 || looksLikeOkIfAlready(output)) {
      lines.push(`- claude_cli_${label}: ok`);
    } else {
      lines.push(`- claude_cli_${label}: failed`);
      if (output) {
        lines.push(`  output: ${output}`);
      }
    }
  }
  return lines;
}
function claudeTarget(claudeHome) {
  const base = claudeHome ?? join2(homedir(), ".claude");
  return join2(base, "plugins", PLUGIN_NAME);
}
function installClaude(repoRoot, mode, force, claudeHome) {
  const target = claudeTarget(claudeHome);
  const status = installPath(repoRoot, target, mode, force);
  return { status, targetPath: target };
}
function uninstallPath(filePath) {
  if (existsSync3(filePath) || isSymlink(filePath)) {
    removePath(filePath);
    return "removed";
  }
  return "not-installed";
}
function uninstallClaude(claudeHome) {
  const target = claudeTarget(claudeHome);
  return { status: uninstallPath(target), targetPath: target };
}
function isValidRepoRoot(repoRoot) {
  return existsSync3(join2(repoRoot, ".claude-plugin", "plugin.json"));
}
function installHosts(opts) {
  const {
    repoRoot,
    target,
    mode = "symlink",
    force = false,
    claudeHome,
    syncClaudeCli = true
  } = opts;
  if (!INSTALL_TARGETS.has(target)) {
    throw new InstallerError(`Invalid target: ${target}`);
  }
  if (!INSTALL_MODES.has(mode)) {
    throw new InstallerError(`Invalid mode: ${mode}`);
  }
  const resolvedRepo = resolve2(repoRoot);
  if (!isValidRepoRoot(resolvedRepo)) {
    throw new InstallerError(`Invalid repo root: ${resolvedRepo}`);
  }
  const lines = [
    "phone-a-friend installer",
    `- repo_root: ${resolvedRepo}`,
    `- mode: ${mode}`
  ];
  const { status, targetPath } = installClaude(resolvedRepo, mode, force, claudeHome);
  lines.push(`- claude: ${status} -> ${targetPath}`);
  if (syncClaudeCli) {
    lines.push(...syncClaudePluginRegistration(resolvedRepo));
  }
  return lines;
}
function uninstallHosts(opts) {
  const { target, claudeHome } = opts;
  if (!INSTALL_TARGETS.has(target)) {
    throw new InstallerError(`Invalid target: ${target}`);
  }
  const lines = ["phone-a-friend uninstaller"];
  const { status, targetPath } = uninstallClaude(claudeHome);
  lines.push(`- claude: ${status} -> ${targetPath}`);
  return lines;
}
function verifyBackends() {
  const availability = checkBackends();
  return Object.entries(availability).map(([name, available]) => ({
    name,
    available,
    hint: INSTALL_HINTS[name] ?? ""
  }));
}

// src/cli.ts
function getVersion() {
  const thisDir = dirname2(fileURLToPath(import.meta.url));
  const pkgPath = resolve3(thisDir, "..", "package.json");
  try {
    const pkg = JSON.parse(readFileSync3(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
function repoRootDefault() {
  const thisDir = dirname2(fileURLToPath(import.meta.url));
  return resolve3(thisDir, "..");
}
function normalizeArgv(argv) {
  if (argv.length === 0) return argv;
  const first = argv[0];
  if (["relay", "install", "update", "uninstall", "-h", "--help", "--version"].includes(first)) {
    return argv;
  }
  if (first.startsWith("-")) {
    return ["relay", ...argv];
  }
  return argv;
}
function printBackendAvailability() {
  console.log("\nBackend availability:");
  for (const info of verifyBackends()) {
    const mark = info.available ? "\u2713" : "\u2717";
    const status = info.available ? "available" : "not found";
    console.log(`  ${mark} ${info.name}: ${status}`);
    if (!info.available && info.hint) {
      console.log(`    Install: ${info.hint}`);
    }
  }
}
function handleRelay(args) {
  const feedback = relay({
    prompt: args.prompt,
    repoPath: args.repo,
    backend: args.to,
    contextFile: args.contextFile,
    contextText: args.contextText,
    includeDiff: args.includeDiff,
    timeoutSeconds: args.timeout,
    model: args.model,
    sandbox: args.sandbox
  });
  console.log(feedback);
  return 0;
}
function handleInstall(args) {
  const target = args.all ? "all" : "claude";
  const lines = installHosts({
    repoRoot: args.repoRoot,
    target,
    mode: args.mode,
    force: args.force,
    syncClaudeCli: !args.noClaudeCliSync
  });
  for (const line of lines) console.log(line);
  printBackendAvailability();
  return 0;
}
function handleUpdate(args) {
  return handleInstall({
    claude: true,
    all: false,
    mode: args.mode,
    force: true,
    repoRoot: args.repoRoot,
    noClaudeCliSync: args.noClaudeCliSync
  });
}
function handleUninstall(args) {
  const target = args.all ? "all" : "claude";
  const lines = uninstallHosts({ target });
  for (const line of lines) console.log(line);
  return 0;
}
function parseArgs(argv) {
  const opts = {};
  let command = "";
  let i = 0;
  if (argv.length > 0 && !argv[0].startsWith("-")) {
    command = argv[0];
    i = 1;
  }
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        opts[name] = argv[i + 1];
        i += 2;
      } else {
        opts[name] = true;
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return { command, opts };
}
function run(argv) {
  if (argv.includes("--version")) {
    console.log(`phone-a-friend ${getVersion()}`);
    return 0;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  const normalized = normalizeArgv(argv);
  const { command, opts } = parseArgs(normalized);
  try {
    switch (command) {
      case "relay":
        return handleRelay({
          to: String(opts["to"] ?? DEFAULT_BACKEND),
          repo: String(opts["repo"] ?? process.cwd()),
          prompt: String(opts["prompt"] ?? ""),
          contextFile: opts["context-file"] != null ? String(opts["context-file"]) : null,
          contextText: opts["context-text"] != null ? String(opts["context-text"]) : null,
          includeDiff: opts["include-diff"] === true,
          timeout: opts["timeout"] != null ? Number(opts["timeout"]) : DEFAULT_TIMEOUT_SECONDS,
          model: opts["model"] != null ? String(opts["model"]) : null,
          sandbox: String(opts["sandbox"] ?? DEFAULT_SANDBOX)
        });
      case "install":
        return handleInstall({
          claude: opts["claude"] === true,
          all: opts["all"] === true,
          mode: String(opts["mode"] ?? "symlink"),
          force: opts["force"] === true,
          repoRoot: String(opts["repo-root"] ?? repoRootDefault()),
          noClaudeCliSync: opts["no-claude-cli-sync"] === true
        });
      case "update":
        return handleUpdate({
          mode: String(opts["mode"] ?? "symlink"),
          repoRoot: String(opts["repo-root"] ?? repoRootDefault()),
          noClaudeCliSync: opts["no-claude-cli-sync"] === true
        });
      case "uninstall":
        return handleUninstall({
          claude: opts["claude"] === true,
          all: opts["all"] === true
        });
      default:
        printHelp();
        return 1;
    }
  } catch (err) {
    if (err instanceof RelayError || err instanceof InstallerError) {
      console.error(String(err.message));
      return 1;
    }
    if (err instanceof Error) {
      console.error(String(err.message));
      return 1;
    }
    throw err;
  }
}
function printHelp() {
  console.log(`phone-a-friend - CLI relay for AI coding agent collaboration

Usage:
  phone-a-friend relay --prompt "..." [options]
  phone-a-friend install --claude [options]
  phone-a-friend update [options]
  phone-a-friend uninstall --claude

Commands:
  relay       Relay prompt/context to a coding backend (default)
  install     Install Claude plugin
  update      Update Claude plugin (equivalent to install --force)
  uninstall   Uninstall Claude plugin

Relay options:
  --to <backend>           Target backend: codex, gemini (default: codex)
  --repo <path>            Repository path (default: cwd)
  --prompt <text>          Prompt to relay (required)
  --context-file <path>    File with additional context
  --context-text <text>    Inline context text
  --include-diff           Append git diff to prompt
  --timeout <seconds>      Max runtime in seconds (default: 600)
  --model <name>           Model override
  --sandbox <mode>         Sandbox: read-only, workspace-write, danger-full-access

Install options:
  --claude                 Install for Claude
  --all                    Alias for --claude
  --mode <mode>            symlink or copy (default: symlink)
  --force                  Replace existing installation
  --repo-root <path>       Repository root path
  --no-claude-cli-sync     Skip Claude CLI sync

General:
  --version                Show version
  --help, -h               Show this help
`);
}

// src/index.ts
process.exit(run(process.argv.slice(2)));
