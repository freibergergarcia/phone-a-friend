#!/usr/bin/env python3
"""Install logic for Claude plugin integration."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

INSTALL_TARGETS = frozenset({"claude", "all"})
INSTALL_MODES = frozenset({"symlink", "copy"})
PLUGIN_NAME = "phone-a-friend"
MARKETPLACE_NAME = "phone-a-friend-dev"


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def _install_path(src: Path, dst: Path, mode: str, force: bool) -> str:
    if dst.exists() or dst.is_symlink():
        same_link = dst.is_symlink() and dst.resolve() == src.resolve()
        if same_link:
            return "already-installed"
        if not force:
            raise RuntimeError(f"Destination already exists: {dst}")
        _remove_path(dst)

    _ensure_parent(dst)
    if mode == "symlink":
        dst.symlink_to(src)
    else:
        shutil.copytree(src, dst)
    return "installed"


def _run_claude_command(args: list[str]) -> tuple[int, str]:
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        check=False,
    )
    output = (result.stdout or "") + (result.stderr or "")
    return result.returncode, output.strip()


def _looks_like_ok_if_already(output: str) -> bool:
    text = output.lower()
    return any(
        token in text
        for token in (
            "already configured",
            "already added",
            "already installed",
            "already enabled",
            "already up to date",
        )
    )


def _sync_claude_plugin_registration(
    repo_root: Path,
    *,
    marketplace_name: str = MARKETPLACE_NAME,
    plugin_name: str = PLUGIN_NAME,
    scope: str = "user",
) -> list[str]:
    """Register/install/enable/update plugin via Claude CLI."""
    lines: list[str] = []
    claude_bin = shutil.which("claude")
    if not claude_bin:
        lines.append("- claude_cli: skipped (claude binary not found)")
        return lines

    commands = [
        (["claude", "plugin", "marketplace", "add", str(repo_root)], "marketplace_add"),
        (["claude", "plugin", "marketplace", "update", marketplace_name], "marketplace_update"),
        (["claude", "plugin", "install", f"{plugin_name}@{marketplace_name}", "-s", scope], "install"),
        (["claude", "plugin", "enable", f"{plugin_name}@{marketplace_name}", "-s", scope], "enable"),
        (["claude", "plugin", "update", f"{plugin_name}@{marketplace_name}"], "update"),
    ]

    for cmd, label in commands:
        code, output = _run_claude_command(cmd)
        if code == 0 or _looks_like_ok_if_already(output):
            lines.append(f"- claude_cli_{label}: ok")
        else:
            lines.append(f"- claude_cli_{label}: failed")
            if output:
                lines.append(f"  output: {output}")
    return lines


def _claude_target(claude_home: Path | None = None) -> Path:
    base = claude_home or (Path.home() / ".claude")
    return base / "plugins" / PLUGIN_NAME


def _install_claude(
    repo_root: Path,
    *,
    mode: str,
    force: bool,
    claude_home: Path | None = None,
) -> tuple[str, Path]:
    target = _claude_target(claude_home)
    status = _install_path(repo_root, target, mode=mode, force=force)
    return status, target


def _uninstall_path(path: Path) -> str:
    if path.exists() or path.is_symlink():
        _remove_path(path)
        return "removed"
    return "not-installed"


def _uninstall_claude(*, claude_home: Path | None = None) -> tuple[str, Path]:
    target = _claude_target(claude_home)
    return _uninstall_path(target), target


def _is_valid_repo_root(repo_root: Path) -> bool:
    return (repo_root / ".claude-plugin" / "plugin.json").exists()


def install_hosts(
    *,
    repo_root: Path,
    target: str,
    mode: str = "symlink",
    force: bool = False,
    claude_home: Path | None = None,
    sync_claude_cli: bool = True,
) -> list[str]:
    """Install plugin for Claude."""
    if target not in INSTALL_TARGETS:
        raise ValueError(f"Invalid target: {target}")
    if mode not in INSTALL_MODES:
        raise ValueError(f"Invalid mode: {mode}")

    repo_root = repo_root.resolve()
    if not _is_valid_repo_root(repo_root):
        raise RuntimeError(f"Invalid repo root: {repo_root}")

    lines = [
        "phone-a-friend installer",
        f"- repo_root: {repo_root}",
        f"- mode: {mode}",
    ]

    status, target_path = _install_claude(
        repo_root,
        mode=mode,
        force=force,
        claude_home=claude_home,
    )
    lines.append(f"- claude: {status} -> {target_path}")

    if sync_claude_cli:
        lines.extend(_sync_claude_plugin_registration(repo_root))

    return lines


def uninstall_hosts(
    *,
    target: str,
    claude_home: Path | None = None,
) -> list[str]:
    """Uninstall plugin for Claude."""
    if target not in INSTALL_TARGETS:
        raise ValueError(f"Invalid target: {target}")

    lines = [
        "phone-a-friend uninstaller",
    ]

    status, target_path = _uninstall_claude(claude_home=claude_home)
    lines.append(f"- claude: {status} -> {target_path}")
    return lines
