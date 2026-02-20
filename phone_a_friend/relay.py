#!/usr/bin/env python3
"""Backend-agnostic relay helpers."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from phone_a_friend.backends import BackendError, get_backend

DEFAULT_TIMEOUT_SECONDS = 600
DEFAULT_BACKEND = "codex"
DEFAULT_SANDBOX = "read-only"
MAX_RELAY_DEPTH = 1
MAX_CONTEXT_FILE_BYTES = 200_000
MAX_DIFF_BYTES = 300_000
MAX_PROMPT_BYTES = 500_000


class RelayError(RuntimeError):
    """Raised when relay execution cannot complete."""


def _size_bytes(text: str) -> int:
    return len(text.encode("utf-8"))


def _ensure_size_limit(label: str, text: str, max_bytes: int) -> None:
    size = _size_bytes(text)
    if size > max_bytes:
        raise RelayError(f"{label} is too large ({size} bytes; max {max_bytes} bytes)")


def _read_context_file(context_file: Path | None) -> str:
    if context_file is None:
        return ""
    if not context_file.exists():
        raise RelayError(f"Context file does not exist: {context_file}")
    if not context_file.is_file():
        raise RelayError(f"Context path is not a file: {context_file}")
    try:
        contents = context_file.read_text().strip()
    except OSError as exc:
        raise RelayError(f"Failed reading context file: {exc}") from exc
    _ensure_size_limit("Context file", contents, MAX_CONTEXT_FILE_BYTES)
    return contents


def _resolve_context_text(*, context_file: Path | None, context_text: str | None) -> str:
    file_text = _read_context_file(context_file)
    inline_text = (context_text or "").strip()
    if context_file is not None and inline_text:
        raise RelayError("Use either context_file or context_text, not both")
    if inline_text:
        _ensure_size_limit("Context text", inline_text, MAX_CONTEXT_FILE_BYTES)
        return inline_text
    return file_text


def _git_diff(repo_path: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_path), "diff", "--"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if not detail:
            detail = "git diff failed"
        raise RelayError(f"Failed to collect git diff: {detail}")
    diff_text = result.stdout.strip()
    _ensure_size_limit("Git diff", diff_text, MAX_DIFF_BYTES)
    return diff_text


def _build_prompt(
    *,
    prompt: str,
    repo_path: Path,
    context_text: str,
    diff_text: str,
) -> str:
    sections = [
        "You are helping another coding agent by reviewing or advising on work in a local repository.",
        f"Repository path: {repo_path}",
        "Use the repository files for context when needed.",
        "Respond with concise, actionable feedback.",
        "",
        "Request:",
        prompt.strip(),
    ]

    if context_text:
        sections.extend(["", "Additional Context:", context_text])

    if diff_text:
        sections.extend(["", "Git Diff:", diff_text])

    return "\n".join(sections).strip()


def _next_relay_env() -> dict[str, str]:
    depth_raw = os.environ.get("PHONE_A_FRIEND_DEPTH", "0")
    try:
        depth = int(depth_raw)
    except ValueError:
        depth = 0

    if depth >= MAX_RELAY_DEPTH:
        raise RelayError("Relay depth limit reached; refusing nested relay invocation")

    env = dict(os.environ)
    env["PHONE_A_FRIEND_DEPTH"] = str(depth + 1)
    return env


def relay(
    *,
    prompt: str,
    repo_path: Path,
    backend: str = DEFAULT_BACKEND,
    context_file: Path | None = None,
    context_text: str | None = None,
    include_diff: bool = False,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    model: str | None = None,
    sandbox: str = DEFAULT_SANDBOX,
) -> str:
    """Invoke a configured backend in non-interactive mode and return feedback text."""
    if not prompt.strip():
        raise RelayError("Prompt is required")
    if timeout_seconds <= 0:
        raise RelayError("Timeout must be greater than zero")

    repo_path = repo_path.resolve()
    if not repo_path.exists() or not repo_path.is_dir():
        raise RelayError(f"Repository path does not exist or is not a directory: {repo_path}")

    try:
        selected_backend = get_backend(backend)
    except ValueError as exc:
        raise RelayError(str(exc)) from exc

    if sandbox not in selected_backend.allowed_sandboxes:
        allowed = ", ".join(sorted(selected_backend.allowed_sandboxes))
        raise RelayError(f"Invalid sandbox mode: {sandbox}. Allowed values: {allowed}")

    context_text = _resolve_context_text(context_file=context_file, context_text=context_text)
    diff_text = _git_diff(repo_path) if include_diff else ""
    full_prompt = _build_prompt(
        prompt=prompt,
        repo_path=repo_path,
        context_text=context_text,
        diff_text=diff_text,
    )
    _ensure_size_limit("Relay prompt", full_prompt, MAX_PROMPT_BYTES)

    env = _next_relay_env()

    try:
        return selected_backend.run(
            prompt=full_prompt,
            repo_path=repo_path,
            timeout_seconds=timeout_seconds,
            sandbox=sandbox,
            model=model,
            env=env,
        )
    except BackendError as exc:
        raise RelayError(str(exc)) from exc


# Backward-compatible alias for existing call sites/tests.
relay_to_codex = relay
